import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  buildDoabilityPrompt,
  createLoopSession,
  parseDoabilityDecision,
  planLoopAction,
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
      return decide(card);
    },
  };
  return { gateways, log };
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
      decideDoability: async () => 'ai',
    };

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.deepEqual(log, [cardId]);
    assert.equal(board.columnTitleOf(cardId), 'In Progress');
    assert.deepEqual(board.findCard(cardId).assignee, { kind: 'ai' });
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
      decideDoability: async () => 'ai',
    };

    const summary = await runBoardLoop(board.store, gateways, neverCancelled(), { pollIntervalMs: 0 });

    assert.equal(attempts, 1);
    assert.equal(board.columnTitleOf(cardId), 'In Progress');
    assert.equal(summary.skipped.length, 1);
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

  test('times out a dispatch that never completes and terminates', async () => {
    const { state, cardId } = boardWithCard([...FULL_COLUMNS], 2, 'Silent agent', { kind: 'ai' });
    const board = fakeBoard(state);
    const gateways: LoopGateways = {
      dispatchCard: async () => true, // agent never reports back
      requestDefinition: async () => true,
      decideDoability: async () => 'ai',
    };

    let clock = 0;
    const summary = await runBoardLoop(
      board.store,
      gateways,
      { isCancelled: () => false, delay: async () => undefined },
      {
        pollIntervalMs: 0,
        waitTimeoutMs: 100,
        now: () => {
          clock += 60;
          return clock;
        },
      },
    );

    assert.equal(summary.skipped.length, 1);
    assert.match(board.findCard(cardId).activity ?? '', /AI loop timed out/);
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
  });

  test('parseDoabilityDecision reads the final verdict', () => {
    assert.equal(parseDoabilityDecision('Reasoning...\nDOABLE_BY_AI'), 'ai');
    assert.equal(parseDoabilityDecision('This needs review.\nNEEDS_HUMAN'), 'human');
    assert.equal(
      parseDoabilityDecision('It could be DOABLE_BY_AI, but on reflection: NEEDS_HUMAN'),
      'human',
    );
    assert.equal(parseDoabilityDecision('No verdict here.'), undefined);
  });
});
