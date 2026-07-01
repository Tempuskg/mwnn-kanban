/**
 * AI board loop: orchestrates AI-assigned cards across the whole board instead
 * of one hand-off at a time. Each pass over the board the loop
 *   - parks AI cards that reached the `verify` column and reassigns them to a
 *     human, so a person owns sign-off (the loop never moves cards into Done),
 *   - triages unassigned cards by asking the AI whether the card is doable by
 *     an agent (filling in the definition first when the card is title-only),
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
import { isCardBlocked } from './utils';
import type { Assignee, BoardState, Card, Column } from './types';

export type LoopTriageDecision = 'ai' | 'human';

/** Tokens the doability prompt asks for; parsing keys off these exact words. */
const DOABLE_TOKEN = 'DOABLE_BY_AI';
const NEEDS_HUMAN_TOKEN = 'NEEDS_HUMAN';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_WAIT_TIMEOUT_MS = 15 * 60_000;

/** Subset of the BoardStore the loop mutates through (never direct file writes). */
export interface LoopStore {
  reload(): Promise<BoardState>;
  moveCard(cardId: string, toColumnId: string, toIndex: number): Promise<unknown>;
  setAssignee(cardId: string, assignee: Assignee | undefined): Promise<unknown>;
  appendActivity(cardId: string, entry: string): Promise<unknown>;
}

/** The AI channels the loop drives; all fire-and-forget except the decision. */
export interface LoopGateways {
  /** Hand the card's implementation work to the chat agent. False = hand-off failed. */
  dispatchCard(card: Card): Promise<boolean>;
  /** Hand the card to the fill-with-AI definition flow. False = hand-off failed. */
  requestDefinition(card: Card): Promise<boolean>;
  /** Ask the AI whether an agent can do this card; undefined = no answer. */
  decideDoability(card: Card): Promise<LoopTriageDecision | undefined>;
}

export interface LoopControl {
  isCancelled(): boolean;
  delay(ms: number): Promise<void>;
}

export interface LoopOptions {
  /** How often to re-read the board while waiting on an agent. */
  readonly pollIntervalMs?: number;
  /** How long to wait for a dispatched agent before giving up on the card. */
  readonly waitTimeoutMs?: number;
  /** Clock override for tests. */
  readonly now?: () => number;
  /** Progress callback, e.g. for a notification's message line. */
  readonly onEvent?: (message: string) => void;
}

export interface LoopSummary {
  dispatched: string[];
  advanced: string[];
  parked: string[];
  triagedToAi: string[];
  triagedToHuman: string[];
  definitionsRequested: string[];
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

interface DefinitionRequestRecord {
  requestedAt: number;
}

export interface LoopSession {
  /** Cards the loop gave up on this run (failed hand-off, BLOCKED report, timeout, undecidable triage). */
  readonly skipped: Set<string>;
  readonly dispatches: Map<string, DispatchRecord>;
  readonly definitionRequests: Map<string, DefinitionRequestRecord>;
}

export function createLoopSession(): LoopSession {
  return { skipped: new Set(), dispatches: new Map(), definitionRequests: new Map() };
}

export type LoopAction =
  | { readonly kind: 'park'; readonly card: Card }
  | { readonly kind: 'advance'; readonly card: Card; readonly toColumn: Column }
  | { readonly kind: 'abandon'; readonly card: Card }
  | { readonly kind: 'triage'; readonly card: Card }
  | { readonly kind: 'request-definition'; readonly card: Card }
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
  return 'pending';
}

function isPreWorkColumn(column: Column): boolean {
  return column.role === 'backlog' || column.role === 'ready';
}

/**
 * Drop session records the board has since invalidated: a dispatch whose card
 * was moved out of the recorded column (or deleted), and a definition request
 * whose card vanished or was assigned by someone else in the meantime.
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
  for (const cardId of [...session.definitionRequests.keys()]) {
    const card = cardById.get(cardId);
    if (!card || card.assignee !== undefined) {
      session.definitionRequests.delete(cardId);
    }
  }
}

/**
 * Pick the next thing the loop should do, or undefined when nothing is
 * actionable right now. Actions that would open another chat hand-off
 * (dispatch, request-definition) are withheld while one is already pending, so
 * the loop drives at most one agent conversation at a time.
 */
