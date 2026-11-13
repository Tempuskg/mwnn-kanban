import { fakeOutcomeEvidence } from '../helpers/fakeOutcomeEvidence';
import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  AGENT_CLI_LABELS,
  runAgentCliCardHandoff,
  type AgentCliCardHandoffOptions,
  type AgentCliHandoffKind,
  type AgentCliTarget,
} from '../../src/agentCliHandoff';
import { runBoardLoop, type LoopStore } from '../../src/boardLoop';
import { requirementsDigest, type OutcomeEvidenceFactory } from '../../src/outcomeEvidence';
import { isStuckOnVerificationProfile } from '../../src/outcomeRecheck';
import type { BoardState, Card } from '../../src/types';
import {
  addCard,
  appendActivity,
  cloneBoard,
  defaultBoard,
  moveCard,
  setAcceptanceCriteria,
  setAssignee,
  setDescription,
} from '../../src/utils';

const LEGACY_FAILURE = 'Missing or invalid verification inputs. Configure .mwnn/verification.json, with a check mapping for every acceptance criterion, before dispatch.';
const COLUMNS = { backlog: 0, ready: 1, inProgress: 2, verify: 3, done: 4 } as const;

function stuckEntries(stage: 'implementation' | 'verification', completion: string, failure = LEGACY_FAILURE): string[] {
  return [
    `### 2026-11-12T18:25:02.828Z - Usage Orchestrator dispatch dispatch-mwdvo7l8-2 started\nCard: card-x ("Task"). CLI: Cursor Agent CLI Other. Stage: ${stage}.\nStarted Cursor Agent CLI Other in the active workspace and waiting for card-file completion evidence.`,
    `### 2026-11-12 - Re-verified (Cursor Agent)\n- Evidence: dotnet test passed.\n${completion}`,
    '### 2026-11-12T18:26:13.028Z - MWNN independent verification started',
    `### 2026-11-12T18:26:13.157Z - Cursor Agent CLI Other ${stage} handoff failed\n${failure}`,
  ];
}

function stuckBoard(
  column: number,
  stage: 'implementation' | 'verification',
  completion: string,
  failure?: string,
): { state: BoardState; cardId: string } {
  let state = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Verify', 'Done']);
  state = addCard(state, state.columns[COLUMNS.done]!.id, 'Already finished');
  state = addCard(state, state.columns[column]!.id, 'Record subscriber sends');
  const cardId = state.columns[column]!.cards.at(-1)!.id;
  state = setAssignee(state, cardId, { kind: 'ai' });
  state = setDescription(state, cardId, 'Log every send.');
  state = setAcceptanceCriteria(state, cardId, '- [x] A real send records one row per address');
  for (const entry of stuckEntries(stage, completion, failure)) {
    state = appendActivity(state, cardId, entry);
  }
  return { state, cardId };
}

function findCard(state: BoardState, cardId: string): { card: Card; column: number; index: number } {
  for (const [column, candidate] of state.columns.entries()) {
    const index = candidate.cards.findIndex((card) => card.id === cardId);
    if (index >= 0) { return { card: candidate.cards[index]!, column, index }; }
  }
  throw new Error(`Card ${cardId} not found`);
}

function memoryStore(initial: BoardState): LoopStore & { current(): BoardState } {
  let state = cloneBoard(initial);
  return {
    current: () => state,
    reload: async () => cloneBoard(state),
    moveCard: async (cardId, toColumnId, toIndex) => { state = moveCard(state, cardId, toColumnId, toIndex); },
    setAssignee: async (cardId, assignee) => { state = setAssignee(state, cardId, assignee); },
    setAcceptanceCriteria: async (cardId, text) => { state = setAcceptanceCriteria(state, cardId, text); },
    appendActivity: async (cardId, entry) => { state = appendActivity(state, cardId, entry); },
  };
}

const cursorOther: AgentCliTarget = { provider: 'cursor-other', label: AGENT_CLI_LABELS['cursor-other'],
  executable: 'agent', launcher: 'standalone' };

