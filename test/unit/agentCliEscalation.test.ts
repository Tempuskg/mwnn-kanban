import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  createAgentCliFallbackRunner,
  type AgentCliFallbackDeps,
} from '../../src/agentCliFallback';
import {
  detectAgentCliEscalationTrigger,
  escalationLadderFor,
  readAgentCliEscalationLadders,
  selectNextEscalationModel,
  type AgentCliEscalationRecord,
  type AgentCliEscalationSettings,
} from '../../src/agentCliEscalation';
import {
  AGENT_CLI_LABELS,
  runAgentCliCardHandoff,
  type AgentCliCardHandoffResult,
  type AgentCliInvocation,
  type AgentCliProcessResult,
  type AgentCliProviderId,
  type AgentCliResolution,
  type AgentCliTarget,
} from '../../src/agentCliHandoff';
import {
  addCard,
  appendActivity,
  cloneBoard,
  defaultBoard,
  setAcceptanceCriteria,
  setAssignee,
  setDescription,
  setPreferredModel,
} from '../../src/utils';
import type { BoardState, Card } from '../../src/types';

const NOW = new Date('2026-09-19T11:15:00.000Z');

interface FakeBoard {
  readonly store: {
    reload(): Promise<BoardState>;
    appendActivity(cardId: string, entry: string): Promise<void>;
  };
  mutate(apply: (state: BoardState) => BoardState): void;
  card(cardId: string): Card;
  activity(cardId: string): string;
}

function fakeBoard(initial: BoardState): FakeBoard {
  let state = cloneBoard(initial);
  const card = (cardId: string): Card => {
    for (const column of state.columns) {
      const found = column.cards.find((candidate) => candidate.id === cardId);
      if (found) {
        return found;
      }
    }
    throw new Error(`Card ${cardId} not found`);
  };
  return {
    store: {
      reload: async () => cloneBoard(state),
      appendActivity: async (cardId, entry) => {
        state = appendActivity(state, cardId, entry);
      },
    },
    mutate(apply) {
      state = apply(state);
    },
    card,
    activity: (cardId) => card(cardId).activity ?? '',
  };
}

function boardWithCard(): { readonly state: BoardState; readonly cardId: string } {
  let state = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Verify', 'Done']);
  state = addCard(state, state.columns[2]!.id, 'Exercise the escalation');
  const cardId = state.columns[2]!.cards[0]!.id;
  state = setAssignee(state, cardId, { kind: 'ai' });
  state = setDescription(state, cardId, 'Retry this stage on a stronger model.');
  state = setAcceptanceCriteria(state, cardId, '- [ ] The stage finishes');
  return { state, cardId };
}

function target(provider: AgentCliProviderId): AgentCliTarget {
  return {
    provider,
    label: AGENT_CLI_LABELS[provider],
    executable: `${provider}-executable`,
    launcher: 'standalone',
  };
}

function cleanExit(): AgentCliProcessResult {
  return { started: true, cancelled: false, exitCode: 0, signal: null, stdout: 'done', stderr: '' };
}

function failure(message: string): AgentCliProcessResult {
  return { started: true, cancelled: false, exitCode: 1, signal: null, stdout: '', stderr: message };
}

/** The model an attempt actually ran on, read back off the spawn arguments. */
function modelOf(invocation: AgentCliInvocation): string | undefined {
  const flag = invocation.args.indexOf('--model');
  return flag === -1 ? undefined : invocation.args[flag + 1];
}

interface AttemptLog {
  readonly provider: AgentCliProviderId;
  readonly model: string | undefined;
  readonly prompt: string;
  readonly cwd: string;
}

/**
 * Drive the real hand-off - and therefore the real completion-evidence rules -
 * with simulated CLI processes, so no test ever spends real CLI credits. The
 * simulation is keyed on the model each attempt was given, which is what makes
 * "the retry ran on the stronger model" an assertion rather than an assumption.
 */
