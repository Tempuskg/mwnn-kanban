/**
 * AI board loop: orchestrates AI-assigned cards across the whole board instead
 * of one hand-off at a time. Each pass over the board the loop
 *   - parks AI cards that reached the `verify` column and reassigns them to a
 *     human by default; with `verifyWithAi`, it instead asks an agent to verify
 *     the finished work and moves only an explicit pass into Done,
 *   - triages unassigned cards by asking the AI whether the card is doable by
 *     an agent (filling in the definition first when the card is title-only);
 *     a card the loop defines this way is placed at the end of the Ready
 *     column and then continues through the normal flow. With the
 *     `reviewFreshDefinitions` option it instead rests in Ready for the
 *     remainder of the run, so a human can review the fresh definition before
 *     implementation starts,
 *   - advances unblocked AI cards through the ordered columns, handing the card
 *     off to the chat agent in each work column and waiting for its
 *     `STATUS: DONE` report before moving on.
 *
 * The module is deliberately free of any `vscode` import: all effects (store
 * mutations, chat hand-offs, the doability decision, delays/cancellation) are
 * injected, so the whole orchestration is unit-testable. `src/extension.ts`
 * supplies the real implementations.
 */

import { cardNeedsDefinition } from './cardDefinition';
import { parseVerificationVerdict } from './cardVerification';
import { isCardBlocked, readyState } from './utils';
import type { Assignee, BoardState, Card, Column } from './types';

export type LoopTriageDecision = 'ai' | 'human';

export interface DoabilityVerdict {
  readonly decision: LoopTriageDecision;
  /** One-sentence explanation of the decision, when the model gave one. */
  readonly reason?: string;
}

/** Tokens the doability prompt asks for; parsing keys off these exact words. */
const DOABLE_TOKEN = 'DOABLE_BY_AI';
const NEEDS_HUMAN_TOKEN = 'NEEDS_HUMAN';

const DEFAULT_POLL_INTERVAL_MS = 2_000;

/** Subset of the BoardStore the loop mutates through (never direct file writes). */
export interface LoopStore {
  reload(): Promise<BoardState>;
  moveCard(cardId: string, toColumnId: string, toIndex: number): Promise<unknown>;
  setAssignee(cardId: string, assignee: Assignee | undefined): Promise<unknown>;
  setAcceptanceCriteria(cardId: string, acceptanceCriteria: string): Promise<unknown>;
  appendActivity(cardId: string, entry: string): Promise<unknown>;
}

/**
 * Gateways may return a plain boolean (legacy fire-and-forget handoffs) or the
 * richer synchronous CLI result. The optional baseline tells the loop exactly
 * where agent-written Activity begins.
 */
export type LoopHandoffResult =
  | boolean
  | {
      readonly started: boolean;
      readonly activityBaseline?: number;
    };

/** The AI channels the loop drives; all fire-and-forget except the decision. */
export interface LoopGateways {
  /** Hand the card's implementation work to the chat agent. False = hand-off failed. */
  dispatchCard(card: Card): Promise<LoopHandoffResult>;
  /** Hand the card to the fill-with-AI definition flow. False = hand-off failed. */
  requestDefinition(card: Card): Promise<LoopHandoffResult>;
  /**
   * Ask the AI directly whether an agent can do this card; undefined = no
   * answer channel (e.g. no language model available) or no verdict.
   */
  decideDoability(card: Card): Promise<DoabilityVerdict | undefined>;
  /**
   * Fallback triage: hand the card to the chat agent with instructions to
   * record its AI-vs-Human decision in the card file's `assignee` frontmatter.
   * The loop then waits for the assignee to appear. False = hand-off failed.
   */
  requestTriage(card: Card): Promise<LoopHandoffResult>;
  /** Hand a finished card to the AI verification flow. False = hand-off failed. */
  verifyCard?(card: Card): Promise<LoopHandoffResult>;
}

export interface LoopControl {
  isCancelled(): boolean;
  delay(ms: number): Promise<void>;
}

export interface LoopOptions {
  /** How often to re-read the board while waiting on an agent. */
  readonly pollIntervalMs?: number;
  /** Clock override for tests. */
  readonly now?: () => number;
  /** Progress callback, e.g. for a notification's message line. */
  readonly onEvent?: (message: string) => void;
  /**
   * When true, a card whose definition the loop filled in rests in Ready for
   * the remainder of the run so a human can review the fresh Description and
   * Acceptance criteria first. Off by default: the loop carries straight on
   * and implements the card it just defined.
   */
  readonly reviewFreshDefinitions?: boolean;
  /**
   * When true, AI-assigned cards in Verify are handed to an agent and move to
   * Done only after an explicit passing verdict. Off by default: they are
   * reassigned to Human exactly as before.
   */
  readonly verifyWithAi?: boolean;
}

