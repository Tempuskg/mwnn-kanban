import * as path from 'node:path';
/** CLI portfolio adapter: public planner/executor, one ledger and fallback runner. */
import { createAgentCliFallbackRunner, type AgentCliFallbackDeps } from './agentCliFallback';
import { createAiLoopBudget, formatAiLoopBudgetStopEntry, formatAiLoopBudgetStopMessage, formatAiLoopBudgetTally } from './aiLoopBudget';
import { createAiLoopPauseGate } from './aiLoopPause';
import { createAgentCliLaunchScope } from './agentCliLaunchGate';
import { createLoopSession, planLoopAction, pruneLoopSession, isVerifyColumn, runBoardLoop, buildTriagePrompt, type LoopSession, type LoopOptions } from './boardLoop';
import { buildCardDefinitionPrompt, buildCardHandoffPrompt, buildCardVerificationPrompt } from './aiCards';
import type { BoardStore } from './boardStore';
import type { Card } from './types';
import type { DefinitionRunSettings } from './cardRunSettings';
import type { PortfolioAiLoopCapabilityV1, PortfolioLoopProject, PortfolioLoopSessionV1, PortfolioLoopProgress, PortfolioLoopUsageWait } from './pro/contracts';
import type { DurableWorkerSession } from './durableWorker';