function simulatedHandoff(
  log: AttemptLog[],
  respond: (attempt: AttemptLog, invocation: AgentCliInvocation) => AgentCliProcessResult,
  concurrent?: { count: number; max: number },
): NonNullable<AgentCliFallbackDeps['runHandoff']> {
  return (handoff, options) =>
    runAgentCliCardHandoff(handoff, {
      ...options,
      now: () => NOW,
      runProcess: async (invocation) => {
        if (concurrent) {
          concurrent.count += 1;
          concurrent.max = Math.max(concurrent.max, concurrent.count);
        }
        const attempt: AttemptLog = {
          provider: invocation.provider,
          model: modelOf(invocation),
          prompt: invocation.stdin,
          cwd: invocation.cwd,
        };
        log.push(attempt);
        const result = respond(attempt, invocation);
        if (concurrent) {
          concurrent.count -= 1;
        }
        return result;
      },
    });
}

function resolverFor(available: readonly AgentCliProviderId[]): NonNullable<AgentCliFallbackDeps['resolveTarget']> {
  return async (provider): Promise<AgentCliResolution> =>
    available.includes(provider)
      ? { available: true, target: target(provider) }
      : {
          available: false,
          provider,
          attemptedCommand: provider,
          reason: `${AGENT_CLI_LABELS[provider]} is not installed.`,
        };
}

function escalationSettings(
  overrides: Partial<AgentCliEscalationSettings> = {},
): AgentCliEscalationSettings {
  return {
    enabled: true,
    ladders: { codex: ['cheap-model', 'strong-model'] },
    overrideCardModel: false,
    ...overrides,
  };
}

const IMPLEMENT_PROMPT = (card: Card): string =>
  `Implement "${card.title}"\nAppend STATUS: DONE.\nActivity so far: ${card.activity ?? ''}`;

suite('agent CLI escalation settings', () => {
  test('validates the ladder the way the model catalog is validated', () => {
    const ladders = readAgentCliEscalationLadders({
      codex: ['  cheap-model  ', 'strong-model', 'cheap-model', '', 7],
      'claude-code': ['sonnet'],
      unknownCli: ['nope'],
      cursor: 'not-an-array',
    });
    assert.deepEqual(escalationLadderFor(ladders, 'codex'), ['cheap-model', 'strong-model']);
    assert.deepEqual(escalationLadderFor(ladders, 'claude-code'), ['sonnet']);
    assert.deepEqual(escalationLadderFor(ladders, 'cursor'), []);
    assert.deepEqual(escalationLadderFor(ladders, 'copilot'), []);
  });

  test('degrades a malformed ladder to no escalation instead of throwing', () => {
    for (const value of [undefined, null, 'codex', 42, ['codex']]) {
      const ladders = readAgentCliEscalationLadders(value);
      assert.deepEqual(escalationLadderFor(ladders, 'codex'), []);
    }
  });
});