export interface LoopSummary {
  dispatched: string[];
  advanced: string[];
  /** Cards defined this run and parked in Ready for human review. */
  movedToReady: string[];
  parked: string[];
  triagedToAi: string[];
  triagedToHuman: string[];
  definitionsRequested: string[];
  /** Cards whose AI verification passed and which moved into Done. */
  verified: string[];
  /** Cards handed to an agent for independent verification. */
  verificationsRequested: string[];
  skipped: string[];
  cancelled: boolean;
}

/** An implementation hand-off the loop made and is waiting on. */
interface DispatchRecord {
  /** Column the card was in when dispatched; a move resets the record. */
  columnId: string;
  /** Length of the card's activity at dispatch, so only newly appended text is scanned. */
  activityBaseline: number;
  dispatchedAt: number;
}

interface WaitRecord {
  requestedAt: number;
}

interface TriageRequestRecord extends WaitRecord {
  /**
   * Length of the card's activity when the triage hand-off completed, so the
   * loop can tell whether the agent appended its own decision note.
   */
  activityBaseline: number;
}

/** An AI verification hand-off the loop made and is waiting on. */
interface VerificationRecord extends WaitRecord {
  /** Verify column the card was in when requested; a move resets the record. */
  columnId: string;
  /** Length of Activity at hand-off, so stale verdicts never resolve this run. */
  activityBaseline: number;
}

export interface LoopSession {
  /** Cards the loop gave up on this run (failed hand-off, BLOCKED report, undecidable triage). */
  readonly skipped: Set<string>;
  readonly dispatches: Map<string, DispatchRecord>;
  readonly definitionRequests: Map<string, WaitRecord>;
  /** Fallback triage hand-offs waiting for the agent to record an assignee. */
  readonly triageRequests: Map<string, TriageRequestRecord>;
  readonly verifications: Map<string, VerificationRecord>;
  /**
   * Cards whose definition the loop filled in during this run. A Backlog card
   * in this set is placed at the end of Ready; with `reviewFreshDefinitions`
   * it also rests there (never advanced past Ready, never dispatched) until
   * the next run, so a human gets a chance to review the definition first.
   */
  readonly definedThisRun: Set<string>;
}

export function createLoopSession(): LoopSession {
  return {
    skipped: new Set(),
    dispatches: new Map(),
    definitionRequests: new Map(),
    triageRequests: new Map(),
    verifications: new Map(),
    definedThisRun: new Set(),
  };
}

export type LoopAction =
  | { readonly kind: 'park'; readonly card: Card }
  | { readonly kind: 'park-unverified'; readonly card: Card; readonly reason: string }
  | { readonly kind: 'verify'; readonly card: Card; readonly column: Column }
  | { readonly kind: 'complete'; readonly card: Card; readonly toColumn: Column }
  | { readonly kind: 'advance'; readonly card: Card; readonly toColumn: Column }
  | { readonly kind: 'abandon'; readonly card: Card }
  | { readonly kind: 'triage'; readonly card: Card }
  | { readonly kind: 'record-triage'; readonly card: Card }
  | { readonly kind: 'request-definition'; readonly card: Card }
  | { readonly kind: 'move-to-ready'; readonly card: Card; readonly toColumn: Column }
  | { readonly kind: 'dispatch'; readonly card: Card; readonly column: Column };

type DispatchOutcome = 'pending' | 'done' | 'blocked';

function readDispatchOutcome(card: Card, record: DispatchRecord): DispatchOutcome {
  const appended = (card.activity ?? '').slice(record.activityBaseline);
  // The hand-off prompt asks the agent to report `STATUS: DONE` or
  // `STATUS: BLOCKED: <reason>` on its own line; trust only text appended
  // after the dispatch so stale markers from earlier runs never count.
  if (/^\s*STATUS:\s*BLOCKED\b/im.test(appended)) {
    return 'blocked';
  }
  if (/^\s*STATUS:\s*DONE\b/im.test(appended)) {
    return 'done';
  }
  // Chat hand-offs are fire-and-forget: the agent's final chat response is not
  // available to the loop. Accept a fully checked checklist as completion too,
  // which also recovers cards handled by agents that followed the older prompt
  // and recorded their work without copying the terminal status into Activity.
  if (hasCompletedAcceptanceCriteria(card)) {
    return 'done';
  }
  return 'pending';
}

function hasCompletedAcceptanceCriteria(card: Card): boolean {
  const criteria = card.acceptanceCriteria ?? '';
  const checks = [...criteria.matchAll(/^\s*(?:[-*+]\s+|\d+[.)]\s+)?\[([ xX])\]/gm)];
  return checks.length > 0 && checks.every((check) => check[1]?.toLowerCase() === 'x');
}

