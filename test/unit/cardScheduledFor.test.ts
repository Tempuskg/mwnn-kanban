import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { isWebviewToHostMessage } from '../../src/types';
import {
  addCard,
  canMoveCardToColumn,
  defaultBoard,
  describeBlockedCardRelocation,
  describeBlockedMove,
  isCardBlocked,
  isScheduledBlocked,
  normalizeScheduledFor,
  parseScheduledFor,
  readyState,
  relocateBlockedCards,
  setDependencies,
  setDescription,
  setScheduledFor,
} from '../../src/utils';

suite('card scheduledFor', () => {
  test('normalizes the full local datetime and expands date-only to T00:00', () => {
    assert.equal(normalizeScheduledFor('2026-11-01T09:30'), '2026-11-01T09:30');
    assert.equal(normalizeScheduledFor(' 2026-11-01 '), '2026-11-01T00:00');
    assert.equal(normalizeScheduledFor('2024-02-29T23:59'), '2024-02-29T23:59');
  });

  test('rejects blank, unpadded, and invalid calendar or clock values', () => {
    assert.equal(normalizeScheduledFor(undefined), undefined);
    assert.equal(normalizeScheduledFor(''), undefined);
    assert.equal(normalizeScheduledFor('   '), undefined);
    assert.equal(normalizeScheduledFor('2026-1-01T09:30'), undefined);
    assert.equal(normalizeScheduledFor('2026-11-01T9:30'), undefined);
    assert.equal(normalizeScheduledFor('2026-11-01T24:00'), undefined);
    assert.equal(normalizeScheduledFor('2026-11-01T12:60'), undefined);
    assert.equal(normalizeScheduledFor('2025-02-29'), undefined);
    assert.equal(normalizeScheduledFor('2026-11-01T09:30:00'), undefined);
    assert.equal(normalizeScheduledFor('not-a-date'), undefined);
  });

  test('setScheduledFor sets, normalizes, and clears the field', () => {
    let state = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Verify', 'Done']);
    const columnId = state.columns[0]!.id;
    state = addCard(state, columnId, 'Scheduled card');
    const cardId = state.columns[0]!.cards[0]!.id;

    state = setScheduledFor(state, cardId, '2026-11-01');
    assert.equal(state.columns[0]!.cards[0]!.scheduledFor, '2026-11-01T00:00');

    state = setScheduledFor(state, cardId, '2026-12-15T14:45');
    assert.equal(state.columns[0]!.cards[0]!.scheduledFor, '2026-12-15T14:45');

    state = setScheduledFor(state, cardId, undefined);
    assert.equal(state.columns[0]!.cards[0]!.scheduledFor, undefined);

    state = setScheduledFor(state, cardId, '2026-12-15T14:45');
    state = setScheduledFor(state, cardId, 'bogus');
    assert.equal(state.columns[0]!.cards[0]!.scheduledFor, undefined);
  });

  test('setScheduledFor is accepted on the webview protocol and clears when omitted', () => {
    assert.equal(
      isWebviewToHostMessage({
        type: 'setScheduledFor',
        cardId: 'card-1',
        scheduledFor: '2026-11-01T09:30',
      }),
      true,
    );
    assert.equal(isWebviewToHostMessage({ type: 'setScheduledFor', cardId: 'card-1' }), true);
    assert.equal(
      isWebviewToHostMessage({
        type: 'setScheduledFor',
        cardId: 'card-1',
        scheduledFor: 42,
      }),
      false,
    );
    assert.equal(isWebviewToHostMessage({ type: 'setScheduledFor', scheduledFor: '2026-11-01T09:30' }), false);
  });
  test('parseScheduledFor reads local wall time and rejects invalid values', () => {
    assert.equal(parseScheduledFor('2026-11-01T09:30')?.getTime(), new Date(2026, 10, 1, 9, 30).getTime());
    assert.equal(parseScheduledFor('2026-11-01')?.getTime(), new Date(2026, 10, 1, 0, 0).getTime());
    assert.equal(parseScheduledFor('bogus'), undefined);
    assert.equal(parseScheduledFor(undefined), undefined);
  });

  test('a future schedule blocks past Ready; at or after the moment it does not', () => {
    let state = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Done']);
    state = addCard(state, state.columns[1]!.id, 'Later');
    const cardId = state.columns[1]!.cards[0]!.id;
    state = setScheduledFor(state, cardId, '2026-11-01T09:30');
    const inProgress = state.columns[2]!.id;
    const before = new Date(2026, 10, 1, 9, 29, 59, 999);
    const at = new Date(2026, 10, 1, 9, 30);
    const after = new Date(at.getTime() + 1);

    assert.equal(isScheduledBlocked(state, cardId, before), true);
    assert.equal(isCardBlocked(state, cardId, before), true);
    assert.equal(canMoveCardToColumn(state, cardId, inProgress, before), false);
    assert.equal(canMoveCardToColumn(state, cardId, state.columns[0]!.id, before), true);

    assert.equal(isCardBlocked(state, cardId, at), false);
    assert.equal(canMoveCardToColumn(state, cardId, inProgress, at), true);
    assert.equal(isCardBlocked(state, cardId, after), false);
    assert.equal(canMoveCardToColumn(state, cardId, inProgress, after), true);
    assert.equal(canMoveCardToColumn(state, cardId, state.columns[1]!.id, before), true);
  });

  test('dependencies and schedule combine; Ready reverse-WIP ignores schedule-blocked defined cards', () => {
    let state = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Done']);
    const ready = state.columns[1]!.id;
    state = addCard(state, state.columns[0]!.id, 'Upstream');
    state = addCard(state, ready, 'Both');
    state = addCard(state, ready, 'Scheduled');
    const upstream = state.columns[0]!.cards[0]!.id;
    const [both, scheduled] = state.columns[1]!.cards.map((card) => card.id);
    state = setDependencies(state, both!, [upstream]);
    state = setScheduledFor(state, both!, '2026-11-01T09:30');
    state = setScheduledFor(state, scheduled!, '2026-11-01T09:30');
    state = setDescription(state, both!, 'Defined');
    state = setDescription(state, scheduled!, 'Defined');
    state = { ...state, columns: state.columns.map((column) => column.id === ready ? { ...column, reverseWip: 2 } : column) };
    const before = new Date(2026, 10, 1, 9, 0);
    const after = new Date(2026, 10, 1, 9, 30);

    assert.deepEqual(readyState(state, state.columns[1]!, before), { defined: 0, min: 2, under: true });
    // After the schedule passes, the dependency still blocks `both`.
    assert.equal(isCardBlocked(state, both!, after), true);
    assert.deepEqual(readyState(state, state.columns[1]!, after), { defined: 1, min: 2, under: true });
    assert.equal(
      describeBlockedMove(state, both!, before),
      '"Both" is blocked by unfinished dependency "Upstream" and scheduled for 2026-11-01 09:30 and can\'t move past Ready.',
    );
    assert.equal(
      describeBlockedMove(state, scheduled!, before),
      '"Scheduled" is scheduled for 2026-11-01 09:30 and can\'t move past Ready.',
    );
  });

  test('relocateBlockedCards pulls back a schedule-blocked card and names the datetime', () => {
    let state = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Done']);
    state = addCard(state, state.columns[2]!.id, 'Too early');
    const cardId = state.columns[2]!.cards[0]!.id;
    state = setScheduledFor(state, cardId, '2026-11-01T09:30');

    const early = new Date(2026, 10, 1, 9, 0);
    const { state: moved, relocations } = relocateBlockedCards(state, early);
    assert.equal(relocations.length, 1);
    assert.deepEqual(relocations[0]!.blockedBy, []);
    assert.equal(relocations[0]!.scheduledFor, '2026-11-01T09:30');
    assert.equal(
      describeBlockedCardRelocation(relocations[0]!),
      '"Too early" moved from In Progress back to Ready: scheduled for 2026-11-01 09:30.',
    );
    const card = moved.columns[1]!.cards.find((candidate) => candidate.id === cardId)!;
    assert.equal(
      card.activity,
      `### ${early.toISOString()} - Moved back to Ready\nMoved back to Ready from "In Progress": scheduled for 2026-11-01 09:30.`,
    );

    const onTime = relocateBlockedCards(state, new Date(2026, 10, 1, 9, 30));
    assert.equal(onTime.relocations.length, 0);
  });
});