suite('agent CLI escalation trigger classification', () => {
  const base: AgentCliCardHandoffResult = {
    completed: false,
    cancelled: false,
    activityBaseline: 10,
  };

  test('escalates a blocked report and missing completion evidence', () => {
    const blocked = detectAgentCliEscalationTrigger({
      ...base,
      completed: true,
      terminalStatus: { kind: 'blocked', reason: 'the schema is ambiguous' },
    });
    assert.equal(blocked?.kind, 'blocked');
    assert.equal(blocked?.detail, 'the schema is ambiguous');

    const missing = detectAgentCliEscalationTrigger({
      ...base,
      failure: 'missing-evidence',
      reason: 'no terminal STATUS line was appended.',
    });
    assert.equal(missing?.kind, 'missing-evidence');
    assert.equal(missing?.detail, 'no terminal STATUS line was appended.');
  });

  test('never escalates a success, a cancellation, or a failure a model cannot fix', () => {
    assert.equal(
      detectAgentCliEscalationTrigger({ ...base, completed: true, terminalStatus: { kind: 'done' } }),
      undefined,
      'a successful attempt must not escalate',
    );
    assert.equal(
      detectAgentCliEscalationTrigger({ ...base, completed: true }),
      undefined,
      'a stage that completed without a terminal status must not escalate',
    );
    assert.equal(
      detectAgentCliEscalationTrigger({ ...base, cancelled: true }),
      undefined,
      'cancellation must not escalate',
    );
    assert.equal(
      detectAgentCliEscalationTrigger({
        ...base,
        failure: 'credit-exhausted',
        creditExhaustion: { detail: 'out of credits' },
      }),
      undefined,
      'credit exhaustion belongs to the CLI fallback, not the ladder',
    );
    assert.equal(
      detectAgentCliEscalationTrigger({ ...base, failure: 'model-rejected' }),
      undefined,
      'a rejected model name must not escalate',
    );
    assert.equal(
      detectAgentCliEscalationTrigger({ ...base, failure: 'process-failed' }),
      undefined,
      'authentication and network failures must not escalate',
    );
    assert.equal(
      detectAgentCliEscalationTrigger({ ...base, failure: 'card-missing' }),
      undefined,
      'a deleted card must not escalate',
    );
  });

  test('picks the next unused rung and stops at the top of the ladder', () => {
    const ladder = ['cheap-model', 'mid-model', 'strong-model'];
    assert.equal(selectNextEscalationModel(ladder, 'cheap-model', new Set()), 'mid-model');
    assert.equal(
      selectNextEscalationModel(ladder, 'cheap-model', new Set(['mid-model'])),
      'strong-model',
    );
    assert.equal(selectNextEscalationModel(ladder, 'strong-model', new Set()), undefined);
    // A model outside the ladder (a card model, or the CLI's own default)
    // starts at the bottom rung rather than escalating to nothing.
    assert.equal(selectNextEscalationModel(ladder, undefined, new Set()), 'cheap-model');
    assert.equal(selectNextEscalationModel(ladder, 'unrelated', new Set()), 'cheap-model');
    assert.equal(selectNextEscalationModel([], undefined, new Set()), undefined);
    assert.equal(
      selectNextEscalationModel(ladder, 'cheap-model', new Set(['mid-model', 'strong-model'])),
      undefined,
    );
  });
});