export function checkAllAcceptanceCriteria(acceptanceCriteria: string | undefined): string | undefined {
  return acceptanceCriteria?.replace(
    /^([ \t]*(?:[-*+][ \t]+|\d+[.)][ \t]+)?)\[[ \t]\]/gm,
    '$1[x]',
  );
}

export function isVerifyColumn(column: Column): boolean {
  // Older boards persisted a title-based Verify column as `custom` before
  // built-in role metadata was introduced. Keep those boards in the loop's
  // human verification gate instead of advancing them toward Done.
  return column.role === 'verify' || (column.role === 'custom' && /verify/i.test(column.title));
}

function isPreWorkColumn(column: Column): boolean {
  return column.role === 'backlog' || column.role === 'ready';
}

export function hasWipCapacity(column: Column): boolean {
  return column.wipLimit === undefined || column.wipLimit === null || column.cards.length < column.wipLimit;
}

/**
 * A backlog card is available when the loop could still do something useful
 * with it. Human-owned cards and cards blocked by unfinished dependencies do
 * not count: the loop cannot implement either one.
 */
function hasAvailableBacklogCard(state: BoardState, session: LoopSession): boolean {
  const backlog = state.columns.find((column) => column.role === 'backlog');
  if (!backlog) {
    return false;
  }

  return backlog.cards.some((card) => {
    if (session.skipped.has(card.id) || isCardBlocked(state, card.id)) {
      return false;
    }
    return card.assignee?.kind !== 'human';
  });
}

/**
 * Implementation admission is intentionally downstream of Ready's reverse
 * WIP. This keeps the loop from starting work before the queue has enough
 * defined cards, while still allowing the last available backlog card to run
 * when there is nothing left to replenish Ready.
 */
function canStartImplementation(state: BoardState, session: LoopSession): boolean {
  const ready = state.columns.find((column) => column.role === 'ready');
  if (!ready || ready.reverseWip === undefined || ready.reverseWip === null) {
    return true;
  }

  const readyWip = readyState(state, ready);
  return !readyWip.under || !hasAvailableBacklogCard(state, session);
}

function canAdvanceIntoColumn(state: BoardState, session: LoopSession, target: Column): boolean {
  if (!hasWipCapacity(target)) {
    return false;
  }
  return target.role !== 'in-progress' || canStartImplementation(state, session);
}

/**
 * Drop session records the board has since resolved or invalidated: a dispatch
 * or verification whose card was moved out of the recorded column (or deleted),
 * a definition request whose card vanished, got assigned, or is now defined
 * (the wait's success case, recorded in `definedThisRun`), and a triage request
 * whose card vanished.
 */
export function pruneLoopSession(state: BoardState, session: LoopSession): void {
  const columnByCardId = new Map<string, Column>();
  const cardById = new Map<string, Card>();
  for (const column of state.columns) {
    for (const card of column.cards) {
      columnByCardId.set(card.id, column);
      cardById.set(card.id, card);
    }
  }

  for (const [cardId, record] of [...session.dispatches]) {
    if (columnByCardId.get(cardId)?.id !== record.columnId) {
      session.dispatches.delete(cardId);
    }
  }
  for (const [cardId, record] of [...session.verifications]) {
    if (columnByCardId.get(cardId)?.id !== record.columnId) {
      session.verifications.delete(cardId);
    }
  }
  for (const cardId of [...session.definitionRequests.keys()]) {
    const card = cardById.get(cardId);
    if (card && !cardNeedsDefinition(card)) {
      // The definition wait succeeded: remember the card so this run parks it
      // in Ready and never advances past Ready or dispatches it.
      session.definedThisRun.add(cardId);
    }
    if (!card || card.assignee !== undefined || !cardNeedsDefinition(card)) {
      session.definitionRequests.delete(cardId);
    }
  }
  for (const cardId of [...session.triageRequests.keys()]) {
    if (!cardById.has(cardId)) {
      session.triageRequests.delete(cardId);
    }
  }
}

export interface PlanLoopOptions {
  /** See LoopOptions.reviewFreshDefinitions. */
  readonly reviewFreshDefinitions?: boolean;
  /** See LoopOptions.verifyWithAi. */
  readonly verifyWithAi?: boolean;
}

/**
 * Pick the next thing the loop should do, or undefined when nothing is
 * actionable right now. Actions that would open another chat hand-off
 * (verify, triage, request-definition, dispatch) are withheld while one is
 * already pending, so the loop drives at most one agent conversation at a time.
 */
