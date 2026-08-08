import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  buildDoabilityPrompt,
  buildTriagePrompt,
  createLoopSession,
  parseDoabilityDecision,
  planLoopAction,
  pruneLoopSession,
  runBoardLoop,
  type LoopControl,
  type LoopGateways,
  type LoopStore,
  type LoopTriageDecision,
} from '../../src/boardLoop';
import {
  addCard,
  appendActivity,
  cloneBoard,
  defaultBoard,
  enforceBlockedCardPlacement,
  moveCard,
  setAcceptanceCriteria,
  setAssignee,
  setColumnConfig,
  setDependencies,
  setDescription,
} from '../../src/utils';
import type { Assignee, BoardState, Card } from '../../src/types';

const FULL_COLUMNS = ['Backlog', 'Ready', 'In Progress', 'Verify', 'Done'] as const;

interface FakeBoard {
  store: LoopStore;
  getState(): BoardState;
  /** Simulate an external edit (e.g. an agent editing a card file). */
  mutate(apply: (state: BoardState) => BoardState): void;
  findCard(cardId: string): Card;
  columnTitleOf(cardId: string): string;
}

/** In-memory LoopStore over the real board mutation helpers. */
function fakeBoard(initial: BoardState): FakeBoard {
  let state = cloneBoard(initial);
  return {
    mutate(apply: (current: BoardState) => BoardState): void {
      state = apply(state);
    },
    store: {
      reload: async () => cloneBoard(state),
      moveCard: async (cardId, toColumnId, toIndex) => {
        state = enforceBlockedCardPlacement(moveCard(state, cardId, toColumnId, toIndex));
      },
      setAssignee: async (cardId, assignee: Assignee | undefined) => {
        state = setAssignee(state, cardId, assignee);
      },
      setAcceptanceCriteria: async (cardId, acceptanceCriteria) => {
        state = setAcceptanceCriteria(state, cardId, acceptanceCriteria);
      },
      appendActivity: async (cardId, entry) => {
        state = appendActivity(state, cardId, entry);
      },
    },
    getState: () => cloneBoard(state),
    findCard(cardId: string): Card {
      for (const column of state.columns) {
        const card = column.cards.find((candidate) => candidate.id === cardId);
        if (card) {
          return card;
        }
      }
      throw new Error(`card ${cardId} not found`);
    },
    columnTitleOf(cardId: string): string {
      const column = state.columns.find((candidate) => candidate.cards.some((card) => card.id === cardId));
      if (!column) {
        throw new Error(`card ${cardId} not on the board`);
      }
      return column.title;
    },
  };
}

function neverCancelled(): LoopControl {
  return { isCancelled: () => false, delay: async () => undefined };
}

interface GatewayLog {
  dispatched: string[];
  definitionsRequested: string[];
  triaged: string[];
  calls: string[];
}

/**
 * Gateways backed by the fake board: dispatch immediately "completes" the work
 * by appending a STATUS: DONE report, and requestDefinition fills the card in,
 * as the external agent would by editing the card file.
 */
function instantGateways(
  board: FakeBoard,
  decide: (card: Card) => LoopTriageDecision | undefined = () => 'ai',
): { gateways: LoopGateways; log: GatewayLog } {
  const log: GatewayLog = { dispatched: [], definitionsRequested: [], triaged: [], calls: [] };
  const gateways: LoopGateways = {
    dispatchCard: async (card) => {
      log.dispatched.push(card.id);
      log.calls.push(`dispatch:${card.id}`);
      await board.store.appendActivity(card.id, 'Did the work.\nSTATUS: DONE — the acceptance criteria are met.');
      return true;
    },
    requestDefinition: async (card) => {
      log.definitionsRequested.push(card.id);
      log.calls.push(`define:${card.id}`);
      // Simulate the fill-with-AI agent editing the card file.
      board.mutate((current) =>
        setAcceptanceCriteria(
          setDescription(current, card.id, 'Filled description'),
          card.id,
          '- [ ] Filled criterion',
        ),
      );
      return true;
    },
    decideDoability: async (card) => {
      log.triaged.push(card.id);
      log.calls.push(`triage:${card.id}`);
      const decision = decide(card);
      return decision ? { decision, reason: 'Deterministic test reason.' } : undefined;
    },
    requestTriage: async (card) => {
      log.calls.push(`request-triage:${card.id}`);
      return false;
    },
  };
  return { gateways, log };
}

function verificationGateways(
  verifyCard?: NonNullable<LoopGateways['verifyCard']>,
): LoopGateways {
  const gateways: LoopGateways = {
    dispatchCard: async () => false,
    requestDefinition: async () => false,
    decideDoability: async () => ({ decision: 'ai' }),
    requestTriage: async () => false,
  };
  return verifyCard ? { ...gateways, verifyCard } : gateways;
}

function boardWithCard(
  columnTitles: readonly string[],
  columnIndex: number,
  title: string,
  assignee?: Assignee,
): { state: BoardState; cardId: string } {
  let state = defaultBoard(columnTitles);
  const columnId = state.columns[columnIndex]!.id;
  state = addCard(state, columnId, title);
  const cardId = state.columns[columnIndex]!.cards[0]!.id;
  state = setDescription(state, cardId, 'A description');
  state = setAcceptanceCriteria(state, cardId, '- [ ] A criterion');
  if (assignee) {
    state = setAssignee(state, cardId, assignee);
  }
  return { state, cardId };
}