suite('agent CLI model escalation', () => {
  test('retries a blocked stage on the next model and keeps the earlier work', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    board.mutate((current) =>
      appendActivity(current, cardId, 'Partial work from the cheap model is preserved.'));
    const log: AttemptLog[] = [];
    const escalations: AgentCliEscalationRecord[] = [];
    const concurrent = { count: 0, max: 0 };

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      modelCatalog: { codex: ['cheap-model'] },
      escalation: escalationSettings(),
      cwd: 'E:\\workspace root',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      onEscalate: (record) => escalations.push(record),
      resolveTarget: resolverFor(['codex']),
      runHandoff: simulatedHandoff(
        log,
        (attempt) => {
          board.mutate((current) =>
            appendActivity(
              current,
              cardId,
              attempt.model === 'strong-model'
                ? 'STATUS: DONE'
                : 'STATUS: BLOCKED: the acceptance criteria are ambiguous',
            ));
          return cleanExit();
        },
        concurrent,
      ),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: IMPLEMENT_PROMPT,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, true);
    assert.equal(outcome.result.terminalStatus?.kind, 'done');
    assert.deepEqual(log.map((attempt) => attempt.model), ['cheap-model', 'strong-model']);
    assert.deepEqual(log.map((attempt) => attempt.provider), ['codex', 'codex']);
    assert.equal(concurrent.max, 1, 'the failed attempt must end before the retry starts');
    assert.equal(escalations.length, 1);
    assert.equal(escalations[0]?.from, 'cheap-model');
    assert.equal(escalations[0]?.to, 'strong-model');
    assert.equal(escalations[0]?.trigger.kind, 'blocked');

    // Same workspace, same card, same stage instructions - plus the reason.
    const retry = log[1]!;
    assert.equal(retry.cwd, 'E:\\workspace root');
    assert.ok(retry.prompt.startsWith('Implement "Exercise the escalation"'));
    assert.ok(retry.prompt.includes('Append STATUS: DONE.'));
    assert.ok(retry.prompt.includes('Partial work from the cheap model is preserved.'));
    assert.ok(retry.prompt.includes('## Escalation note'));
    assert.ok(retry.prompt.includes('the acceptance criteria are ambiguous'));
    assert.ok(retry.prompt.includes('"strong-model"'));

    const activity = board.activity(cardId);
    assert.ok(activity.includes('Partial work from the cheap model is preserved.'));
    assert.ok(activity.includes(`### ${NOW.toISOString()} - Escalated to a stronger model`));
    assert.ok(activity.includes('Stage: implementation.'));
    assert.ok(activity.includes('Previous model: cheap-model.'));
    assert.ok(activity.includes('Replacement model: "strong-model".'));
    assert.ok(activity.includes('reported itself blocked'));
    assert.ok(activity.includes('did not advance the card'));
  });

  test('retries a stage that produced no completion evidence', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: AttemptLog[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      modelCatalog: { codex: ['cheap-model'] },
      escalation: escalationSettings(),
      cwd: 'E:\\workspace root',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: resolverFor(['codex']),
      runHandoff: simulatedHandoff(log, (attempt) => {
        if (attempt.model === 'strong-model') {
          board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
        }
        // The cheap model exits cleanly and appends nothing at all.
        return cleanExit();
      }),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: IMPLEMENT_PROMPT,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, true);
    assert.deepEqual(log.map((attempt) => attempt.model), ['cheap-model', 'strong-model']);
    assert.equal(outcome.escalations[0]?.trigger.kind, 'missing-evidence');
    assert.ok(board.activity(cardId).includes('no stage completion evidence'));
  });

  test('a successful attempt is never escalated', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: AttemptLog[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      modelCatalog: { codex: ['cheap-model'] },
      escalation: escalationSettings(),
      cwd: 'E:\\workspace root',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: resolverFor(['codex']),
      runHandoff: simulatedHandoff(log, () => {
        board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
        return cleanExit();
      }),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: IMPLEMENT_PROMPT,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, true);
    assert.deepEqual(outcome.escalations, []);
    assert.deepEqual(log.map((attempt) => attempt.model), ['cheap-model']);
    assert.ok(!board.activity(cardId).includes('Escalated to a stronger model'));
  });

  test('disabled escalation preserves the single-attempt behavior exactly', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: AttemptLog[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      modelCatalog: { codex: ['cheap-model'] },
      escalation: escalationSettings({ enabled: false }),
      cwd: 'E:\\workspace root',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: resolverFor(['codex']),
      runHandoff: simulatedHandoff(log, () => cleanExit()),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: IMPLEMENT_PROMPT,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, false);
    assert.equal(outcome.result.failure, 'missing-evidence');
    assert.deepEqual(outcome.escalations, []);
    assert.deepEqual(log.map((attempt) => attempt.model), ['cheap-model']);
    assert.ok(!board.activity(cardId).includes('Escalated to a stronger model'));
  });

  test('excluded failure kinds never escalate', async () => {
    const cases: ReadonlyArray<{ readonly label: string; readonly stderr: string }> = [
      { label: 'authentication', stderr: 'HTTP 401 Unauthorized: invalid API key supplied.' },
      { label: 'network', stderr: 'request failed: getaddrinfo ENOTFOUND api.example.com' },
      { label: 'credit exhaustion', stderr: 'This account is out of credits.' },
      { label: 'rejected model', stderr: 'Error: unknown model "cheap-model".' },
    ];

    for (const { label, stderr } of cases) {
      const { state, cardId } = boardWithCard();
      const board = fakeBoard(state);
      const log: AttemptLog[] = [];

      const runner = createAgentCliFallbackRunner({
        initialTarget: target('codex'),
        // CLI fallback off, so an exhausted allowance also stays put here.
        settings: { enabled: false, providers: [] },
        configuredPaths: {},
        modelCatalog: { codex: ['cheap-model'] },
        escalation: escalationSettings(),
        cwd: 'E:\\workspace root',
        store: board.store,
        signal: new AbortController().signal,
        now: () => NOW,
        resolveTarget: resolverFor(['codex']),
        runHandoff: simulatedHandoff(log, () => failure(stderr)),
      });

      const outcome = await runner.run({
        kind: 'implementation',
        card: board.card(cardId),
        buildPrompt: IMPLEMENT_PROMPT,
      });

      assert.ok(outcome.kind === 'ran');
      assert.equal(outcome.result.completed, false);
      assert.deepEqual(outcome.escalations, [], `${label} must not escalate`);
      assert.deepEqual(
        log.map((attempt) => attempt.model),
        ['cheap-model'],
        `${label} must not launch a second attempt`,
      );
    }
  });

  test('walks each rung at most once and stops when the ladder is exhausted', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: AttemptLog[] = [];
    const progress: string[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      modelCatalog: { codex: ['cheap-model'] },
      escalation: escalationSettings({
        ladders: { codex: ['cheap-model', 'mid-model', 'strong-model'] },
      }),
      cwd: 'E:\\workspace root',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      onProgress: (message) => progress.push(message),
      resolveTarget: resolverFor(['codex']),
      // Every model fails the same way: the card must not cycle.
      runHandoff: simulatedHandoff(log, () => cleanExit()),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: IMPLEMENT_PROMPT,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, false);
    assert.deepEqual(log.map((attempt) => attempt.model), [
      'cheap-model',
      'mid-model',
      'strong-model',
    ]);
    assert.equal(outcome.escalations.length, 2);
    assert.ok(progress.some((message) => message.includes('no further model is configured')));
  });

  test('a rung spent on one stage is not spent again on the same card', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: AttemptLog[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      modelCatalog: { codex: ['cheap-model'] },
      escalation: escalationSettings(),
      cwd: 'E:\\workspace root',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: resolverFor(['codex']),
      runHandoff: simulatedHandoff(log, () => cleanExit()),
    });

    const first = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: IMPLEMENT_PROMPT,
    });
    const second = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: IMPLEMENT_PROMPT,
    });

    assert.ok(first.kind === 'ran' && second.kind === 'ran');
    assert.equal(first.escalations.length, 1);
    assert.deepEqual(
      second.escalations,
      [],
      'the ladder is a per-card budget for the whole loop run',
    );
    assert.deepEqual(log.map((attempt) => attempt.model), [
      'cheap-model',
      'strong-model',
      'cheap-model',
    ]);
  });

  test('a repeated failure signal cannot launch a duplicate handoff', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: AttemptLog[] = [];
    const concurrent = { count: 0, max: 0 };
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      modelCatalog: { codex: ['cheap-model'] },
      escalation: escalationSettings(),
      cwd: 'E:\\workspace root',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: resolverFor(['codex']),
      runHandoff: async (handoff, options) => {
        await gate;
        return simulatedHandoff(log, () => cleanExit(), concurrent)(handoff, options);
      },
    });

    const request = {
      kind: 'implementation' as const,
      card: board.card(cardId),
      buildPrompt: IMPLEMENT_PROMPT,
    };
    const first = runner.run(request);
    const second = await runner.run(request);
    release?.();
    const firstOutcome = await first;

    assert.equal(second.kind, 'busy', 'a second failure signal must not start another CLI');
    assert.ok(firstOutcome.kind === 'ran');
    assert.equal(concurrent.max, 1);
  });

  test('cancelling during failure handling stops further dispatches', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: AttemptLog[] = [];
    let cancelled = false;

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      modelCatalog: { codex: ['cheap-model'] },
      escalation: escalationSettings(),
      cwd: 'E:\\workspace root',
      store: board.store,
      signal: new AbortController().signal,
      isCancelled: () => cancelled,
      now: () => NOW,
      resolveTarget: resolverFor(['codex']),
      runHandoff: simulatedHandoff(log, () => {
        // The user stops the loop while this attempt is finishing; its late
        // exit must not start the escalation retry.
        cancelled = true;
        return cleanExit();
      }),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: IMPLEMENT_PROMPT,
    });

    assert.ok(outcome.kind === 'ran');
    assert.deepEqual(outcome.escalations, []);
    assert.deepEqual(log.map((attempt) => attempt.model), ['cheap-model']);
    assert.ok(!board.activity(cardId).includes('Escalated to a stronger model'));

    // A late signal after cancellation cannot restart the loop either.
    const afterCancel = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: IMPLEMENT_PROMPT,
    });
    assert.ok(afterCancel.kind === 'ran');
    assert.equal(afterCancel.result.cancelled, true);
    assert.deepEqual(log.map((attempt) => attempt.model), ['cheap-model']);
  });
});