const failingChecks: OutcomeEvidenceFactory = async () => ({
  verify: async () => ({ valid: false, reason: 'Independent check test failed, timed out or was cancelled.' }),
});

function options(
  processes: { count: number },
  outcomeEvidenceFactory: OutcomeEvidenceFactory = fakeOutcomeEvidence,
): AgentCliCardHandoffOptions {
  return {
    outcomeEvidenceFactory,
    now: () => new Date('2026-11-12T19:00:00.000Z'),
    runProcess: async () => {
      processes.count += 1;
      return { started: true, cancelled: false, exitCode: 0, signal: null, stdout: '', stderr: '' };
    },
  };
}

async function handoff(
  store: LoopStore,
  card: Card,
  kind: AgentCliHandoffKind,
  handoffOptions: AgentCliCardHandoffOptions,
) {
  return runAgentCliCardHandoff({ kind, target: cursorOther, cardId: card.id, prompt: 'work the card',
    cwd: '/project', store, signal: new AbortController().signal }, handoffOptions);
}

suite('stuck outcome detection', () => {
  const card = (entries: string[]): Card => ({ id: 'card-x', title: 'Task', createdAt: 1,
    description: 'Log every send.', acceptanceCriteria: '- [x] Rows', activity: entries.join('\n\n') });
  const current = requirementsDigest(card([]));

  test('a legacy DONE rejected only for the missing profile is eligible', () => {
    assert.equal(isStuckOnVerificationProfile(card(stuckEntries('implementation', 'STATUS: DONE')), 'implementation', current), true);
    assert.equal(isStuckOnVerificationProfile(card(stuckEntries('verification', 'VERIFY: PASS')), 'verification', current), true);
  });

  test('a new invalid-profile reason is eligible while its requirements digest matches', () => {
    const reason = '.mwnn/verification.json';
    const failure = `Verification profile ${reason} is invalid: bad.\nRequirements digest: ${current}`;
    assert.equal(isStuckOnVerificationProfile(card(stuckEntries('implementation', 'STATUS: DONE', failure)), 'implementation', current), true);
    const changed = `Verification profile ${reason} is invalid: bad.\nRequirements digest: ${'0'.repeat(64)}`;
    assert.equal(isStuckOnVerificationProfile(card(stuckEntries('implementation', 'STATUS: DONE', changed)), 'implementation', current), false);
  });

  test('other failures, blockers, missing completion and a different stage are not eligible', () => {
    for (const [entries, stage] of [
      [stuckEntries('implementation', 'STATUS: DONE', 'Independent check tests failed.'), 'implementation'],
      [stuckEntries('implementation', 'STATUS: BLOCKED: needs review'), 'implementation'],
      [stuckEntries('implementation', 'Still working.'), 'implementation'],
      [stuckEntries('verification', 'VERIFY: FAIL: wrong rows'), 'verification'],
      [stuckEntries('implementation', 'STATUS: DONE'), 'verification'],
      [stuckEntries('implementation', 'STATUS: DONE').slice(0, 2), 'implementation'],
    ] as const) {
      assert.equal(isStuckOnVerificationProfile(card([...entries]), stage, current), false);
    }
  });

  test('a newer agent dispatch resets eligibility', () => {
    const entries = [...stuckEntries('implementation', 'STATUS: DONE'),
      '### 2026-11-12T19:00:00.000Z - Cursor Agent CLI Other implementation handoff started\nStarted.'];
    assert.equal(isStuckOnVerificationProfile(card(entries), 'implementation', current), false);
  });
});