export function planLoopAction(
  state: BoardState,
  session: LoopSession,
  options: PlanLoopOptions = {},
): LoopAction | undefined {
  const reviewFreshDefinitions = options.reviewFreshDefinitions === true;
  const verifyWithAi = options.verifyWithAi === true;
  const handoffPending = hasPendingHandoff(state, session);
  let firstVerification: LoopAction | undefined;
  let firstTriage: LoopAction | undefined;
  let firstDefinition: LoopAction | undefined;
  let firstDispatch: LoopAction | undefined;
  let firstPreWorkAdvance: LoopAction | undefined;

  for (const [columnIndex, column] of state.columns.entries()) {
    if (column.role === 'done') {
      continue;
    }
    const nextColumn = state.columns[columnIndex + 1];

    for (const card of column.cards) {
      if (session.skipped.has(card.id)) {
        continue;
      }

      if (session.definedThisRun.has(card.id) && column.role === 'backlog') {
        // The loop just filled this card's definition in: place it at the end
        // of Ready, the column where defined cards wait to be pulled into
        // work. Without a Ready column it stays put.
        const readyColumn = state.columns.find((candidate) => candidate.role === 'ready');
        if (readyColumn && hasWipCapacity(readyColumn)) {
          return { kind: 'move-to-ready', card, toColumn: readyColumn };
        }
      }

      if (session.triageRequests.has(card.id)) {
        if (card.assignee !== undefined) {
          // The fallback-triage agent recorded its decision in the card file;
          // log it and let the card flow (or rest) under its new assignee.
          return { kind: 'record-triage', card };
        }
        continue; // still waiting for the agent's decision
      }

      if (card.assignee === undefined) {
        // Triage happens anywhere before Verify; blocked cards may still be
        // triaged (assignment is not advancement).
        if (isVerifyColumn(column)) {
          continue;
        }
        if (cardNeedsDefinition(card)) {
          if (session.definitionRequests.has(card.id)) {
            continue; // waiting for the agent to fill the card in
          }
          firstDefinition ??= { kind: 'request-definition', card };
        } else {
          firstTriage ??= { kind: 'triage', card };
        }
        continue;
      }

      if (card.assignee.kind !== 'ai') {
        continue; // human cards are never picked up
      }

      if (isVerifyColumn(column)) {
        if (!verifyWithAi) {
          // The opt-in is off: preserve the original human sign-off behaviour.
          return { kind: 'park', card };
        }

        const verification = session.verifications.get(card.id);
        if (verification) {
          const verdict = parseVerificationVerdict(card.activity ?? '', verification.activityBaseline);
          if (!verdict) {
            continue; // the verifier has not recorded a usable verdict yet
          }
          if (verdict.kind === 'fail' || verdict.kind === 'human') {
            return { kind: 'park-unverified', card, reason: verdict.reason };
          }

          const doneColumn = state.columns.find((candidate) => candidate.role === 'done');
          if (!doneColumn) {
            return {
              kind: 'park-unverified',
              card,
              reason: 'AI verification passed, but this board has no Done column.',
            };
          }
          if (!hasWipCapacity(doneColumn)) {
            return {
              kind: 'park-unverified',
              card,
              reason: `AI verification passed, but "${doneColumn.title}" is at its WIP limit.`,
            };
          }
          return { kind: 'complete', card, toColumn: doneColumn };
        }

        firstVerification ??= { kind: 'verify', card, column };
        continue;
      }

      if (isCardBlocked(state, card.id)) {
        continue; // unfinished dependsOn — leave until dependencies complete
      }

      const record = session.dispatches.get(card.id);
      if (record) {
        const outcome = readDispatchOutcome(card, record);
        if (outcome === 'done') {
          if (nextColumn && nextColumn.role !== 'done') {
            if (canAdvanceIntoColumn(state, session, nextColumn)) {
              return { kind: 'advance', card, toColumn: nextColumn };
            }
            // Keep the completed card in its current column when the next
            // column is full. A later loop run can retry once capacity opens;
            // abandoning it here would incorrectly make a successful hand-off
            // look like a failed one.
            continue;
          }
          // No Verify gate before Done: never auto-complete a card.
          return { kind: 'abandon', card };
        }
        if (outcome === 'blocked') {
          return { kind: 'abandon', card };
        }
        continue; // agent still working
      }

      if (isPreWorkColumn(column)) {
        if (reviewFreshDefinitions && session.definedThisRun.has(card.id)) {
          continue; // freshly defined — rests here until a human reviews it
        }
        // Nothing to run in Backlog/Ready; the card trivially "completes" and
        // moves toward the work columns.
        if (nextColumn && nextColumn.role !== 'done' && canAdvanceIntoColumn(state, session, nextColumn)) {
          firstPreWorkAdvance ??= { kind: 'advance', card, toColumn: nextColumn };
        }
        continue;
      }

      if (reviewFreshDefinitions && session.definedThisRun.has(card.id)) {
        continue; // freshly defined — never dispatched before a human review
      }
      if (column.role === 'in-progress' && !canStartImplementation(state, session)) {
        continue;
      }
      firstDispatch ??= { kind: 'dispatch', card, column };
    }
  }

  // Drain finished work before starting or preparing more implementation.
  if (!handoffPending && firstVerification) {
    return firstVerification;
  }
  if (firstPreWorkAdvance) {
    return firstPreWorkAdvance;
  }
  // Triage is hand-off-gated too: when no direct answer channel is available
  // it falls back to a chat hand-off, so it must not start while one is open.
  if (!handoffPending && firstTriage) {
    return firstTriage;
  }
  if (!handoffPending && firstDefinition) {
    return firstDefinition;
  }
  if (!handoffPending && firstDispatch) {
    return firstDispatch;
  }
  return undefined;
}