suite('agent CLI model escalation and card models', () => {
  test("leaves a card's explicit model alone by default", async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(setPreferredModel(state, cardId, 'codex', 'card-chosen-model'));
    const log: AttemptLog[] = [];
    const progress: string[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      modelCatalog: { codex: ['cheap-model'] },
      escalation: escalationSettings(),
      cwd: 'E:\\workspace root',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      onProgress: (message) => progress.push(message),
      resolveTarget: resolverFor(['codex']),
      runHandoff: simulatedHandoff(log, () => cleanExit()),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: IMPLEMENT_PROMPT,
    });

    assert.ok(outcome.kind === 'ran');
    assert.deepEqual(outcome.escalations, []);
    assert.deepEqual(log.map((attempt) => attempt.model), ['card-chosen-model']);
    assert.ok(progress.some((message) => message.includes('names its own model')));
  });

  test('escalates away from a card model once the user opts in', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(setPreferredModel(state, cardId, 'codex', 'card-chosen-model'));
    const log: AttemptLog[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      modelCatalog: { codex: ['cheap-model'] },
      escalation: escalationSettings({ overrideCardModel: true }),
      cwd: 'E:\\workspace root',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: resolverFor(['codex']),
      runHandoff: simulatedHandoff(log, (attempt) => {
        if (attempt.model === 'cheap-model') {
          board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
        }
        return cleanExit();
      }),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: IMPLEMENT_PROMPT,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, true);
    // The card's own model is not on the ladder, so escalation starts at the
    // bottom rung rather than skipping past it.
    assert.deepEqual(log.map((attempt) => attempt.model), ['card-chosen-model', 'cheap-model']);
    assert.equal(outcome.escalations[0]?.from, 'card-chosen-model');
  });
});