export function planLoopAction(state: BoardState, session: LoopSession): LoopAction | undefined {
  const handoffPending = hasPendingHandoff(state, session);
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

      if (card.assignee === undefined) {
        // Triage happens anywhere before Verify; blocked cards may still be
        // triaged (assignment is not advancement).
        if (column.role === 'verify') {
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

      if (column.role === 'verify') {
        // Highest priority: hand finished work back to a person immediately.
        return { kind: 'park', card };
      }

      if (isCardBlocked(state, card.id)) {
        continue; // unfinished dependsOn — leave until dependencies complete
      }

      const record = session.dispatches.get(card.id);
      if (record) {
        const outcome = readDispatchOutcome(card, record);
        if (outcome === 'done') {
          if (nextColumn && nextColumn.role !== 'done') {
            return { kind: 'advance', card, toColumn: nextColumn };
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
        // Nothing to run in Backlog/Ready; the card trivially "completes" and
        // moves toward the work columns.
        if (nextColumn && nextColumn.role !== 'done') {
          firstPreWorkAdvance ??= { kind: 'advance', card, toColumn: nextColumn };
        }
        continue;
      }

      firstDispatch ??= { kind: 'dispatch', card, column };
    }
  }

  if (firstPreWorkAdvance) {
    return firstPreWorkAdvance;
  }
  if (firstTriage) {
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
  readonly kind: 'dispatch' | 'definition';
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
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const report = options.onEvent ?? ((): void => undefined);

  const session = createLoopSession();
  const summary: LoopSummary = {
    dispatched: [],
    advanced: [],
    parked: [],
    triagedToAi: [],
    triagedToHuman: [],
    definitionsRequested: [],
    skipped: [],
    cancelled: false,
  };

  const markSkipped = (card: Card): void => {
    session.skipped.add(card.id);
    session.dispatches.delete(card.id);
    session.definitionRequests.delete(card.id);
    summary.skipped.push(card.title);
  };

  while (!control.isCancelled()) {
    const state = await store.reload();
    pruneLoopSession(state, session);

    const action = planLoopAction(state, session);
    if (action) {
      await executeAction(action);
      continue;
    }

    const waits = listPendingWaits(state, session);
    if (waits.length === 0) {
      break; // nothing actionable and nothing in flight — the loop is done
    }

    const timedOut = waits.filter((wait) => now() - wait.startedAt > waitTimeoutMs);
    if (timedOut.length > 0) {
      for (const wait of timedOut) {
        const card = findCard(state, wait.cardId);
        if (card) {
          markSkipped(card);
          await store.appendActivity(card.id, formatLoopTimeoutEntry(wait.kind));
        } else {
          session.dispatches.delete(wait.cardId);
          session.definitionRequests.delete(wait.cardId);
        }
      }
      continue;
    }

    report(`Waiting on ${waits.length} card(s)…`);
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
      case 'advance': {
        report(`Advancing "${card.title}" to ${action.toColumn.title}`);
        await store.moveCard(card.id, action.toColumn.id, action.toColumn.cards.length);
        await store.appendActivity(card.id, formatLoopAdvanceEntry(action.toColumn.title));
        session.dispatches.delete(card.id);
        summary.advanced.push(card.title);
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
        const decision = await gateways.decideDoability(card);
        if (decision === undefined) {
          markSkipped(card);
          return;
        }
        await store.setAssignee(card.id, { kind: decision });
        await store.appendActivity(card.id, formatLoopTriageEntry(decision));
        (decision === 'ai' ? summary.triagedToAi : summary.triagedToHuman).push(card.title);
        return;
      }
      case 'request-definition': {
        report(`Requesting a definition for "${card.title}"`);
        if (await gateways.requestDefinition(card)) {
          session.definitionRequests.set(card.id, { requestedAt: now() });
          summary.definitionsRequested.push(card.title);
        } else {
          markSkipped(card);
        }
        return;
      }
      case 'dispatch': {
        report(`Dispatching "${card.title}"`);
        if (await gateways.dispatchCard(card)) {
          session.dispatches.set(card.id, {
            columnId: action.column.id,
            activityBaseline: (card.activity ?? '').length,
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

/** Prompt asking the AI whether an agent could complete the card autonomously. */
export function buildDoabilityPrompt(card: Card): string {
  return [
    'You are triaging a Methodology With No Name (MWNN) Kanban card.',
    'Decide whether an AI coding agent working inside this repository could complete the card autonomously (writing code, files, tests, running commands).',
    `Answer ${NEEDS_HUMAN_TOKEN} when the card needs product or design decisions, review or sign-off, or manual/external steps that require a person.`,
    '',
    `Title: ${card.title}`,
    '',
    'Description:',
    card.description?.trim() || 'No description provided.',
    '',
    'Acceptance criteria:',
    card.acceptanceCriteria?.trim() || 'No acceptance criteria provided.',
    '',
    `Reply with exactly one word on the last line: ${DOABLE_TOKEN} or ${NEEDS_HUMAN_TOKEN}.`,
  ].join('\n');
}

/** Extract the triage verdict from a model response; undefined when absent. */
export function parseDoabilityDecision(responseText: string): LoopTriageDecision | undefined {
  const doableIndex = responseText.lastIndexOf(DOABLE_TOKEN);
  const humanIndex = responseText.lastIndexOf(NEEDS_HUMAN_TOKEN);
  if (doableIndex === -1 && humanIndex === -1) {
    return undefined;
  }
  return doableIndex > humanIndex ? 'ai' : 'human';
}

export function formatLoopParkEntry(timestamp: Date = new Date()): string {
  return [
    `### ${timestamp.toISOString()} - AI loop parked in Verify`,
    'Implementation finished; reassigned to Human for verification and sign-off.',
  ].join('\n');
}

export function formatLoopAdvanceEntry(columnTitle: string, timestamp: Date = new Date()): string {
  return [
    `### ${timestamp.toISOString()} - AI loop advanced this card`,
    `Moved to "${columnTitle}".`,
  ].join('\n');
}

export function formatLoopTriageEntry(decision: LoopTriageDecision, timestamp: Date = new Date()): string {
  const explanation =
    decision === 'ai'
      ? 'The AI judged this card doable by an agent and assigned it to AI.'
      : 'The AI judged this card as needing a person and assigned it to Human.';
  return [`### ${timestamp.toISOString()} - AI loop triage`, explanation].join('\n');
}

export function formatLoopTimeoutEntry(kind: 'dispatch' | 'definition', timestamp: Date = new Date()): string {
  const what = kind === 'dispatch' ? 'the dispatched agent to finish' : 'the definition to be filled in';
  return [
    `### ${timestamp.toISOString()} - AI loop timed out`,
    `Gave up waiting for ${what}; the loop will not retry this card this run.`,
  ].join('\n');
}