interface PendingWait {
  readonly cardId: string;
  readonly startedAt: number;
  readonly kind: 'dispatch' | 'definition' | 'triage' | 'verification';
}

function listPendingWaits(state: BoardState, session: LoopSession): PendingWait[] {
  const waits: PendingWait[] = [];
  const cards = new Map<string, Card>();
  for (const column of state.columns) {
    for (const card of column.cards) {
      cards.set(card.id, card);
    }
  }

  for (const [cardId, record] of session.dispatches) {
    const card = cards.get(cardId);
    if (card && !session.skipped.has(cardId) && readDispatchOutcome(card, record) === 'pending') {
      waits.push({ cardId, startedAt: record.dispatchedAt, kind: 'dispatch' });
    }
  }
  for (const [cardId, record] of session.definitionRequests) {
    if (!session.skipped.has(cardId)) {
      waits.push({ cardId, startedAt: record.requestedAt, kind: 'definition' });
    }
  }
  for (const [cardId, record] of session.triageRequests) {
    // Resolved once the agent records an assignee; until then it is an open
    // hand-off the loop is waiting on.
    if (!session.skipped.has(cardId) && cards.get(cardId)?.assignee === undefined) {
      waits.push({ cardId, startedAt: record.requestedAt, kind: 'triage' });
    }
  }
  for (const [cardId, record] of session.verifications) {
    const card = cards.get(cardId);
    if (
      card
      && !session.skipped.has(cardId)
      && parseVerificationVerdict(card.activity ?? '', record.activityBaseline) === undefined
    ) {
      waits.push({ cardId, startedAt: record.requestedAt, kind: 'verification' });
    }
  }
  return waits;
}

function hasPendingHandoff(state: BoardState, session: LoopSession): boolean {
  return listPendingWaits(state, session).length > 0;
}

/**
 * Run the AI loop until there is nothing left it can do or the user cancels.
 * Every board mutation goes through `store`, and every action leaves an entry
 * in the affected card's Activity log.
 */