suite('agent CLI model escalation and credit fallback', () => {
  test('a spent allowance switches CLI without consuming an escalation step', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: AttemptLog[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['claude-code'] },
      configuredPaths: {},
      modelCatalog: { codex: ['cheap-model'], 'claude-code': ['claude-cheap'] },
      escalation: escalationSettings({
        ladders: {
          codex: ['cheap-model', 'codex-strong'],
          'claude-code': ['claude-cheap', 'claude-strong'],
        },
      }),
      cwd: 'E:\\workspace root',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: resolverFor(['claude-code']),
      runHandoff: simulatedHandoff(log, (attempt) => {
        if (attempt.provider === 'codex') {
          return failure('This account is out of credits.');
        }
        if (attempt.model === 'claude-strong') {
          board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
          return cleanExit();
        }
        // The replacement CLI's cheap model runs but produces no evidence.
        return cleanExit();
      }),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: IMPLEMENT_PROMPT,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, true);
    assert.equal(outcome.target.provider, 'claude-code');
    assert.equal(outcome.switches.length, 1);
    // The exhausted CLI's attempt cost no rung: the replacement starts at its
    // own resolved model and climbs its own ladder.
    assert.deepEqual(log.map((attempt) => [attempt.provider, attempt.model]), [
      ['codex', 'cheap-model'],
      ['claude-code', 'claude-cheap'],
      ['claude-code', 'claude-strong'],
    ]);
    assert.equal(outcome.escalations.length, 1);
    assert.equal(outcome.escalations[0]?.target.provider, 'claude-code');
    assert.equal(outcome.escalations[0]?.from, 'claude-cheap');
  });

  test('an escalated card still falls back to another CLI when credits run out', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: AttemptLog[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['claude-code'] },
      configuredPaths: {},
      modelCatalog: { codex: ['cheap-model'], 'claude-code': ['claude-cheap'] },
      escalation: escalationSettings({
        ladders: { codex: ['cheap-model', 'codex-strong'] },
      }),
      cwd: 'E:\\workspace root',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: resolverFor(['claude-code']),
      runHandoff: simulatedHandoff(log, (attempt) => {
        if (attempt.model === 'cheap-model') {
          return cleanExit(); // inconclusive: escalate
        }
        if (attempt.model === 'codex-strong') {
          return failure('This account is out of credits.'); // now switch CLI
        }
        board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
        return cleanExit();
      }),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: IMPLEMENT_PROMPT,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, true);
    assert.deepEqual(log.map((attempt) => [attempt.provider, attempt.model]), [
      ['codex', 'cheap-model'],
      ['codex', 'codex-strong'],
      ['claude-code', 'claude-cheap'],
    ]);
    assert.equal(outcome.escalations.length, 1);
    assert.equal(outcome.switches.length, 1);
  });
});
