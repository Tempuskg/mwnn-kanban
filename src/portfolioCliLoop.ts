import * as path from 'node:path';
/** CLI portfolio adapter: public planner/executor, one ledger and fallback runner. */
import { createAgentCliFallbackRunner, type AgentCliFallbackDeps } from './agentCliFallback';
import { createAiLoopBudget, formatAiLoopBudgetStopEntry, formatAiLoopBudgetStopMessage, formatAiLoopBudgetTally } from './aiLoopBudget';
import { createAiLoopPauseGate } from './aiLoopPause';
import { createLoopSession, planLoopAction, pruneLoopSession, runBoardLoop, buildTriagePrompt, type LoopSession, type LoopOptions } from './boardLoop';
import { buildCardDefinitionPrompt, buildCardHandoffPrompt, buildCardVerificationPrompt } from './aiCards';
import type { BoardStore } from './boardStore';
import type { Card } from './types';
import type { DefinitionRunSettings } from './cardRunSettings';
import type { PortfolioAiLoopCapabilityV1, PortfolioLoopProject, PortfolioLoopSessionV1, PortfolioLoopProgress } from './pro/contracts';

type FallbackOptions = Omit<AgentCliFallbackDeps, 'cwd' | 'store' | 'signal' | 'isCancelled' | 'cardKey' | 'beforeDispatch' | 'afterDispatch' | 'onPause'>;
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
  const sessions = new Map<string, LoopSession>();
  const settledCards = new Map<string, Set<string>>();
  let active: { project: PortfolioLoopProject; store: BoardStore } | undefined;
  let report: (progress: PortfolioLoopProgress) => void = () => undefined;
  let stage = 'selection';
  let currentCard: Card | undefined;
  let running = false;
  let finished = false;
  let outcome: 'finished' | 'stopped' | 'budget' | 'credits' = 'finished';
  const stopped = (): boolean => abort.signal.aborted || outcome !== 'finished' || finished;
  const current = (): NonNullable<typeof active> => { if (!active) { throw new Error('No portfolio project selected'); } return active; };
  const sessionFor = (id: string): LoopSession => { let session = sessions.get(id); if (!session) { session = createLoopSession(); sessions.set(id, session); } return session; };
  const emit = (message: string): void => { if (currentCard) { report({ cardId: currentCard.id, cardTitle: currentCard.title, stage, message }); } };
  // Getters resolve at dispatch, after the previous project has fully settled.
  const runner = createAgentCliFallbackRunner({
    ...fallback,
    get cwd() { return current().project.root; },
    cardKey: (id) => JSON.stringify([current().project.projectId, id]),
    store: {
      reload: () => current().store.reload(),
      appendActivity: (id, entry) => current().store.appendActivity(id, entry),
    },
    signal: abort.signal,
    waitBeforeDispatch: () => gate.waitWhilePaused(),
    isCancelled: stopped,
    onProgress: (message) => { fallback.onProgress?.(message); emit(message); },
    onPause: () => { outcome = 'credits'; gate.release(); },
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
      return action ? { kind: 'card', card: { cardId: action.card.id, cardTitle: action.card.title } } : { kind: 'empty', reason: 'No actionable cards (dependencies, WIP, or review holds may apply).' };
    },
    runCard: async (project, cardId, onProgress) => {
      if (running || stopped()) { return { outcome: 'stopped' }; }
      running = true;
      try {
        const store = await deps.openStore(project);
        if (!store) { return { outcome: 'skipped', reason: 'Board is missing or unreadable.' }; }
        active = { project, store };
        report = onProgress;
        currentCard = (await store.reload()).columns.flatMap(column => column.cards).find(card => card.id === cardId);
        const session = sessionFor(project.projectId);
        const path = project.boardFolder.replace(/\\/g, '/').replace(/\/+$/, '') + '/cards/' + cardId + '.md';
        const handoff = async (kind: 'definition' | 'triage' | 'implementation' | 'verification', card: Card, buildPrompt: (latest: Card) => string) => {
          await gate.waitWhilePaused();
          if (stopped()) { return { started: false }; }
          stage = kind; currentCard = card; emit('Running ' + kind);
          const result = await runner.run({ kind, card, buildPrompt });
          if (result.kind === 'stopped') {
            outcome = 'budget'; gate.release();
            const stop = budget.stop();
            if (stop) { await store.appendActivity(cardId, formatAiLoopBudgetStopEntry(stop)); }
            return { started: false };
          }
          if (result.kind !== 'ran') { return { started: false }; }
          if (result.result.failure === 'credit-exhausted') { outcome = 'credits'; gate.release(); }
          if (!result.result.completed && !result.result.cancelled && !stopped()) {
            await store.appendActivity(cardId, '### ' + new Date().toISOString() + ' - Portfolio AI Loop handoff failed\n' + (result.result.reason ?? 'CLI handoff failed.'));
          }
          return { started: result.result.completed, activityBaseline: result.result.activityBaseline };
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
        if (stopped()) { return { outcome: 'stopped' }; }
        const state = await store.reload();
        const column = state.columns.find(c => c.cards.some(card => card.id === cardId));
        const card = column?.cards.find(c => c.id === cardId);
        if (session.skipped.has(cardId)) { return { outcome: 'skipped', reason: /STATUS:\s*BLOCKED[^\n]*/i.exec(card?.activity ?? '')?.[0] ?? 'Handoff failed or could not advance safely.' }; }
        const settle = (outcome: 'completed' | 'human' | 'review') => {
          const cards = settledCards.get(project.projectId) ?? new Set<string>();
          cards.add(cardId); settledCards.set(project.projectId, cards);
          return { outcome };
        };
        if (column?.role === 'done') { return settle('completed'); }
        if (card?.assignee?.kind === 'human') { return settle('human'); }
        if (options.reviewFreshDefinitions && session.definedThisRun.has(cardId)) { return settle('review'); }
        return { outcome: 'held', reason: summary.cancelled ? 'Run stopped.' : 'Waiting for board capacity or dependencies.' };
      } finally { running = false; active = undefined; currentCard = undefined; }
    },
    pause: () => { gate.pause(); },
    resume: () => { gate.resume(); },
    stop: () => { if (outcome === 'finished') { outcome = 'stopped'; } abort.abort(); gate.release(); },
    outcome: () => outcome,
    finish: () => {
      if (!finished) { finished = true; gate.release(); release(); }
      return formatAiLoopBudgetTally(budget.tally(), outcome === 'budget' ? 'budget' : outcome === 'credits' ? 'paused' : outcome === 'stopped' ? 'cancelled' : 'finished');
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