export async function runBoardLoop(
  store: LoopStore,
  gateways: LoopGateways,
  control: LoopControl,
  options: LoopOptions = {},
): Promise<LoopSummary> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const report = options.onEvent ?? ((): void => undefined);
  const planOptions: PlanLoopOptions = {
    ...(options.reviewFreshDefinitions === undefined
      ? {}
      : { reviewFreshDefinitions: options.reviewFreshDefinitions }),
    ...(options.verifyWithAi === undefined
      ? {}
      : { verifyWithAi: options.verifyWithAi }),
  };

  const session = createLoopSession();
  const summary: LoopSummary = {
    dispatched: [],
    advanced: [],
    movedToReady: [],
    parked: [],
    triagedToAi: [],
    triagedToHuman: [],
    definitionsRequested: [],
    verified: [],
    verificationsRequested: [],
    skipped: [],
    cancelled: false,
  };

  const markSkipped = (card: Card): void => {
    session.skipped.add(card.id);
    session.dispatches.delete(card.id);
    session.definitionRequests.delete(card.id);
    session.triageRequests.delete(card.id);
    session.verifications.delete(card.id);
    summary.skipped.push(card.title);
  };

  while (!control.isCancelled()) {
    const state = await store.reload();
    pruneLoopSession(state, session);

    const action = planLoopAction(state, session, planOptions);
    if (action) {
      await executeAction(action);
      continue;
    }

    const waits = listPendingWaits(state, session);
    if (waits.length === 0) {
      break; // nothing actionable and nothing in flight — the loop is done
    }

    // Waits have no deadline: real agent work routinely runs long, so elapsed
    // time is never a reason to give up on a card. A wait ends only on the
    // agent's terminal report, the board resolving/invalidating it (see
    // pruneLoopSession), or the user cancelling the loop. The report says what
    // is being waited on and for how long, so an indefinite wait never looks
    // like a hang.
    const longest = waits.reduce((a, b) => (b.startedAt < a.startedAt ? b : a));
    const title = findCard(state, longest.cardId)?.title ?? longest.cardId;
    const detail = `${WAIT_DESCRIPTIONS[longest.kind]} "${title}" (waiting ${formatWaitDuration(now() - longest.startedAt)})`;
    report(waits.length === 1 ? `Waiting for ${detail}` : `Waiting on ${waits.length} hand-offs — longest: ${detail}`);
    await control.delay(pollIntervalMs);
  }

  summary.cancelled = control.isCancelled();
  return summary;

  async function executeAction(action: LoopAction): Promise<void> {
    const { card } = action;
    switch (action.kind) {
      case 'park': {
        report(`Handing "${card.title}" to a human for verification`);
        await store.setAssignee(card.id, { kind: 'human' });
        await store.appendActivity(card.id, formatLoopParkEntry());
        session.dispatches.delete(card.id);
        summary.parked.push(card.title);
        return;
      }
      case 'park-unverified': {
        await handVerificationToHuman(card, action.reason);
        return;
      }
      case 'verify': {
        report(`Verifying "${card.title}" with AI`);
        if (!gateways.verifyCard) {
          await handVerificationToHuman(card, 'No AI verification gateway is available.');
          return;
        }
        const result = await gateways.verifyCard(card);
        if (control.isCancelled()) {
          return;
        }
        if (handoffStarted(result)) {
          session.verifications.set(card.id, {
            columnId: action.column.id,
            activityBaseline: handoffActivityBaseline(result, (card.activity ?? '').length),
            requestedAt: now(),
          });
          summary.verificationsRequested.push(card.title);
        } else {
          await handVerificationToHuman(card, 'The AI verification hand-off could not be started.');
        }
        return;
      }
      case 'complete': {
        report(`Completing verified card "${card.title}" in ${action.toColumn.title}`);
        await store.moveCard(card.id, action.toColumn.id, action.toColumn.cards.length);
        await store.appendActivity(card.id, formatLoopVerificationPassedEntry(action.toColumn.title));
        session.verifications.delete(card.id);
        summary.verified.push(card.title);
        return;
      }
      case 'advance': {
        report(`Advancing "${card.title}" to ${action.toColumn.title}`);
        if (session.dispatches.has(card.id)) {
          // STATUS: DONE is the agent's explicit claim that every criterion is
          // met. Keep the card checklist consistent even if the agent omitted
          // the mechanical checkbox edits requested by the hand-off prompt.
          const completedCriteria = checkAllAcceptanceCriteria(card.acceptanceCriteria);
          if (
            completedCriteria !== undefined
            && completedCriteria !== card.acceptanceCriteria
          ) {
            await store.setAcceptanceCriteria(card.id, completedCriteria);
          }
        }
        await store.moveCard(card.id, action.toColumn.id, action.toColumn.cards.length);
        await store.appendActivity(card.id, formatLoopAdvanceEntry(action.toColumn.title));
        session.dispatches.delete(card.id);
        summary.advanced.push(card.title);
        return;
      }
      case 'move-to-ready': {
        report(`Placing freshly defined "${card.title}" in ${action.toColumn.title}`);
        await store.moveCard(card.id, action.toColumn.id, action.toColumn.cards.length);
        await store.appendActivity(
          card.id,
          formatLoopDefinedReadyEntry(action.toColumn.title, planOptions.reviewFreshDefinitions === true),
        );
        summary.movedToReady.push(card.title);
        return;
      }
      case 'abandon': {
        // The agent reported BLOCKED (its reason is already in the activity
        // log), or there is no Verify column to park in — leave it for a human.
        markSkipped(card);
        return;
      }
      case 'triage': {
        report(`Triaging "${card.title}"`);
        session.definitionRequests.delete(card.id);
        const verdict = await gateways.decideDoability(card);
        if (control.isCancelled()) {
          return;
        }
        if (verdict !== undefined) {
          await store.setAssignee(card.id, { kind: verdict.decision });
          await store.appendActivity(card.id, formatLoopTriageEntry(verdict.decision, verdict.reason));
          (verdict.decision === 'ai' ? summary.triagedToAi : summary.triagedToHuman).push(card.title);
          return;
        }
        // No direct answer channel — fall back to the chat agent, which
        // records its decision in the card file's assignee frontmatter.
        const result = await gateways.requestTriage(card);
        if (control.isCancelled()) {
          return;
        }
        if (handoffStarted(result)) {
          // Re-read the card so the baseline sits after anything the hand-off
          // itself appended (e.g. the "Triage requested" entry): only text the
          // agent adds later counts as its decision note.
          const fresh = findCard(await store.reload(), card.id);
          session.triageRequests.set(card.id, {
            requestedAt: now(),
            activityBaseline: handoffActivityBaseline(
              result,
              (fresh?.activity ?? card.activity ?? '').length,
            ),
          });
          return;
        }
        markSkipped(card);
        await store.appendActivity(card.id, formatLoopTriageSkippedEntry());
        return;
      }
      case 'record-triage': {
        // The fallback-triage agent set the assignee. It was asked to explain
        // its decision in the Activity log itself; only add the loop's generic
        // entry when it left no note, so the "why" is never missing but never
        // duplicated either.
        const record = session.triageRequests.get(card.id);
        session.triageRequests.delete(card.id);
        const decision: LoopTriageDecision = card.assignee?.kind === 'ai' ? 'ai' : 'human';
        const agentNote = (card.activity ?? '').slice(record?.activityBaseline ?? 0).trim();
        if (agentNote.length === 0) {
          await store.appendActivity(card.id, formatLoopTriageEntry(decision));
        }
        (decision === 'ai' ? summary.triagedToAi : summary.triagedToHuman).push(card.title);
        return;
      }
      case 'request-definition': {
        report(`Requesting a definition for "${card.title}"`);
        const result = await gateways.requestDefinition(card);
        if (control.isCancelled()) {
          return;
        }
        if (handoffStarted(result)) {
          session.definitionRequests.set(card.id, { requestedAt: now() });
          summary.definitionsRequested.push(card.title);
        } else {
          markSkipped(card);
        }
        return;
      }
      case 'dispatch': {
        report(`Dispatching "${card.title}"`);
        const result = await gateways.dispatchCard(card);
        if (control.isCancelled()) {
          return;
        }
        if (handoffStarted(result)) {
          session.dispatches.set(card.id, {
            columnId: action.column.id,
            activityBaseline: handoffActivityBaseline(result, (card.activity ?? '').length),
            dispatchedAt: now(),
          });
          summary.dispatched.push(card.title);
        } else {
          markSkipped(card);
        }
        return;
      }
    }
  }

  async function handVerificationToHuman(card: Card, reason: string): Promise<void> {
    report(`Handing "${card.title}" to a human for verification`);
    await store.setAssignee(card.id, { kind: 'human' });
    await store.appendActivity(card.id, formatLoopVerificationHandbackEntry(reason));
    session.verifications.delete(card.id);
    summary.parked.push(card.title);
  }
}