suite('re-checking a stuck card', () => {
  test('a passing re-check accepts the earlier DONE without starting the agent', async () => {
    const { state, cardId } = stuckBoard(COLUMNS.inProgress, 'implementation', 'STATUS: DONE');
    const store = memoryStore(state);
    const processes = { count: 0 };
    const result = await handoff(store, findCard(state, cardId).card, 'implementation', options(processes));
    assert.equal(processes.count, 0);
    assert.equal(result.completed, true);
    assert.deepEqual(result.terminalStatus, { kind: 'done' });
    const activity = findCard(store.current(), cardId).card.activity ?? '';
    assert.match(activity.slice(result.activityBaseline), /independent verification receipt[\s\S]*re-check passed[\s\S]*\nSTATUS: DONE$/);
    assert.equal(await result.revalidateOutcome?.(), true);
  });

  test('a failing re-check keeps the card where it is and records the reason', async () => {
    const { state, cardId } = stuckBoard(COLUMNS.inProgress, 'implementation', 'STATUS: DONE');
    const store = memoryStore(state);
    const processes = { count: 0 };
    const result = await handoff(store, findCard(state, cardId).card, 'implementation', options(processes, failingChecks));
    assert.equal(processes.count, 0);
    assert.equal(result.completed, false);
    assert.equal(result.failure, 'outcome-unverified');
    const after = findCard(store.current(), cardId);
    assert.equal(after.column, COLUMNS.inProgress);
    assert.match(after.card.activity ?? '', /re-check implementation handoff failed\nIndependent check test failed/);
  });

  test('changed requirements send the card back to the agent', async () => {
    const failure = `${LEGACY_FAILURE}\nRequirements digest: ${'0'.repeat(64)}`;
    const { state, cardId } = stuckBoard(COLUMNS.inProgress, 'implementation', 'STATUS: DONE', failure);
    const processes = { count: 0 };
    await handoff(memoryStore(state), findCard(state, cardId).card, 'implementation', options(processes));
    assert.equal(processes.count, 1);
  });
});

suite('AI loop with a stuck card', () => {
  const gateways = (store: LoopStore, handoffOptions: AgentCliCardHandoffOptions) => {
    const run = async (card: Card, kind: AgentCliHandoffKind) => {
      const result = await handoff(store, card, kind, handoffOptions);
      return { started: result.completed, activityBaseline: result.activityBaseline,
        ...(result.revalidateOutcome ? { revalidateOutcome: result.revalidateOutcome } : {}) };
    };
    return {
      dispatchCard: (card: Card) => run(card, 'implementation'),
      verifyCard: (card: Card) => run(card, 'verification'),
      requestDefinition: async () => false,
      decideDoability: async () => undefined,
      requestTriage: async () => false,
    };
  };
  const control = { isCancelled: () => false, delay: async () => undefined };

  test('a passing re-check in Verify moves the card to the top of Done', async () => {
    const { state, cardId } = stuckBoard(COLUMNS.verify, 'verification', 'VERIFY: PASS');
    const store = memoryStore(state);
    const processes = { count: 0 };
    const summary = await runBoardLoop(store, gateways(store, options(processes)), control,
      { requireIndependentEvidence: true, verifyWithAi: true, cardId });
    assert.equal(processes.count, 0);
    assert.deepEqual(summary.verified, ['Record subscriber sends']);
    const after = findCard(store.current(), cardId);
    assert.equal(after.column, COLUMNS.done);
    assert.equal(after.index, 0);
  });

  test('a passing re-check in In Progress advances the card to Verify', async () => {
    const { state, cardId } = stuckBoard(COLUMNS.inProgress, 'implementation', 'STATUS: DONE');
    const store = memoryStore(state);
    const processes = { count: 0 };
    await runBoardLoop(store, gateways(store, options(processes)), control,
      { requireIndependentEvidence: true, cardId });
    assert.equal(processes.count, 0);
    assert.equal(findCard(store.current(), cardId).column, COLUMNS.verify);
  });

  test('a failing re-check leaves the card in In Progress with the reason', async () => {
    const { state, cardId } = stuckBoard(COLUMNS.inProgress, 'implementation', 'STATUS: DONE');
    const store = memoryStore(state);
    const processes = { count: 0 };
    const summary = await runBoardLoop(store, gateways(store, options(processes, failingChecks)), control,
      { requireIndependentEvidence: true, cardId });
    assert.equal(processes.count, 0);
    assert.deepEqual(summary.skipped, ['Record subscriber sends']);
    const after = findCard(store.current(), cardId);
    assert.equal(after.column, COLUMNS.inProgress);
    assert.match(after.card.activity ?? '', /Independent check test failed/);
  });
});