suite('board loop planning', () => {
  test('selects AI-assigned cards and never human-assigned ones', () => {
    let { state, cardId } = boardWithCard([...FULL_COLUMNS], 1, 'AI task', { kind: 'ai' });
    const humanColumnId = state.columns[1]!.id;
    state = addCard(state, humanColumnId, 'Human task');
    const humanCardId = state.columns[1]!.cards[1]!.id;
    state = setDescription(state, humanCardId, 'Owned by a person');
    state = setAcceptanceCriteria(state, humanCardId, '- [ ] Done by hand');
    state = setAssignee(state, humanCardId, { kind: 'human', name: 'Darren' });

    const action = planLoopAction(state, createLoopSession());
    assert.equal(action?.kind, 'advance');
    assert.equal(action?.card.id, cardId);
  });

  test('does not advance a card into a full WIP column', () => {
    let { state, cardId } = boardWithCard([...FULL_COLUMNS], 1, 'Ready task', { kind: 'ai' });
    const inProgressColumnId = state.columns[2]!.id;
    state = addCard(state, inProgressColumnId, 'Existing implementation');
    const existingCardId = state.columns[2]!.cards[0]!.id;
    state = setDescription(state, existingCardId, 'Already owned by a person');
    state = setAcceptanceCriteria(state, existingCardId, '- [ ] Manual criterion');
    state = setAssignee(state, existingCardId, { kind: 'human' });
    state = setColumnConfig(state, inProgressColumnId, { wipLimit: 1 });

    assert.equal(planLoopAction(state, createLoopSession()), undefined);
    assert.equal(state.columns[1]!.cards[0]!.id, cardId);
  });

  test('replenishes Ready before starting implementation when reverse WIP is underfilled', () => {
    let { state, cardId: readyCardId } = boardWithCard([...FULL_COLUMNS], 1, 'Ready task', { kind: 'ai' });
    const backlogColumnId = state.columns[0]!.id;
    state = addCard(state, backlogColumnId, 'Backlog task');
    const backlogCardId = state.columns[0]!.cards[0]!.id;
    state = setDescription(state, backlogCardId, 'Ready to implement');
    state = setAcceptanceCriteria(state, backlogCardId, '- [ ] Backlog criterion');
    state = setAssignee(state, backlogCardId, { kind: 'ai' });
    state = setColumnConfig(state, state.columns[1]!.id, { reverseWip: 2 });

    const action = planLoopAction(state, createLoopSession());

    assert.equal(action?.kind, 'advance');
    assert.equal(action?.card.id, backlogCardId);
    assert.equal(action?.kind === 'advance' ? action.toColumn.role : undefined, 'ready');
    assert.notEqual(action?.card.id, readyCardId);
  });

  test('allows implementation when Ready reverse WIP is met', () => {
    let { state, cardId: firstReadyCardId } = boardWithCard([...FULL_COLUMNS], 1, 'First ready task', { kind: 'ai' });
    state = addCard(state, state.columns[1]!.id, 'Second ready task');
    const secondReadyCardId = state.columns[1]!.cards[1]!.id;
    state = setDescription(state, secondReadyCardId, 'Defined too');
    state = setAcceptanceCriteria(state, secondReadyCardId, '- [ ] Another criterion');
    state = setAssignee(state, secondReadyCardId, { kind: 'ai' });
    state = addCard(state, state.columns[0]!.id, 'Human backlog task');
    const humanBacklogCardId = state.columns[0]!.cards[0]!.id;
    state = setDescription(state, humanBacklogCardId, 'Needs a person');
    state = setAssignee(state, humanBacklogCardId, { kind: 'human' });
    state = setColumnConfig(state, state.columns[1]!.id, { reverseWip: 2 });

    const action = planLoopAction(state, createLoopSession());

    assert.equal(action?.kind, 'advance');
    assert.equal(action?.card.id, firstReadyCardId);
    assert.equal(action?.kind === 'advance' ? action.toColumn.role : undefined, 'in-progress');
  });

  test('allows implementation when the backlog has no available cards', () => {
    let { state, cardId } = boardWithCard([...FULL_COLUMNS], 1, 'Last ready task', { kind: 'ai' });
    state = setColumnConfig(state, state.columns[1]!.id, { reverseWip: 2 });

    const action = planLoopAction(state, createLoopSession());

    assert.equal(action?.kind, 'advance');
    assert.equal(action?.card.id, cardId);
    assert.equal(action?.kind === 'advance' ? action.toColumn.role : undefined, 'in-progress');
  });

  test('skips cards with unfinished dependencies', () => {
    let { state, cardId } = boardWithCard([...FULL_COLUMNS], 1, 'Dependent task', { kind: 'ai' });
    const backlogId = state.columns[0]!.id;
    state = addCard(state, backlogId, 'Prerequisite');
    const prereqId = state.columns[0]!.cards[0]!.id;
    state = setAssignee(state, prereqId, { kind: 'human' });
    state = setDependencies(state, cardId, [prereqId]);

    assert.equal(planLoopAction(state, createLoopSession()), undefined);

    // Once the prerequisite is done, the card becomes eligible again.
    const doneId = state.columns[4]!.id;
    state = moveCard(state, prereqId, doneId, 0);
    assert.equal(planLoopAction(state, createLoopSession())?.card.id, cardId);
  });

  test('parks AI cards sitting in the verify column', () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 3, 'Awaiting sign-off', { kind: 'ai' });
    const action = planLoopAction(state, createLoopSession());
    assert.equal(action?.kind, 'park');
    assert.equal(action?.card.id, cardId);
  });

  test('parks AI cards in a legacy custom column titled Verify', () => {
    const { state: initialState, cardId } = boardWithCard([...FULL_COLUMNS], 3, 'Legacy verification', { kind: 'ai' });
    const state: BoardState = {
      ...initialState,
      columns: initialState.columns.map((column) =>
        column.title === 'Verify' ? { ...column, role: 'custom' as const } : column,
      ),
    };

    const action = planLoopAction(state, createLoopSession());
    assert.equal(action?.kind, 'park');
    assert.equal(action?.card.id, cardId);
  });

  test('prioritizes an opt-in verification hand-off over triage, definition, and dispatch', () => {
    let state = defaultBoard([...FULL_COLUMNS]);

    state = addCard(state, state.columns[0]!.id, 'Needs triage');
    const triageId = state.columns[0]!.cards[0]!.id;
    state = setDescription(state, triageId, 'Defined but unassigned');
    state = setAcceptanceCriteria(state, triageId, '- [ ] Decide ownership');

    state = addCard(state, state.columns[0]!.id, 'Needs definition');

    state = addCard(state, state.columns[2]!.id, 'Needs implementation');
    const implementationId = state.columns[2]!.cards[0]!.id;
    state = setDescription(state, implementationId, 'Implementation work');
    state = setAcceptanceCriteria(state, implementationId, '- [ ] Implemented');
    state = setAssignee(state, implementationId, { kind: 'ai' });

    state = addCard(state, state.columns[3]!.id, 'Needs verification');
    const verificationId = state.columns[3]!.cards[0]!.id;
    state = setDescription(state, verificationId, 'Finished implementation');
    state = setAcceptanceCriteria(state, verificationId, '- [x] Implemented');
    state = setAssignee(state, verificationId, { kind: 'ai' });

    const action = planLoopAction(state, createLoopSession(), { verifyWithAi: true });

    assert.equal(action?.kind, 'verify');
    assert.equal(action?.card.id, verificationId);
  });

  test('does not plan verification while another hand-off is pending or repeat one in flight', () => {
    let { state, cardId: implementationId } = boardWithCard(
      [...FULL_COLUMNS],
      2,
      'Agent still implementing',
      { kind: 'ai' },
    );
    state = addCard(state, state.columns[3]!.id, 'Awaiting AI verification');
    const verificationId = state.columns[3]!.cards[0]!.id;
    state = setDescription(state, verificationId, 'Finished implementation');
    state = setAcceptanceCriteria(state, verificationId, '- [x] Complete');
    state = setAssignee(state, verificationId, { kind: 'ai' });

    const busySession = createLoopSession();
    busySession.dispatches.set(implementationId, {
      columnId: state.columns[2]!.id,
      activityBaseline: 0,
      dispatchedAt: 0,
    });
    assert.equal(
      planLoopAction(state, busySession, { verifyWithAi: true }),
      undefined,
      'an implementation hand-off blocks a new verification hand-off',
    );

    const verifyingSession = createLoopSession();
    verifyingSession.verifications.set(verificationId, {
      columnId: state.columns[3]!.id,
      activityBaseline: 0,
      requestedAt: 0,
    });
    assert.equal(
      planLoopAction(state, verifyingSession, { verifyWithAi: true }),
      undefined,
      'a pending verification is not requested a second time',
    );
  });

  test('prunes verification records when their card moves or is deleted', () => {
    let { state, cardId: movedId } = boardWithCard([...FULL_COLUMNS], 3, 'Moved verification', { kind: 'ai' });
    state = addCard(state, state.columns[3]!.id, 'Deleted verification');
    const deletedId = state.columns[3]!.cards[1]!.id;
    const verifyColumnId = state.columns[3]!.id;
    const session = createLoopSession();
    session.verifications.set(movedId, {
      columnId: verifyColumnId,
      activityBaseline: 0,
      requestedAt: 0,
    });
    session.verifications.set(deletedId, {
      columnId: verifyColumnId,
      activityBaseline: 0,
      requestedAt: 0,
    });

    state = moveCard(state, movedId, state.columns[4]!.id, 0);
    state = {
      ...state,
      columns: state.columns.map((column) => ({
        ...column,
        cards: column.cards.filter((card) => card.id !== deletedId),
      })),
    };
    pruneLoopSession(state, session);

    assert.equal(session.verifications.size, 0);
  });

  test('never plans an advance into the done column', () => {
    // No verify column between In Progress and Done.
    const { state, cardId } = boardWithCard(['Backlog', 'In Progress', 'Done'], 1, 'Work item', { kind: 'ai' });
    const session = createLoopSession();

    const dispatch = planLoopAction(state, session);
    assert.equal(dispatch?.kind, 'dispatch');

    session.dispatches.set(cardId, {
      columnId: state.columns[1]!.id,
      activityBaseline: 0,
      dispatchedAt: 0,
    });
    const withDone = appendActivity(state, cardId, 'STATUS: DONE — finished.');
    const next = planLoopAction(withDone, session);
    assert.equal(next?.kind, 'abandon');
  });

  test('leaves completed work in place when the next column is at its WIP limit', () => {
    let { state, cardId } = boardWithCard([...FULL_COLUMNS], 2, 'Completed implementation', { kind: 'ai' });
    const verifyColumnId = state.columns[3]!.id;
    state = addCard(state, verifyColumnId, 'Existing verification');
    const existingCardId = state.columns[3]!.cards[0]!.id;
    state = setDescription(state, existingCardId, 'Already waiting for a human');
    state = setAssignee(state, existingCardId, { kind: 'human' });
    state = setColumnConfig(state, verifyColumnId, { wipLimit: 1 });
    const session = createLoopSession();
    session.dispatches.set(cardId, {
      columnId: state.columns[2]!.id,
      activityBaseline: 0,
      dispatchedAt: 0,
    });

    const withDone = appendActivity(state, cardId, 'STATUS: DONE - finished.');

    assert.equal(planLoopAction(withDone, session), undefined);
    assert.equal(withDone.columns[2]!.cards[0]!.id, cardId);
  });
});