function handoffStarted(result: LoopHandoffResult): boolean {
  return typeof result === 'boolean' ? result : result.started;
}

function handoffActivityBaseline(result: LoopHandoffResult, fallback: number): number {
  return typeof result === 'boolean' ? fallback : result.activityBaseline ?? fallback;
}

function findCard(state: BoardState, cardId: string): Card | undefined {
  for (const column of state.columns) {
    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      return card;
    }
  }
  return undefined;
}

/** Prompt asking the AI whether an agent could implement the card autonomously. */
export function buildDoabilityPrompt(card: Card): string {
  return [
    'You are triaging a Methodology With No Name (MWNN) Kanban card.',
    'Decide whether an AI coding agent working inside this repository could IMPLEMENT the card autonomously (writing code, files, tests, running commands).',
    'Judge the implementation only. Every card is verified in the Verify column before Done, so a need for manual verification, testing sign-off, or review is NOT a reason to route the card to a person.',
    `Answer ${NEEDS_HUMAN_TOKEN} only when the implementation itself needs a person: product or design decisions the card leaves open, or manual/external steps an agent cannot perform (accounts, credentials, hardware, third-party approvals, physical actions).`,
    `When genuinely unsure, prefer ${DOABLE_TOKEN}.`,
    '',
    `Title: ${card.title}`,
    '',
    'Description:',
    card.description?.trim() || 'No description provided.',
    '',
    'Acceptance criteria:',
    card.acceptanceCriteria?.trim() || 'No acceptance criteria provided.',
    '',
    'Reply with a line `REASON: <one concise sentence explaining your decision>`,',
    `followed by exactly one word on the last line: ${DOABLE_TOKEN} or ${NEEDS_HUMAN_TOKEN}.`,
  ].join('\n');
}

/**
 * Fallback-triage hand-off prompt: the chat agent makes the AI-vs-Human call
 * and records it in the card file's frontmatter, where the loop picks it up.
 */