type FallbackOptions = Omit<AgentCliFallbackDeps, 'cwd' | 'store' | 'signal' | 'isCancelled' | 'cardKey' | 'launchScope' | 'beforeDispatch' | 'afterDispatch' | 'onPause' | 'onUsageWait'>;
export interface PortfolioCliLoopDeps {
  enabled(): boolean;
  busy(): boolean;
  acquire(): (() => void) | undefined;
  pick(): Promise<FallbackOptions | undefined>;
  openStore(project: PortfolioLoopProject): Promise<BoardStore | undefined>;
  definitionSettings(): DefinitionRunSettings;
  finishDefinition(store: BoardStore, cardId: string, settings: DefinitionRunSettings, completed: boolean): Promise<void>;
  options(): Pick<LoopOptions, 'reviewFreshDefinitions' | 'verifyWithAi'>;
  maxDispatches(): number | undefined;
  readonly onDidChange: PortfolioAiLoopCapabilityV1['onDidChange'];
  delay(ms: number): Promise<void>;
  /**
   * Optional durable worker for this portfolio session. When provided, each
   * card claims repo/card leases, persists checkpoints, enforces bounds, and
   * reconciles before retrying an interrupted stage.
   */
  createDurableWorker?: () => DurableWorkerSession;
}
export function createPortfolioCliLoopCapability(deps: PortfolioCliLoopDeps): PortfolioAiLoopCapabilityV1 {
  return {
    version: 1,
    onDidChange: deps.onDidChange,
    availability: () => ({ enabled: deps.enabled(), busy: deps.busy(), ...(!deps.enabled() ? { reason: 'Enable MWNN Kanban: Run With AI to use the portfolio AI Loop.' } : deps.busy() ? { reason: 'An AI loop is already active in this window.' } : {}) }),
    start: async () => {
      if (!deps.enabled()) { return undefined; }
      const release = deps.acquire();
      if (!release) { return undefined; }
      try {
        const fallback = await deps.pick();
        if (!fallback) { release(); return undefined; }
        return createSession(deps, fallback, release);
      } catch (error) { release(); throw error; }
    },
  };
}
function createSession(deps: PortfolioCliLoopDeps, fallback: FallbackOptions, release: () => void): PortfolioLoopSessionV1 {
  const abort = new AbortController();
  const gate = createAiLoopPauseGate();
  const cap = deps.maxDispatches();
  const budget = createAiLoopBudget(cap === undefined ? {} : { maxDispatches: cap });
  const options = deps.options();
  const worker = deps.createDurableWorker?.();
  // Launch scope: one id for this session; a durable card run keeps its own id
  // across sessions, so recovery never replenishes that card's stage launches.
  const launchRun = createAgentCliLaunchScope();
  let durableRunId: string | undefined;
  const sessions = new Map<string, LoopSession>();
  const settledCards = new Map<string, Set<string>>();
  let active: { project: PortfolioLoopProject; store: BoardStore } | undefined;
  let report: (progress: PortfolioLoopProgress) => void = () => undefined;
  let stage = 'selection';
  let currentCard: Card | undefined;
  let running = false;
  let finished = false;
  let outcome: 'finished' | 'stopped' | 'budget' | 'credits' = 'finished';
  /** Why the run ran out of credits, including any declined or expired wait. */
  let creditsReason: string | undefined;
  let usageWait: PortfolioLoopUsageWait | undefined;
  const stopped = (): boolean => abort.signal.aborted || outcome !== 'finished' || finished;
  const current = (): NonNullable<typeof active> => { if (!active) { throw new Error('No portfolio project selected'); } return active; };
  const sessionFor = (id: string): LoopSession => { let session = sessions.get(id); if (!session) { session = createLoopSession(); sessions.set(id, session); } return session; };
  const emit = (message: string): void => { if (currentCard) { report({ cardId: currentCard.id, cardTitle: currentCard.title, stage, message, ...(usageWait ? { usageWait } : {}) }); } };
  // Getters resolve at dispatch, after the previous project has fully settled.
  const runner = createAgentCliFallbackRunner({
    ...fallback,
    get cwd() { return current().project.root; },
    cardKey: (id) => JSON.stringify([current().project.projectId, id]),
    launchScope: (id) => ({
      runId: launchRun.runId,
      cardRunId: durableRunId ?? `${launchRun.runId}:${current().project.projectId}:${id}`,
    }),
    store: {
      reload: () => current().store.reload(),
      appendActivity: (id, entry) => current().store.appendActivity(id, entry),
    },
    signal: abort.signal,
    waitBeforeDispatch: () => gate.waitWhilePaused(),
    isCancelled: stopped,
    onProgress: (message) => {
      fallback.onProgress?.(message);
      emit(message);
      const project = active?.project;
      if (worker && project && currentCard) {
        void worker.heartbeat(project.projectId, currentCard.id, message);
      }
    },
    onPause: (reason) => { outcome = 'credits'; creditsReason = reason; gate.release(); },
    onUsageWait: (wait) => { usageWait = wait; },
    beforeDispatch: ({ kind, target, card }) => {
      const reservation = budget.reserve({ stage: kind, provider: target.provider, providerLabel: target.label, cardId: JSON.stringify([current().project.projectId, card.id]), cardTitle: current().project.projectName + ': ' + card.title });
      return reservation.allowed ? { allowed: true } : { allowed: false, reason: formatAiLoopBudgetStopMessage(reservation.stop) };
    },
    afterDispatch: ({ model }) => budget.settle(model),
    createObserver: (target, request) => {
      const observer = fallback.createObserver?.(target, request);
      return { ...observer, onExit: (result) => { budget.recordUsage(target.label, result.stdout + '\n' + result.stderr); observer?.onExit?.(result); } };
    },
  });
  return {
    selectCard: async (project) => {
      if (stopped()) { return { kind: 'empty', reason: 'Run ended.' }; }
      const store = await deps.openStore(project);
      if (!store) { return { kind: 'empty', reason: 'Board is missing or unreadable.' }; }
      const state = await store.reload();
      const session = sessionFor(project.projectId);
      pruneLoopSession(state, session);
      const action = planLoopAction(state, { ...session, skipped: new Set([...session.skipped, ...(settledCards.get(project.projectId) ?? [])]) }, options);
      if (action) { return { kind: 'card', card: { cardId: action.card.id, cardTitle: action.card.title } }; }
      // The full-board planner above remains authoritative for runnability.
      // Distinguish remaining candidates from completed, human and settled work.
      const settled = settledCards.get(project.projectId);
      const blocked = state.columns.some(column => column.role !== 'done' && column.cards.some(card =>
        card.assignee?.kind !== 'human' && !settled?.has(card.id)
        && (card.assignee !== undefined || !isVerifyColumn(column))));
      return blocked
        ? { kind: 'empty', reason: 'Remaining AI work is blocked by dependencies, board capacity, review holds, or a skipped handoff.', blocked: true }
        : { kind: 'empty', reason: 'No actionable cards (dependencies, WIP, or review holds may apply).' };
    },
    runCard: async (project, cardId, onProgress) => {
      if (running || stopped()) { return { outcome: 'stopped' }; }
      running = true;
      let cardFinish: 'completed' | 'failed' | 'stopped' | undefined;
      let cardOutcome: string | undefined;
      try {
        const store = await deps.openStore(project);
        if (!store) { return { outcome: 'skipped', reason: 'Board is missing or unreadable.' }; }
        active = { project, store };
        report = onProgress;
        currentCard = (await store.reload()).columns.flatMap(column => column.cards).find(card => card.id === cardId);
        durableRunId = undefined;
        if (worker) {
          const claimed = await worker.beginCard(project.projectId, cardId);
          if (!claimed.ok) {
            return { outcome: 'skipped', reason: claimed.reason };
          }
          durableRunId = claimed.runId;
          emit(claimed.message);
        }
        const session = sessionFor(project.projectId);
        const path = project.boardFolder.replace(/\\/g, '/').replace(/\/+$/, '') + '/cards/' + cardId + '.md';
        const handoff = async (kind: 'definition' | 'triage' | 'implementation' | 'verification', card: Card, buildPrompt: (latest: Card) => string) => {
          await gate.waitWhilePaused();
          if (stopped()) { return { started: false }; }
          stage = kind; currentCard = card;
          if (worker) {
            const baseline = (card.activity ?? '').length;
            const gateResult = await worker.beforeStage({
              projectId: project.projectId,
              cardId,
              stage: kind,
              card,
              activityBaseline: baseline,
            });
            if (!gateResult.ok) {
              if (gateResult.activityEntry) {
                await store.appendActivity(cardId, gateResult.activityEntry);
              }
              emit(gateResult.reason);
              if (gateResult.reconcile?.kind === 'already-complete') {
                return { started: true, activityBaseline: baseline };
              }
              if (gateResult.stop) {
                outcome = 'stopped';
                gate.release();
                cardFinish = 'stopped';
                cardOutcome = gateResult.stop.kind;
              }
              return { started: false };
            }
            emit(gateResult.progress);
          } else {
            emit('Running ' + kind);
          }
          const result = await runner.run({ kind, card, buildPrompt });
          if (result.kind === 'stopped') {
            outcome = 'budget'; gate.release();
            const stop = budget.stop();
            if (stop) { await store.appendActivity(cardId, formatAiLoopBudgetStopEntry(stop)); }
            cardFinish = 'stopped';
            cardOutcome = 'budget';
            return { started: false };
          }
          if (result.kind !== 'ran') {
            if (worker) {
              await worker.afterStage({ projectId: project.projectId, cardId, stage: kind, completed: false });
            }
            return { started: false };
          }
          if (result.result.failure === 'credit-exhausted') { outcome = 'credits'; creditsReason ??= result.result.reason; gate.release(); }
          if (!result.result.completed && !result.result.cancelled && !stopped()) {
            await store.appendActivity(cardId, '### ' + new Date().toISOString() + ' - Portfolio AI Loop handoff failed\n' + (result.result.reason ?? 'CLI handoff failed.'));
          }
          if (worker) {
            await worker.afterStage({
              projectId: project.projectId,
              cardId,
              stage: kind,
              completed: result.result.completed,
              ...(result.result.reason !== undefined ? { message: result.result.reason } : {}),
            });
          }
          return { started: result.result.completed, activityBaseline: result.result.activityBaseline, ...(result.result.revalidateOutcome ? { revalidateOutcome: result.result.revalidateOutcome } : {}) };
        };
        const summary = await runBoardLoop(store, {
          decideDoability: async () => undefined, // CLI-only triage; never opens chat.
          requestDefinition: async (card) => {
            const settings = deps.definitionSettings();
            const result = await handoff('definition', card, latest => buildCardDefinitionPrompt(latest, path, settings));
            // A pause holds advancement and definition follow-up too.
            await gate.waitWhilePaused();
            if (!stopped()) { await deps.finishDefinition(store, cardId, settings, result.started); }
            return result;
          },
          requestTriage: card => handoff('triage', card, latest => buildTriagePrompt(latest, path)),
          dispatchCard: card => handoff('implementation', card, latest => buildCardHandoffPrompt(latest, path)),
          verifyCard: card => handoff('verification', card, latest => buildCardVerificationPrompt(latest, path)),
        }, { isCancelled: stopped, delay: deps.delay, waitWhilePaused: () => gate.waitWhilePaused() }, {
          ...options, session, cardId,
          onEvent: (message) => { stage = 'advancement'; emit(message); },
        });
        if (stopped()) {
          cardFinish ??= 'stopped';
          return { outcome: 'stopped' };
        }
        const state = await store.reload();
        const column = state.columns.find(c => c.cards.some(card => card.id === cardId));
        const card = column?.cards.find(c => c.id === cardId);
        if (session.skipped.has(cardId)) {
          cardFinish = 'failed';
          cardOutcome = 'skipped';
          return { outcome: 'skipped', reason: /STATUS:\s*BLOCKED[^\n]*/i.exec(card?.activity ?? '')?.[0] ?? 'Handoff failed or could not advance safely.' };
        }
        const settle = (settleOutcome: 'completed' | 'human' | 'review') => {
          const cards = settledCards.get(project.projectId) ?? new Set<string>();
          cards.add(cardId); settledCards.set(project.projectId, cards);
          cardFinish = settleOutcome === 'completed' ? 'completed' : 'completed';
          cardOutcome = settleOutcome;
          return { outcome: settleOutcome };
        };
        if (column?.role === 'done') { return settle('completed'); }
        if (card?.assignee?.kind === 'human') { return settle('human'); }
        if (options.reviewFreshDefinitions && session.definedThisRun.has(cardId)) { return settle('review'); }
        cardFinish = 'completed';
        cardOutcome = summary.cancelled ? 'stopped' : 'held';
        return { outcome: 'held', reason: summary.cancelled ? 'Run stopped.' : 'Waiting for board capacity or dependencies.' };
      } finally {
        if (worker) {
          await worker.finishCard({
            projectId: project.projectId,
            cardId,
            status: cardFinish ?? (stopped() ? 'stopped' : 'failed'),
            ...(cardOutcome !== undefined ? { outcome: cardOutcome } : {}),
          });
        }
        running = false; active = undefined; currentCard = undefined; usageWait = undefined;
      }
    },
    pause: () => { gate.pause(); },
    resume: () => { gate.resume(); },
    stop: () => { if (outcome === 'finished') { outcome = 'stopped'; } abort.abort(); gate.release(); },
    outcome: () => outcome,
    finish: () => {
      if (!finished) {
        finished = true;
        gate.release();
        release();
        void worker?.release();
      }
      const tally = formatAiLoopBudgetTally(budget.tally(), outcome === 'budget' ? 'budget' : outcome === 'credits' ? 'paused' : outcome === 'stopped' ? 'cancelled' : 'finished');
      // The host's reason (e.g. a declined or expired usage wait) reaches the run summary.
      return outcome === 'credits' && creditsReason ? creditsReason + '\n' + tally : tally;
    },
  };
}

/** Use the primary store only for the same root and board, respecting path case. */
export function isPortfolioPrimaryBoard(root: string, folder: string, primaryRoot: string, primaryFolder: string, platform: NodeJS.Platform = process.platform): boolean {
  const flavour = platform === 'win32' ? path.win32 : path.posix;
  const normalize = (value: string): string => {
    const result = flavour.resolve(value).replace(/\\/g, '/').replace(/\/+$/, '');
    return platform === 'win32' || platform === 'darwin' ? result.toLowerCase() : result;
  };
  return normalize(root) === normalize(primaryRoot) && normalize(flavour.resolve(root, folder)) === normalize(flavour.resolve(primaryRoot, primaryFolder));
}