suite('board loop run', () => {
  test('advances an AI card column by column, parks it in Verify, and reassigns to Human', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 0, 'Build the feature', { kind: 'ai' });
    const board = fakeBoard(state);
    const { gateways, log } = instantGateways(board);

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.equal(board.columnTitleOf(cardId), 'Verify');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
    // Dispatched exactly once: in the In Progress work column.
    assert.deepEqual(log.dispatched, [cardId]);
    assert.equal(summary.parked.length, 1);
    assert.equal(summary.cancelled, false);
    assert.match(board.findCard(cardId).activity ?? '', /AI loop parked in Verify/);
    assert.match(board.findCard(cardId).activity ?? '', /AI loop advanced this card/);
    assert.equal(board.findCard(cardId).acceptanceCriteria, '- [x] A criterion');
  });

  test('uses completed acceptance criteria and a legacy Verify title to finish a hand-off', async () => {
    const { state: initialState, cardId } = boardWithCard([...FULL_COLUMNS], 2, 'Already implemented', { kind: 'ai' });
    const state: BoardState = {
      ...initialState,
      columns: initialState.columns.map((column) =>
        column.title === 'Verify' ? { ...column, role: 'custom' as const } : column,
      ),
    };
    const board = fakeBoard({
      ...state,
      columns: state.columns.map((column) =>
        column.cards.some((card) => card.id === cardId)
          ? {
              ...column,
              cards: column.cards.map((card) =>
                card.id === cardId ? { ...card, acceptanceCriteria: '- [x] The implementation is complete' } : card,
              ),
            }
          : column,
      ),
    });
    const gateways: LoopGateways = {
      dispatchCard: async () => true,
      requestDefinition: async () => true,
      requestTriage: async () => false,
      decideDoability: async () => ({ decision: 'ai' as const }),
    };

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.equal(summary.skipped.length, 0);
    assert.equal(board.columnTitleOf(cardId), 'Verify');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
    assert.equal(summary.parked.length, 1);
  });

  test('leaves human-assigned cards untouched and terminates', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 1, 'Manual task', { kind: 'human' });
    const board = fakeBoard(state);
    const { gateways, log } = instantGateways(board);

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.equal(board.columnTitleOf(cardId), 'Ready');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
    assert.deepEqual(log.calls, []);
    assert.equal(summary.cancelled, false);
  });

  test('triages a defined unassigned card to AI and then runs it to Verify', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 0, 'Automatable task');
    const board = fakeBoard(state);
    const { gateways, log } = instantGateways(board, () => 'ai');

    await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.deepEqual(log.triaged, [cardId]);
    assert.equal(board.columnTitleOf(cardId), 'Verify');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
    assert.match(board.findCard(cardId).activity ?? '', /AI loop triage/);
  });

  test('triages a defined unassigned card to Human and leaves it in place', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 0, 'Needs judgment');
    const board = fakeBoard(state);
    const { gateways, log } = instantGateways(board, () => 'human');

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.deepEqual(log.triaged, [cardId]);
    assert.deepEqual(log.dispatched, []);
    assert.equal(board.columnTitleOf(cardId), 'Backlog');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
    assert.deepEqual(summary.triagedToHuman.length, 1);
  });

  test('falls back to a chat-handoff triage when no direct decision channel exists', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 0, 'Automatable, no LM');
    const board = fakeBoard(state);
    const calls: string[] = [];
    const gateways: LoopGateways = {
      dispatchCard: async (card) => {
        calls.push(`dispatch:${card.id}`);
        await board.store.appendActivity(card.id, 'STATUS: DONE — done.');
        return true;
      },
      requestDefinition: async () => true,
      decideDoability: async (card) => {
        calls.push(`decide:${card.id}`);
        return undefined; // e.g. vscode.lm has no models available
      },
      requestTriage: async (card) => {
        calls.push(`request-triage:${card.id}`);
        return true;
      },
    };

    // The agent works asynchronously: after the hand-off it records its
    // decision in the card file — assignee plus an explanatory Activity note.
    const controlWithAgent: LoopControl = {
      isCancelled: () => false,
      delay: async () => {
        if (board.findCard(cardId).assignee === undefined && calls.includes(`request-triage:${cardId}`)) {
          board.mutate((current) =>
            setAssignee(
              appendActivity(current, cardId, '### now - Triage decision\nPure refactoring work, an agent can do it.'),
              cardId,
              { kind: 'ai' },
            ),
          );
        }
      },
    };

    const summary = await runBoardLoop(board.store, gateways, controlWithAgent, { pollIntervalMs: 0 });

    assert.deepEqual(
      calls.slice(0, 2),
      [`decide:${cardId}`, `request-triage:${cardId}`],
      'direct decision is tried first, then the chat hand-off fallback',
    );
    assert.equal(summary.triagedToAi.length, 1);
    // The triaged-to-AI card then flowed through the loop to Verify as usual.
    assert.equal(board.columnTitleOf(cardId), 'Verify');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
    const activity = board.findCard(cardId).activity ?? '';
    // The agent's own reasoning is preserved and the loop does not duplicate
    // it with its generic triage entry.
    assert.match(activity, /Pure refactoring work, an agent can do it\./);
    assert.doesNotMatch(activity, /AI loop triage/);
  });

  test('adds a generic triage entry when the fallback agent records no reason', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 0, 'Silently triaged');
    const board = fakeBoard(state);
    const gateways: LoopGateways = {
      dispatchCard: async () => false,
      requestDefinition: async () => true,
      decideDoability: async () => undefined,
      requestTriage: async (card) => {
        // Agent sets the assignee but never explains itself.
        board.mutate((current) => setAssignee(current, card.id, { kind: 'human' }));
        return true;
      },
    };

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.equal(summary.triagedToHuman.length, 1);
    const activity = board.findCard(cardId).activity ?? '';
    assert.match(activity, /AI loop triage/);
    assert.match(activity, /needing a person and assigned it to Human/);
    assert.match(activity, /No reason was recorded for this decision\./);
  });

  test('skips with an observable activity entry when no triage channel works', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 0, 'Untriageable');
    const board = fakeBoard(state);
    const gateways: LoopGateways = {
      dispatchCard: async () => true,
      requestDefinition: async () => true,
      decideDoability: async () => undefined,
      requestTriage: async () => false,
    };

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.equal(summary.skipped.length, 1);
    assert.equal(board.findCard(cardId).assignee, undefined);
    assert.equal(board.columnTitleOf(cardId), 'Backlog');
    assert.match(board.findCard(cardId).activity ?? '', /AI loop could not triage this card/);
  });

  test('fills the definition before triaging a title-only unassigned card', async () => {
    let state = defaultBoard([...FULL_COLUMNS]);
    state = addCard(state, state.columns[0]!.id, 'Bare title card');
    const cardId = state.columns[0]!.cards[0]!.id;

    const board = fakeBoard(state);
    const { gateways, log } = instantGateways(board, () => 'human');

    await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.deepEqual(log.calls, [`define:${cardId}`, `triage:${cardId}`]);
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
  });

  test('by default a card defined from the Backlog continues on to implementation in the same run', async () => {
    let state = defaultBoard([...FULL_COLUMNS]);
    state = addCard(state, state.columns[0]!.id, 'Title-only idea');
    const cardId = state.columns[0]!.cards[0]!.id;

    const board = fakeBoard(state);
    const { gateways, log } = instantGateways(board, () => 'ai');

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    // Defined in Backlog, placed in Ready, then implemented and parked in
    // Verify for human sign-off — all within this run.
    assert.deepEqual(log.calls, [`define:${cardId}`, `triage:${cardId}`, `dispatch:${cardId}`]);
    assert.equal(summary.movedToReady.length, 1);
    assert.equal(board.columnTitleOf(cardId), 'Verify');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
    const activity = board.findCard(cardId).activity ?? '';
    assert.match(activity, /AI loop placed this card in Ready/);
    assert.match(activity, /continue through the board flow/);
  });

  test('with reviewFreshDefinitions, a card defined from the Backlog lands in Ready and is not dispatched that run', async () => {
    let state = defaultBoard([...FULL_COLUMNS]);
    state = addCard(state, state.columns[1]!.id, 'Already waiting in Ready');
    const existingReadyCardId = state.columns[1]!.cards[0]!.id;
    state = setDescription(state, existingReadyCardId, 'Defined');
    state = setAcceptanceCriteria(state, existingReadyCardId, '- [ ] Criterion');
    state = setAssignee(state, existingReadyCardId, { kind: 'human' });
    state = addCard(state, state.columns[0]!.id, 'Title-only idea');
    const cardId = state.columns[0]!.cards[0]!.id;

    const board = fakeBoard(state);
    // Triage says AI — the freshly defined card must still stop in Ready.
    const { gateways, log } = instantGateways(board, () => 'ai');

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), {
      pollIntervalMs: 0,
      reviewFreshDefinitions: true,
    });

    assert.deepEqual(log.calls, [`define:${cardId}`, `triage:${cardId}`]);
    assert.deepEqual(log.dispatched, []);
    assert.equal(board.columnTitleOf(cardId), 'Ready');
    // Placed at the end of Ready, after the card that was already there.
    assert.deepEqual(
      board.getState().columns[1]!.cards.map((card) => card.id),
      [existingReadyCardId, cardId],
    );
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'ai' });
    assert.equal(summary.movedToReady.length, 1);
    assert.match(board.findCard(cardId).activity ?? '', /AI loop placed this card in Ready/);
  });

  test('with reviewFreshDefinitions, a card defined while sitting in Ready stays in Ready without a move', async () => {
    let state = defaultBoard([...FULL_COLUMNS]);
    state = addCard(state, state.columns[1]!.id, 'Undefined in Ready');
    const cardId = state.columns[1]!.cards[0]!.id;

    const board = fakeBoard(state);
    const { gateways, log } = instantGateways(board, () => 'ai');

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), {
      pollIntervalMs: 0,
      reviewFreshDefinitions: true,
    });

    assert.deepEqual(log.calls, [`define:${cardId}`, `triage:${cardId}`]);
    assert.deepEqual(log.dispatched, []);
    assert.equal(board.columnTitleOf(cardId), 'Ready');
    assert.equal(summary.movedToReady.length, 0);
    assert.doesNotMatch(board.findCard(cardId).activity ?? '', /AI loop advanced this card/);
  });

  test('with reviewFreshDefinitions, a freshly defined card stays put when the board has no Ready column', async () => {
    let state = defaultBoard(['Backlog', 'In Progress', 'Verify', 'Done']);
    state = addCard(state, state.columns[0]!.id, 'No Ready column here');
    const cardId = state.columns[0]!.cards[0]!.id;

    const board = fakeBoard(state);
    const { gateways, log } = instantGateways(board, () => 'ai');

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), {
      pollIntervalMs: 0,
      reviewFreshDefinitions: true,
    });

    assert.equal(board.columnTitleOf(cardId), 'Backlog');
    assert.deepEqual(log.dispatched, []);
    assert.equal(summary.movedToReady.length, 0);
    assert.equal(summary.cancelled, false);
  });

  test('does not advance blocked cards', async () => {
    let { state, cardId } = boardWithCard([...FULL_COLUMNS], 1, 'Blocked work', { kind: 'ai' });
    state = addCard(state, state.columns[0]!.id, 'Unfinished prerequisite');
    const prereqId = state.columns[0]!.cards[0]!.id;
    state = setAssignee(state, prereqId, { kind: 'human' });
    state = setDependencies(state, cardId, [prereqId]);

    const board = fakeBoard(state);
    const { gateways, log } = instantGateways(board);

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.equal(board.columnTitleOf(cardId), 'Ready');
    assert.deepEqual(log.dispatched, []);
    assert.equal(summary.cancelled, false);
  });

  test('reassigns a card already sitting in Verify to Human without moving it to Done', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 3, 'Finished work', { kind: 'ai' });
    const board = fakeBoard(state);
    const { gateways, log } = instantGateways(board);

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.equal(board.columnTitleOf(cardId), 'Verify');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
    assert.deepEqual(log.dispatched, []);
    assert.deepEqual(summary.parked.length, 1);
  });

  test('with AI verification enabled, VERIFY: PASS moves the card to the end of Done', async () => {
    let { state, cardId } = boardWithCard([...FULL_COLUMNS], 3, 'Verified work', { kind: 'ai' });
    const doneColumnId = state.columns[4]!.id;
    state = addCard(state, doneColumnId, 'Already done');
    const existingDoneId = state.columns[4]!.cards[0]!.id;
    state = setAssignee(state, existingDoneId, { kind: 'human' });
    const board = fakeBoard(state);
    let verificationCalls = 0;
    const gateways = verificationGateways(async (card) => {
      verificationCalls += 1;
      await board.store.appendActivity(card.id, 'Checked the workspace and tests.\nVERIFY: PASS');
      return true;
    });

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), {
      pollIntervalMs: 0,
      verifyWithAi: true,
    });

    assert.equal(verificationCalls, 1);
    assert.equal(board.columnTitleOf(cardId), 'Done');
    assert.deepEqual(
      board.getState().columns[4]!.cards.map((card) => card.id),
      [existingDoneId, cardId],
    );
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'ai' });
    assert.deepEqual(summary.verified, ['Verified work']);
    assert.deepEqual(summary.verificationsRequested, ['Verified work']);
    assert.equal(summary.parked.length, 0);
    assert.match(board.findCard(cardId).activity ?? '', /AI loop verified this card/);
    assert.match(board.findCard(cardId).activity ?? '', /moved to "Done"/);
  });

  test('VERIFY: FAIL and VERIFY: HUMAN leave the card in Verify with the agent reason', async () => {
    const cases = [
      { marker: 'VERIFY: FAIL: The focused test still fails.', reason: 'The focused test still fails.' },
      { marker: 'VERIFY: HUMAN: Visual sign-off is required.', reason: 'Visual sign-off is required.' },
    ] as const;

    for (const verificationCase of cases) {
      const { state, cardId } = boardWithCard([...FULL_COLUMNS], 3, verificationCase.marker, { kind: 'ai' });
      const board = fakeBoard(state);
      const gateways = verificationGateways(async (card) => {
        await board.store.appendActivity(card.id, verificationCase.marker);
        return true;
      });

      const summary = await runBoardLoop(board.store, gateways, neverCancelled(), {
        pollIntervalMs: 0,
        verifyWithAi: true,
      });

      assert.equal(board.columnTitleOf(cardId), 'Verify');
      assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
      assert.equal(summary.verified.length, 0);
      assert.equal(summary.parked.length, 1);
      assert.ok((board.findCard(cardId).activity ?? '').includes(`Why: ${verificationCase.reason}`));
    }
  });

  test('AI verification enabled without a gateway safely hands the card to Human', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 3, 'No verifier available', { kind: 'ai' });
    const board = fakeBoard(state);

    const summary = await runBoardLoop(board.store, verificationGateways(), neverCancelled(), {
      pollIntervalMs: 0,
      verifyWithAi: true,
    });

    assert.equal(board.columnTitleOf(cardId), 'Verify');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
    assert.equal(summary.parked.length, 1);
    assert.equal(summary.skipped.length, 0);
    assert.match(board.findCard(cardId).activity ?? '', /No AI verification gateway is available/);
  });

  test('a verification hand-off that fails to start hands the card to Human instead of skipping it', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 3, 'Verifier failed to launch', { kind: 'ai' });
    const board = fakeBoard(state);
    let attempts = 0;
    const gateways = verificationGateways(async () => {
      attempts += 1;
      return false;
    });

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), {
      pollIntervalMs: 0,
      verifyWithAi: true,
    });

    assert.equal(attempts, 1);
    assert.equal(board.columnTitleOf(cardId), 'Verify');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
    assert.equal(summary.parked.length, 1);
    assert.equal(summary.skipped.length, 0);
    assert.equal(summary.verificationsRequested.length, 0);
    assert.match(board.findCard(cardId).activity ?? '', /hand-off could not be started/);
  });

  test('a passing verdict without available Done capacity hands the card to Human in Verify', async () => {
    const noDone = boardWithCard(['Backlog', 'Verify'], 1, 'Board has no Done', { kind: 'ai' });
    const noDoneBoard = fakeBoard(noDone.state);
    const noDoneSummary = await runBoardLoop(
      noDoneBoard.store,
      verificationGateways(async (card) => {
        await noDoneBoard.store.appendActivity(card.id, 'VERIFY: PASS');
        return true;
      }),
      neverCancelled(),
      { pollIntervalMs: 0, verifyWithAi: true },
    );

    assert.equal(noDoneBoard.columnTitleOf(noDone.cardId), 'Verify');
    assert.deepEqual(noDoneBoard.findCard(noDone.cardId).assignee, { kind: 'human' });
    assert.equal(noDoneSummary.parked.length, 1);
    assert.match(noDoneBoard.findCard(noDone.cardId).activity ?? '', /no Done column/);

    let fullDone = boardWithCard([...FULL_COLUMNS], 3, 'Done is full', { kind: 'ai' });
    const doneColumnId = fullDone.state.columns[4]!.id;
    fullDone.state = addCard(fullDone.state, doneColumnId, 'Occupies Done');
    fullDone.state = setColumnConfig(fullDone.state, doneColumnId, { wipLimit: 1 });
    const fullDoneBoard = fakeBoard(fullDone.state);
    const fullDoneSummary = await runBoardLoop(
      fullDoneBoard.store,
      verificationGateways(async (card) => {
        await fullDoneBoard.store.appendActivity(card.id, 'VERIFY: PASS');
        return true;
      }),
      neverCancelled(),
      { pollIntervalMs: 0, verifyWithAi: true },
    );

    assert.equal(fullDoneBoard.columnTitleOf(fullDone.cardId), 'Verify');
    assert.deepEqual(fullDoneBoard.findCard(fullDone.cardId).assignee, { kind: 'human' });
    assert.equal(fullDoneSummary.parked.length, 1);
    assert.match(fullDoneBoard.findCard(fullDone.cardId).activity ?? '', /Done.*WIP limit/);
  });

  test('skips a card whose agent reports BLOCKED', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 2, 'Tricky work', { kind: 'ai' });
    const board = fakeBoard(state);
    const log: string[] = [];
    const gateways: LoopGateways = {
      dispatchCard: async (card) => {
        log.push(card.id);
        await board.store.appendActivity(card.id, 'STATUS: BLOCKED: need credentials.');
        return true;
      },
      requestDefinition: async () => true,
      requestTriage: async () => false,
      decideDoability: async () => ({ decision: 'ai' as const }),
    };

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.deepEqual(log, [cardId]);
    assert.equal(board.columnTitleOf(cardId), 'In Progress');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'ai' });
    assert.equal(board.findCard(cardId).acceptanceCriteria, '- [ ] A criterion');
    assert.equal(summary.skipped.length, 1);
  });

  test('skips a card when the hand-off fails instead of retrying forever', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 2, 'Undeliverable', { kind: 'ai' });
    const board = fakeBoard(state);
    let attempts = 0;
    const gateways: LoopGateways = {
      dispatchCard: async () => {
        attempts += 1;
        return false;
      },
      requestDefinition: async () => true,
      requestTriage: async () => false,
      decideDoability: async () => ({ decision: 'ai' as const }),
    };

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.equal(attempts, 1);
    assert.equal(board.columnTitleOf(cardId), 'In Progress');
    assert.equal(summary.skipped.length, 1);
  });

  test('uses a synchronous CLI hand-off baseline and applies the normal board transition', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 2, 'CLI-completed work', { kind: 'ai' });
    const board = fakeBoard(state);
    const gateways: LoopGateways = {
      dispatchCard: async (card) => {
        await board.store.appendActivity(card.id, 'CLI handoff started.');
        const activityBaseline = (board.findCard(card.id).activity ?? '').length;
        await board.store.appendActivity(card.id, 'CLI finished the work.\nSTATUS: DONE');
        return { started: true, activityBaseline };
      },
      requestDefinition: async () => true,
      requestTriage: async () => false,
      decideDoability: async () => ({ decision: 'ai' as const }),
    };

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.equal(summary.skipped.length, 0);
    assert.equal(summary.advanced.length, 1);
    assert.equal(board.columnTitleOf(cardId), 'Verify');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
    assert.equal(board.findCard(cardId).acceptanceCriteria, '- [x] A criterion');
  });

  test('cancelling while a synchronous gateway is active leaves the card recoverable', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 2, 'Cancelled CLI work', { kind: 'ai' });
    const board = fakeBoard(state);
    let cancelled = false;
    const gateways: LoopGateways = {
      dispatchCard: async () => {
        cancelled = true;
        return { started: false };
      },
      requestDefinition: async () => true,
      requestTriage: async () => false,
      decideDoability: async () => ({ decision: 'ai' as const }),
    };
    const control: LoopControl = {
      isCancelled: () => cancelled,
      delay: async () => undefined,
    };

    const summary = await runBoardLoop(board.store, gateways, control, { pollIntervalMs: 0 });

    assert.equal(summary.cancelled, true);
    assert.equal(summary.skipped.length, 0);
    assert.equal(board.columnTitleOf(cardId), 'In Progress');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'ai' });
  });

  test('stops when cancelled and reports it', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 0, 'Long task', { kind: 'ai' });
    const board = fakeBoard(state);
    const { gateways } = instantGateways(board);

    let steps = 0;
    const control: LoopControl = {
      isCancelled: () => steps > 0,
      delay: async () => undefined,
    };
    const summary = await runBoardLoop(board.store, gateways, control, {
      pollIntervalMs: 0,
      onEvent: () => {
        steps += 1;
      },
    });

    assert.equal(summary.cancelled, true);
    // The card never reached Verify because the loop stopped early.
    assert.notEqual(board.columnTitleOf(cardId), 'Verify');
  });

  test('waits far past the old 15-minute limit and still advances on a late STATUS: DONE', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 2, 'Slow agent', { kind: 'ai' });
    const board = fakeBoard(state);
    const gateways: LoopGateways = {
      dispatchCard: async () => true, // the agent reports back much later, via the clock below
      requestDefinition: async () => true,
      requestTriage: async () => false,
      decideDoability: async () => ({ decision: 'ai' as const }),
    };

    // Each poll advances the clock by 10 minutes; the agent reports DONE only
    // after 50 minutes — well past the removed 15-minute timeout.
    let clock = 0;
    const control: LoopControl = {
      isCancelled: () => false,
      delay: async () => {
        clock += 10 * 60_000;
        if (clock >= 50 * 60_000 && board.findCard(cardId).assignee?.kind === 'ai') {
          board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE — finally finished.'));
        }
      },
    };

    const messages: string[] = [];
    const summary = await runBoardLoop(board.store, gateways, control, {
      pollIntervalMs: 0,
      now: () => clock,
      onEvent: (message) => messages.push(message),
    });

    // The card was never skipped or timed out: it advanced to Verify and was
    // parked for a human exactly as a fast card would have been.
    assert.equal(summary.skipped.length, 0);
    assert.equal(summary.advanced.length, 1);
    assert.equal(board.columnTitleOf(cardId), 'Verify');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
    assert.doesNotMatch(board.findCard(cardId).activity ?? '', /AI loop timed out/);
    // While waiting, progress reported what was pending and for how long.
    const waitMessages = messages.filter((message) => message.includes('Slow agent') && message.includes('Waiting'));
    assert.ok(waitMessages.length > 0, `expected wait progress messages, got: ${JSON.stringify(messages)}`);
    assert.ok(
      waitMessages.some((message) => /40m/.test(message)),
      `expected a wait message reporting elapsed time, got: ${JSON.stringify(waitMessages)}`,
    );
  });

  test('reports elapsed time for one pending verification and never starts it twice', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 3, 'Slow verification', { kind: 'ai' });
    const board = fakeBoard(state);
    let verificationCalls = 0;
    const gateways = verificationGateways(async () => {
      verificationCalls += 1;
      return true;
    });

    let clock = 0;
    const control: LoopControl = {
      isCancelled: () => false,
      delay: async () => {
        clock += 10 * 60_000;
        if (clock >= 50 * 60_000 && board.findCard(cardId).assignee?.kind === 'ai') {
          board.mutate((current) => appendActivity(
            current,
            cardId,
            'VERIFY: HUMAN: A visual check needs a person.',
          ));
        }
      },
    };
    const messages: string[] = [];

    const summary = await runBoardLoop(board.store, gateways, control, {
      pollIntervalMs: 0,
      verifyWithAi: true,
      now: () => clock,
      onEvent: (message) => messages.push(message),
    });

    assert.equal(verificationCalls, 1, 'the card is not verified again while its hand-off is in flight');
    assert.equal(summary.verificationsRequested.length, 1);
    assert.equal(board.columnTitleOf(cardId), 'Verify');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'human' });
    const waitMessages = messages.filter((message) => message.includes('Slow verification') && message.includes('Waiting'));
    assert.ok(waitMessages.length > 0, `expected verification wait progress, got: ${JSON.stringify(messages)}`);
    assert.ok(
      waitMessages.some((message) => /AI verification.*40m/.test(message)),
      `expected a verification wait with elapsed time, got: ${JSON.stringify(waitMessages)}`,
    );
  });

  test('cancelling during a pending wait exits promptly without marking the card failed', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 2, 'Still working', { kind: 'ai' });
    const board = fakeBoard(state);
    const activityBefore = board.findCard(cardId).activity ?? '';
    const gateways: LoopGateways = {
      dispatchCard: async () => true, // agent never reports back
      requestDefinition: async () => true,
      requestTriage: async () => false,
      decideDoability: async () => ({ decision: 'ai' as const }),
    };

    let polls = 0;
    const control: LoopControl = {
      isCancelled: () => polls >= 3,
      delay: async () => {
        polls += 1;
      },
    };

    const summary = await runBoardLoop(board.store, gateways, control, { pollIntervalMs: 0 });

    assert.equal(summary.cancelled, true);
    assert.equal(polls, 3, 'the loop stopped as soon as cancellation was observed');
    // The waited-on card is untouched: not skipped, no failure entry appended.
    assert.equal(summary.skipped.length, 0);
    assert.equal(board.columnTitleOf(cardId), 'In Progress');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'ai' });
    assert.equal(board.findCard(cardId).activity ?? '', activityBefore);
  });

  test('a waited-on card moved out of its dispatch column drops the wait without stalling', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 2, 'Reprioritized', { kind: 'ai' });
    const board = fakeBoard(state);
    const gateways: LoopGateways = {
      dispatchCard: async () => true, // agent never reports back
      requestDefinition: async () => true,
      requestTriage: async () => false,
      decideDoability: async () => ({ decision: 'ai' as const }),
    };

    // On the first poll a human drags the card to Done, invalidating the wait.
    let polls = 0;
    const control: LoopControl = {
      isCancelled: () => false,
      delay: async () => {
        polls += 1;
        assert.ok(polls < 10, 'the loop must terminate once the wait is invalidated');
        board.mutate((current) => {
          const doneId = current.columns[4]!.id;
          return moveCard(current, cardId, doneId, 0);
        });
      },
    };

    const summary = await runBoardLoop(board.store, gateways, control, { pollIntervalMs: 0 });

    assert.equal(summary.cancelled, false);
    assert.equal(summary.skipped.length, 0);
    assert.equal(board.columnTitleOf(cardId), 'Done');
    assert.doesNotMatch(board.findCard(cardId).activity ?? '', /AI loop timed out/);
  });
});