export function buildTriagePrompt(card: Card, cardFilePath: string): string {
  return [
    'You are triaging a Methodology With No Name (MWNN) Kanban card.',
    'Decide whether an AI coding agent working inside this repository could IMPLEMENT the card autonomously (writing code, files, tests, running commands).',
    'Judge the implementation only. Every card is verified in the Verify column before Done, so a need for manual verification, testing sign-off, or review is NOT a reason to assign the card to a human.',
    'Assign to human only when the implementation itself needs a person: product or design decisions the card leaves open, or manual/external steps an agent cannot perform (accounts, credentials, hardware, third-party approvals, physical actions). When genuinely unsure, prefer AI.',
    '',
    `This card is stored as a markdown file at: ${cardFilePath}`,
    'Record your decision by editing that file:',
    '  - In the frontmatter, add (or replace) the assignee line with exactly `assignee: { kind: ai }` if an AI agent can do it, or `assignee: { kind: human }` if it needs a person.',
    '  - Append a short entry to the "## Activity" section explaining WHY you decided AI or Human, in this shape:',
    '      ### <current ISO timestamp> - Triage decision',
    '      <one or two sentences explaining the decision>',
    '  - Do not change any other frontmatter, the title, or the other body sections.',
    '',
    `Title: ${card.title}`,
    '',
    'Description:',
    card.description?.trim() || 'No description provided.',
    '',
    'Acceptance criteria:',
    card.acceptanceCriteria?.trim() || 'No acceptance criteria provided.',
    '',
    'When you finish, report the result on its own line, exactly one of:',
    '  STATUS: DONE — the assignee was recorded.',
    '  STATUS: BLOCKED: <reason> — you could not decide and need a human.',
  ].join('\n');
}

/**
 * Extract the triage verdict (and the REASON line, when present) from a model
 * response; undefined when there is no verdict at all.
 */
export function parseDoabilityDecision(responseText: string): DoabilityVerdict | undefined {
  const doableIndex = responseText.lastIndexOf(DOABLE_TOKEN);
  const humanIndex = responseText.lastIndexOf(NEEDS_HUMAN_TOKEN);
  if (doableIndex === -1 && humanIndex === -1) {
    return undefined;
  }
  const decision: LoopTriageDecision = doableIndex > humanIndex ? 'ai' : 'human';
  const reason = /^\s*REASON:\s*(.+)$/im.exec(responseText)?.[1]?.trim();
  return reason ? { decision, reason } : { decision };
}

export function formatLoopParkEntry(timestamp: Date = new Date()): string {
  return [
    `### ${timestamp.toISOString()} - AI loop parked in Verify`,
    'Implementation finished; reassigned to Human for verification and sign-off.',
  ].join('\n');
}

export function formatLoopVerificationPassedEntry(
  columnTitle: string,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - AI loop verified this card`,
    `AI verification passed; moved to "${columnTitle}".`,
  ].join('\n');
}

export function formatLoopVerificationHandbackEntry(
  reason: string,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - AI loop handed verification to Human`,
    'The card remains in Verify and was reassigned to Human.',
    `Why: ${reason}`,
  ].join('\n');
}

export function formatLoopAdvanceEntry(columnTitle: string, timestamp: Date = new Date()): string {
  return [
    `### ${timestamp.toISOString()} - AI loop advanced this card`,
    `Moved to "${columnTitle}".`,
  ].join('\n');
}

export function formatLoopDefinedReadyEntry(
  columnTitle: string,
  forReview: boolean,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - AI loop placed this card in ${columnTitle}`,
    forReview
      ? `The definition was just filled in; moved to "${columnTitle}" to wait for a human to review the Description and Acceptance criteria before implementation starts.`
      : `The definition was just filled in; moved to "${columnTitle}" to continue through the board flow.`,
  ].join('\n');
}

export function formatLoopTriageEntry(
  decision: LoopTriageDecision,
  reason?: string,
  timestamp: Date = new Date(),
): string {
  const explanation =
    decision === 'ai'
      ? 'The AI judged this card doable by an agent and assigned it to AI.'
      : 'The AI judged this card as needing a person and assigned it to Human.';
  const lines = [`### ${timestamp.toISOString()} - AI loop triage`, explanation];
  lines.push(reason ? `Why: ${reason}` : 'No reason was recorded for this decision.');
  return lines.join('\n');
}

/** What each pending-wait kind is waiting on, phrased for the progress line. */
const WAIT_DESCRIPTIONS: Record<PendingWait['kind'], string> = {
  dispatch: 'the agent working on',
  definition: 'the definition of',
  triage: 'the triage decision on',
  verification: 'the AI verification of',
};

/** Compact elapsed-time label for the wait progress line, e.g. "45s", "17m", "2h 5m". */
function formatWaitDuration(elapsedMs: number): string {
  const totalMinutes = Math.floor(Math.max(0, elapsedMs) / 60_000);
  if (totalMinutes === 0) {
    return `${Math.floor(Math.max(0, elapsedMs) / 1000)}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatLoopTriageSkippedEntry(timestamp: Date = new Date()): string {
  return [
    `### ${timestamp.toISOString()} - AI loop could not triage this card`,
    'No language model was available for a direct doability decision and the chat hand-off failed, so the card was left unassigned. Assign it manually or re-run the loop.',
  ].join('\n');
}

export function formatTriageHandoffEntry(providerLabel: string, timestamp: Date = new Date()): string {
  return [
    `### ${timestamp.toISOString()} - Triage requested from ${providerLabel}`,
    `Asked ${providerLabel} to decide whether this card is doable by an AI agent and record the assignee.`,
  ].join('\n');
}