suite('doability prompt and parsing', () => {
  test('buildDoabilityPrompt includes the card details and the verdict tokens', () => {
    const prompt = buildDoabilityPrompt({
      id: 'card-1',
      title: 'Refactor the parser',
      createdAt: 0,
      description: 'Split parse and serialize.',
      acceptanceCriteria: '- [ ] Tests pass',
    });
    assert.match(prompt, /Title: Refactor the parser/);
    assert.match(prompt, /Split parse and serialize\./);
    assert.match(prompt, /DOABLE_BY_AI or NEEDS_HUMAN/);
    // Verification happens in the Verify column regardless of who performs it,
    // so triage must judge implementability only.
    assert.match(prompt, /verified in the Verify column before Done/);
    assert.doesNotMatch(prompt, /verified by a human/);
    assert.match(prompt, /NOT a reason/);
    assert.match(prompt, /When genuinely unsure, prefer DOABLE_BY_AI/);
  });

  test('buildTriagePrompt judges implementability only, not verification needs', () => {
    const prompt = buildTriagePrompt(
      {
        id: 'card-1',
        title: 'Fix the sidebar bug',
        createdAt: 0,
        description: 'The saved session does not appear.',
        acceptanceCriteria: '- [ ] Session appears in the sidebar',
      },
      '.mwnn/cards/card-1.md',
    );
    assert.match(prompt, /IMPLEMENT the card autonomously/);
    assert.match(prompt, /verified in the Verify column before Done/);
    assert.doesNotMatch(prompt, /verified by a human/);
    assert.match(prompt, /NOT a reason to assign the card to a human/);
    assert.match(prompt, /When genuinely unsure, prefer AI/);
    assert.match(prompt, /assignee: \{ kind: ai \}/);
  });

  test('parseDoabilityDecision reads the final verdict', () => {
    assert.equal(parseDoabilityDecision('Reasoning...\nDOABLE_BY_AI')?.decision, 'ai');
    assert.equal(parseDoabilityDecision('This needs review.\nNEEDS_HUMAN')?.decision, 'human');
    assert.equal(
      parseDoabilityDecision('It could be DOABLE_BY_AI, but on reflection: NEEDS_HUMAN')?.decision,
      'human',
    );
    assert.equal(parseDoabilityDecision('No verdict here.'), undefined);
  });

  test('parseDoabilityDecision extracts the REASON line when present', () => {
    const verdict = parseDoabilityDecision('REASON: Requires stakeholder sign-off.\nNEEDS_HUMAN');
    assert.deepEqual(verdict, { decision: 'human', reason: 'Requires stakeholder sign-off.' });

    const noReason = parseDoabilityDecision('DOABLE_BY_AI');
    assert.deepEqual(noReason, { decision: 'ai' });
  });
});
