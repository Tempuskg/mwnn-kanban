import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  createAgentCliFallbackRunner,
  type AgentCliFallbackDeps,
  type AgentCliUsageResetWaitSettings,
} from '../../src/agentCliFallback';
import {
  AGENT_CLI_LABELS,
  runAgentCliCardHandoff,
  type AgentCliProcessResult,
  type AgentCliProviderId,
  type AgentCliResolution,
  type AgentCliTarget,
} from '../../src/agentCliHandoff';
import { createAgentCliUsageOrchestrator } from '../../src/agentCliOrchestrator';
import { unknownUsage, type AgentCliRankableUsageSnapshot } from '../../src/agentCliUsage';
import { createAiLoopPauseGate } from '../../src/aiLoopPause';
import {
  DEFAULT_AI_LOOP_USAGE_RESET_MAX_WAIT_HOURS,
  USAGE_RECHECK_INTERVAL_MS,
  USAGE_RESET_GRACE_MS,
  USAGE_WAIT_TICK_MS,
  planPaceWait,
  planUsageWait,
  readAiLoopUsageResetMaxWaitHours,
  selectRecoveredCli,
  usageWaitProviderLabel,
} from '../../src/aiLoopUsageWait';
import {
  AI_USAGE_PACE_TOLERANCE_POINTS,
  FIVE_HOUR_WINDOW_MS,
  predictBehindAtMs,
} from '../../src/agentCliUsagePace';
import {
  addCard,
  appendActivity,
  cloneBoard,
  defaultBoard,
  deleteCard,
  setAcceptanceCriteria,
  setAssignee,
  setDescription,
} from '../../src/utils';
import type { BoardState, Card } from '../../src/types';

const START = Date.parse('2026-10-21T09:00:00.000Z');
const HOUR = 3_600_000;
const CLAUDE = AGENT_CLI_LABELS['claude-code'];

function target(provider: AgentCliProviderId): AgentCliTarget {
  return { provider, label: AGENT_CLI_LABELS[provider], executable: `${provider}-executable`, launcher: 'standalone' };
}

function resolverFor(available: readonly AgentCliProviderId[]) {
  return async (provider: AgentCliProviderId): Promise<AgentCliResolution> =>
    available.includes(provider)
      ? { available: true, target: target(provider) }
      : { available: false, provider, attemptedCommand: provider, reason: 'not installed' };
}

const spent = (provider: AgentCliProviderId, resetsAt?: number): AgentCliRankableUsageSnapshot => ({
  kind: 'reported',
  provider,
  remainingPercent: 0,
  ...(resetsAt !== undefined ? { resetsAt } : {}),
});
const left = (provider: AgentCliProviderId, remainingPercent = 50): AgentCliRankableUsageSnapshot => ({
  kind: 'reported',
  provider,
  remainingPercent,
});

const creditFailure = (): AgentCliProcessResult => ({
  started: true, cancelled: false, exitCode: 1, signal: null, stdout: '', stderr: 'Claude usage limit reached.',
});
const cleanExit = (): AgentCliProcessResult => ({
  started: true, cancelled: false, exitCode: 0, signal: null, stdout: 'done', stderr: '',
});

/** A board, a fake wall clock, and CLIs scripted per dispatch. */
function harness(options: {
  readonly behaviour: (provider: AgentCliProviderId, dispatch: number) => 'fail' | 'done';
  readonly probe: (provider: AgentCliProviderId, now: number) => AgentCliRankableUsageSnapshot;
  readonly maxWaitHours?: number;
  /** Runs on every fake sleep, after the clock has advanced. */
  readonly onDelay?: (ms: number) => void;
  /** Overrides how far one fake sleep moves the clock. */
  readonly advance?: (ms: number) => number;
}) {
  let state = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Verify', 'Done']);
  state = addCard(state, state.columns[2]!.id, 'Wait out the limit');
  const cardId = state.columns[2]!.cards[0]!.id;
  state = setAssignee(state, cardId, { kind: 'ai' });
  state = setDescription(state, cardId, 'Retry after the reset.');
  state = setAcceptanceCriteria(state, cardId, '- [ ] Done');
  const find = (): Card | undefined => state.columns.flatMap((column) => column.cards).find((card) => card.id === cardId);
  const clock = { now: START };
  const dispatches: { provider: AgentCliProviderId; prompt: string; at: number }[] = [];
  const delays: number[] = [];
  const probes: AgentCliProviderId[] = [];
  const progress: string[] = [];
  const pauses: string[] = [];
  const store = {
    reload: async (): Promise<BoardState> => cloneBoard(state),
    appendActivity: async (id: string, entry: string) => { state = appendActivity(state, id, entry); },
  };
  const usageResetWait: AgentCliUsageResetWaitSettings = {
    maxWaitHours: options.maxWaitHours ?? 6,
    probe: async (probed) => { probes.push(probed.provider); return options.probe(probed.provider, clock.now); },
    delay: async (ms) => {
      delays.push(ms);
      clock.now += options.advance?.(ms) ?? ms;
      options.onDelay?.(ms);
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
  const runHandoff: NonNullable<AgentCliFallbackDeps['runHandoff']> = (handoff, handoffOptions) =>
    runAgentCliCardHandoff(handoff, {
      ...handoffOptions,
      now: () => new Date(clock.now),
      runProcess: async (invocation) => {
        const dispatch = dispatches.filter((entry) => entry.provider === invocation.provider).length;
        dispatches.push({ provider: invocation.provider, prompt: invocation.stdin, at: clock.now });
        if (options.behaviour(invocation.provider, dispatch) === 'fail') {
          return creditFailure();
        }
        state = appendActivity(state, cardId, 'STATUS: DONE');
        return cleanExit();
      },
    });
  const deps = (overrides: Partial<AgentCliFallbackDeps> = {}): AgentCliFallbackDeps => ({
    initialTarget: target('claude-code'),
    settings: { enabled: false, providers: [] },
    configuredPaths: {},
    cwd: 'E:\\workspace',
    store,
    signal: new AbortController().signal,
    now: () => new Date(clock.now),
    onProgress: (message) => progress.push(message),
    onPause: (reason) => pauses.push(reason),
    runHandoff,
    usageResetWait,
    ...overrides,
  });
  const run = (runnerDeps: AgentCliFallbackDeps, latest?: () => Card) =>
    createAgentCliFallbackRunner(runnerDeps).run({
      kind: 'implementation',
      card: latest?.() ?? find()!,
      buildPrompt: (card) => `Implement ${card.id}. Append STATUS: DONE.`,
    });
  return {
    cardId, clock, dispatches, delays, probes, progress, pauses, store, deps, run, usageResetWait,
    activity: () => find()?.activity ?? '',
    exists: () => find() !== undefined,
    remove: () => { state = deleteCard(state, cardId); },
  };
}

suite('AI loop usage reset wait: setting and policy', () => {
  test('validator keeps 0, falls back on junk, and clamps to one week', () => {
    assert.equal(readAiLoopUsageResetMaxWaitHours(0), 0);
    assert.equal(readAiLoopUsageResetMaxWaitHours(2.5), 2.5);
    assert.equal(readAiLoopUsageResetMaxWaitHours(500), 168);
    for (const junk of [-1, Number.NaN, Number.POSITIVE_INFINITY, '6', null, undefined]) {
      assert.equal(readAiLoopUsageResetMaxWaitHours(junk), DEFAULT_AI_LOOP_USAGE_RESET_MAX_WAIT_HOURS);
    }
  });

  test('plans the earliest reset in the cap, rechecks unknowns, and declines beyond the cap', () => {
    const deadline = START + 6 * HOUR;
    const plan = planUsageWait(
      [{ provider: 'codex', snapshot: spent('codex', START + 4 * HOUR) }, { provider: 'claude-code', snapshot: spent('claude-code', START + 2 * HOUR) }],
      START, deadline, 6,
    );
    assert.deepEqual(plan, { kind: 'reset', provider: 'claude-code', resetsAt: START + 2 * HOUR, until: START + 2 * HOUR + USAGE_RESET_GRACE_MS });
    assert.ok(USAGE_RESET_GRACE_MS <= 120_000);

    const recheck = planUsageWait([{ provider: 'cursor', snapshot: unknownUsage('cursor', 'no usage') }], START, deadline, 6);
    assert.deepEqual(recheck, { kind: 'recheck', providers: ['cursor'], until: START + USAGE_RECHECK_INTERVAL_MS });

    const beyond = planUsageWait([{ provider: 'codex', snapshot: spent('codex', START + 30 * HOUR) }], START, deadline, 6);
    assert.equal(beyond.kind, 'decline');
    assert.match(beyond.kind === 'decline' ? beyond.reason : '', /2026-10-22T15:00:00\.000Z.*mwnn-kanban\.aiLoopUsageResetMaxWaitHours/);

    const late = planUsageWait([{ provider: 'cursor', snapshot: unknownUsage('cursor', 'no usage') }], deadline, deadline, 6);
    assert.match(late.kind === 'decline' ? late.reason : '', /No usage reset was reported/);
  });

  test('resumes the waited CLI unless still spent; others only on reported allowance', () => {
    assert.equal(selectRecoveredCli([{ provider: 'codex', snapshot: unknownUsage('codex', 'x') }], 'codex'), 'codex');
    assert.equal(selectRecoveredCli([{ provider: 'codex', snapshot: spent('codex', START) }], 'codex'), undefined);
    assert.equal(selectRecoveredCli([{ provider: 'cursor', snapshot: unknownUsage('cursor', 'x') }], undefined), undefined);
    assert.equal(selectRecoveredCli([{ provider: 'cursor', snapshot: left('cursor') }], undefined), 'cursor');
  });

  test('usageWait.providerLabel uses the selectable Cursor identity label', () => {
    assert.equal(usageWaitProviderLabel('cursor', 'auto'), AGENT_CLI_LABELS.cursor);
    assert.equal(usageWaitProviderLabel('cursor', 'composer-2.5'), AGENT_CLI_LABELS.cursor);
    assert.equal(usageWaitProviderLabel('cursor'), AGENT_CLI_LABELS.cursor);
    assert.equal(usageWaitProviderLabel('cursor-other', 'claude-opus-5.5'), AGENT_CLI_LABELS['cursor-other']);
    assert.equal(usageWaitProviderLabel('cursor-other', 'gpt-5.6-sol'), AGENT_CLI_LABELS['cursor-other']);
    assert.equal(usageWaitProviderLabel('codex'), AGENT_CLI_LABELS.codex);
  });
});

suite('AI loop usage reset wait: fallback runner', () => {
  test('known reset within the cap: waits on the wall clock in ticks and retries the same stage', async () => {
    const reset = START + 2 * HOUR;
    const h = harness({
      behaviour: (_provider, dispatch) => (dispatch === 0 ? 'fail' : 'done'),
      probe: (provider, now) => (now < reset ? spent(provider, reset) : left(provider)),
    });
    const outcome = await h.run(h.deps());

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, true);
    assert.equal(h.dispatches.length, 2);
    assert.ok(h.dispatches[1]!.at >= reset && h.dispatches[1]!.at <= reset + 120_000);
    assert.ok(h.delays.every((ms) => ms > 0 && ms <= USAGE_WAIT_TICK_MS));
    assert.equal(h.pauses.length, 0);
    const retry = h.dispatches[1]!.prompt;
    assert.ok(retry.includes('## Handoff note'));
    assert.ok(retry.includes(`stopped because ${CLAUDE} hit its usage limit`));
    assert.ok(retry.includes('do not restart completed work'));
    const activity = h.activity();
    assert.ok(activity.includes('AI loop waiting for a usage limit reset'));
    assert.ok(activity.includes(`Stage: implementation. CLI: ${CLAUDE}. Exhaustion reason:`));
    assert.ok(activity.includes(`Reset time: ${new Date(reset).toISOString()}. Max wait: 6 hours`));
    assert.ok(activity.includes('AI loop resumed after a usage limit reset'));
    assert.ok(h.progress.some((line) => line.startsWith(`Waiting for ${CLAUDE}'s usage limit to reset at `) && line.endsWith('. Stop ends the run.')));
  });

  test('reset beyond the cap stops with the pause entry and names the setting', async () => {
    const h = harness({ behaviour: () => 'fail', probe: (provider) => spent(provider, START + 72 * HOUR) });
    const outcome = await h.run(h.deps({ settings: { enabled: true, providers: [] } }));

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.exhaustedWithoutFallback, true);
    assert.equal(h.dispatches.length, 1);
    assert.equal(h.delays.length, 0);
    assert.equal(h.pauses.length, 1);
    assert.ok(h.pauses[0]!.includes(new Date(START + 72 * HOUR).toISOString()));
    assert.ok(h.pauses[0]!.includes('mwnn-kanban.aiLoopUsageResetMaxWaitHours'));
    assert.ok(h.activity().includes('AI loop paused: no AI CLI with an available allowance'));
    assert.ok(!h.activity().includes('waiting for a usage limit reset'));
  });

  test('setting 0 keeps the existing stop: no probe, no wait, unchanged reason', async () => {
    const h = harness({ behaviour: () => 'fail', probe: (provider) => spent(provider, START + HOUR), maxWaitHours: 0 });
    const paused = await h.run(h.deps({ settings: { enabled: true, providers: [] }, usageResetWait: { ...h.usageResetWait, maxWaitHours: 0 } }));
    assert.ok(paused.kind === 'ran' && paused.exhaustedWithoutFallback);
    assert.ok(h.activity().includes('AI loop paused: no AI CLI with an available allowance'));
    assert.ok(!h.pauses[0]!.includes('aiLoopUsageResetMaxWaitHours'));

    const disabled = await h.run(h.deps({ usageResetWait: { ...h.usageResetWait, maxWaitHours: 0 } }));
    assert.ok(disabled.kind === 'ran');
    assert.equal(disabled.result.failure, 'credit-exhausted');
    assert.ok(!disabled.result.reason?.includes('aiLoopUsageResetMaxWaitHours'));
    assert.equal(h.probes.length, 0);
    assert.equal(h.delays.length, 0);
  });

  test('unknown reset rechecks every 30 minutes and resumes once allowance is reported', async () => {
    const h = harness({
      behaviour: (_provider, dispatch) => (dispatch === 0 ? 'fail' : 'done'),
      probe: (provider, now) => (now - START >= HOUR ? left(provider, 20) : unknownUsage(provider, 'usage unavailable')),
    });
    const outcome = await h.run(h.deps());

    assert.ok(outcome.kind === 'ran' && outcome.result.completed);
    assert.equal(h.probes.length, 3);
    assert.equal(h.dispatches[1]!.at, START + HOUR);
    assert.ok(h.activity().includes('Reset time: unknown, rechecking every 30 minutes.'));
    assert.ok(h.progress.some((line) => line.includes('rechecking every 30 minutes')));
  });

  test('unknown reset that never recovers stops when the max wait runs out', async () => {
    const h = harness({
      behaviour: () => 'fail',
      probe: (provider) => unknownUsage(provider, 'usage unavailable'),
      maxWaitHours: 1,
    });
    const outcome = await h.run(h.deps({ settings: { enabled: true, providers: [] } }));

    assert.ok(outcome.kind === 'ran' && outcome.exhaustedWithoutFallback);
    assert.equal(h.dispatches.length, 1);
    assert.equal(h.clock.now, START + HOUR);
    assert.ok(h.pauses[0]!.includes(`No usage reset was reported for ${CLAUDE} within the 1-hour maximum wait`));
    assert.ok(h.activity().includes('AI loop paused: no AI CLI with an available allowance'));
  });

  test('falls back first, then waits for the earliest reset and clears only that CLI', async () => {
    const resets: Partial<Record<AgentCliProviderId, number>> = { codex: START + 4 * HOUR, 'claude-code': START + 2 * HOUR };
    const h = harness({
      behaviour: (_provider, dispatch) => (dispatch === 0 ? 'fail' : 'done'),
      probe: (provider, now) => {
        const reset = resets[provider];
        if (reset === undefined) { return unknownUsage(provider, 'usage unavailable'); }
        return now < reset ? spent(provider, reset) : left(provider);
      },
    });
    const runner = createAgentCliFallbackRunner(h.deps({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['claude-code', 'copilot'] },
      resolveTarget: resolverFor(['claude-code', 'copilot']),
    }));
    const outcome = await runner.run({ kind: 'implementation', card: (await h.store.reload()).columns[2]!.cards[0]!, buildPrompt: () => 'Implement' });

    assert.ok(outcome.kind === 'ran' && outcome.result.completed);
    assert.deepEqual(h.dispatches.map((entry) => entry.provider), ['codex', 'claude-code', 'copilot', 'claude-code']);
    assert.equal(outcome.target.provider, 'claude-code');
    assert.ok(h.dispatches[3]!.at >= START + 2 * HOUR && h.dispatches[3]!.at < START + 4 * HOUR);
    assert.deepEqual([...runner.exhaustedProviders()].sort(), ['codex', 'copilot']);
    assert.ok(h.activity().includes('Switched from'));
  });

  test('orchestrator path: waits when it finds none, and clears its exclusion on resume', async () => {
    const reset = START + 3 * HOUR;
    let failed = false;
    const h = harness({
      behaviour: (_provider, dispatch) => {
        if (dispatch === 0) { failed = true; return 'fail'; }
        return 'done';
      },
      probe: (provider, now) => (!failed ? { kind: 'reported', provider, remainingPercent: 30, resetsAt: reset } : now < reset ? spent(provider, reset) : left(provider)),
    });
    const orchestrator = createAgentCliUsageOrchestrator({
      configuredPaths: {},
      cwd: 'E:\\workspace',
      now: () => h.clock.now,
      resolveTarget: resolverFor(['claude-code']),
      probe: h.usageResetWait.probe!,
    });
    const runner = createAgentCliFallbackRunner(h.deps({ orchestrator }));
    const outcome = await runner.run({ kind: 'implementation', card: (await h.store.reload()).columns[2]!.cards[0]!, buildPrompt: () => 'Implement' });

    assert.ok(outcome.kind === 'ran' && outcome.result.completed);
    assert.equal(h.dispatches.length, 2);
    assert.equal(h.pauses.length, 0);
    assert.deepEqual(runner.exhaustedProviders(), []);
    // The orchestrator chooses Claude Code again rather than reporting none.
    const next = await orchestrator.choose();
    assert.equal(next.kind, 'chosen');
  });

  test('a retry that is exhausted again waits again, each wait capped on its own', async () => {
    let spentUntil: number | undefined;
    const h = harness({
      behaviour: (_provider, dispatch) => {
        if (dispatch < 2) { spentUntil = h.clock.now + 4 * HOUR; return 'fail'; }
        return 'done';
      },
      probe: (provider, now) => (spentUntil !== undefined && now < spentUntil ? spent(provider, spentUntil) : left(provider)),
      maxWaitHours: 5,
    });
    const outcome = await h.run(h.deps());

    assert.ok(outcome.kind === 'ran' && outcome.result.completed);
    assert.equal(h.dispatches.length, 3);
    assert.ok(h.clock.now - START > 5 * HOUR, 'the total wait exceeds one cap');
    assert.equal(h.activity().split('AI loop waiting for a usage limit reset').length - 1, 2);
    assert.ok(h.dispatches[2]!.at - h.dispatches[1]!.at >= 4 * HOUR, 'never redispatched without a wait');
  });

  test('Stop during a wait ends it promptly without dispatching', async () => {
    const abort = new AbortController();
    const h = harness({
      behaviour: () => 'fail',
      probe: (provider) => spent(provider, START + 2 * HOUR),
      onDelay: () => { if (h.delays.length === 3) { abort.abort(); } },
    });
    const outcome = await h.run(h.deps({ signal: abort.signal }));

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.cancelled, true);
    assert.equal(outcome.result.failure, undefined);
    assert.equal(h.dispatches.length, 1);
    assert.equal(h.delays.length, 3);
    assert.equal(h.pauses.length, 0);
  });

  test('Pause during a wait does not shorten it; the retry holds at the pause gate until Play', async () => {
    const gate = createAiLoopPauseGate();
    const reset = START + HOUR;
    const h = harness({
      behaviour: (_provider, dispatch) => (dispatch === 0 ? 'fail' : 'done'),
      probe: (provider, now) => (now < reset ? spent(provider, reset) : left(provider)),
      onDelay: () => { if (h.delays.length === 1) { gate.pause(); } },
    });
    const running = h.run(h.deps({ waitBeforeDispatch: () => gate.waitWhilePaused() }));
    for (let i = 0; i < 500 && !h.activity().includes('resumed after a usage limit reset'); i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.ok(h.clock.now >= reset, 'the wait ran its full length');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(h.dispatches.length, 1, 'held at the pause gate');
    gate.resume();
    const outcome = await running;
    assert.ok(outcome.kind === 'ran' && outcome.result.completed);
    assert.equal(h.dispatches.length, 2);
  });

  test('a card deleted during the wait is not dispatched on resume', async () => {
    const reset = START + HOUR;
    const h = harness({
      behaviour: () => 'fail',
      probe: (provider, now) => (now < reset ? spent(provider, reset) : left(provider)),
      onDelay: () => { if (h.delays.length === 1) { h.remove(); } },
    });
    const outcome = await h.run(h.deps());

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, false);
    assert.match(outcome.result.reason ?? '', /no longer exists/);
    assert.equal(h.dispatches.length, 1);
    assert.equal(h.exists(), false);
  });

  test('a clock jump past the reset resumes within one tick', async () => {
    const reset = START + 2 * HOUR;
    const h = harness({
      behaviour: (_provider, dispatch) => (dispatch === 0 ? 'fail' : 'done'),
      probe: (provider, now) => (now < reset ? spent(provider, reset) : left(provider)),
      // The machine slept: the first tick returns ten hours later.
      advance: (ms) => (h.delays.length === 1 ? 10 * HOUR : ms),
    });
    const outcome = await h.run(h.deps());

    assert.ok(outcome.kind === 'ran' && outcome.result.completed);
    assert.equal(h.delays.length, 1);
    assert.equal(h.dispatches[1]!.at, START + 10 * HOUR);
  });

  test('Cursor Agent CLI and Cursor Agent CLI Other waits set usageWait.providerLabel to that identity', async () => {
    const cases: { provider: 'cursor' | 'cursor-other'; model: string; label: string }[] = [
      { provider: 'cursor', model: 'auto', label: AGENT_CLI_LABELS.cursor },
      { provider: 'cursor-other', model: 'claude-opus-5.5', label: AGENT_CLI_LABELS['cursor-other'] },
    ];
    for (const { provider: cli, model, label } of cases) {
      const reset = START + HOUR;
      const waits: ({ providerLabel: string; resetsAt?: number; nextCheckAt?: number } | undefined)[] = [];
      const h = harness({
        behaviour: () => 'done',
        probe: (provider, now) => (now < reset ? spent(provider, reset) : left(provider)),
      });
      let dispatch = 0;
      const selection = {
        requested: model,
        source: 'workspace-default' as const,
        applied: true,
        args: ['--model', model],
      };
      const outcome = await h.run(h.deps({
        initialTarget: target(cli),
        onUsageWait: (wait) => { waits.push(wait); },
        runHandoff: async () => {
          if (dispatch === 0) {
            dispatch += 1;
            return {
              completed: false,
              cancelled: false,
              activityBaseline: 0,
              failure: 'credit-exhausted' as const,
              reason: 'usage limit',
              creditExhaustion: { detail: `${label} usage limit reached.` },
              modelSelection: selection,
            };
          }
          dispatch += 1;
          return { completed: true, cancelled: false, activityBaseline: 0, modelSelection: selection };
        },
      }));

      assert.ok(outcome.kind === 'ran' && outcome.result.completed, model);
      const waiting = waits.find((wait) => wait !== undefined);
      assert.deepEqual(waiting, { providerLabel: label, resetsAt: reset }, model);
      assert.ok(waits.some((wait) => wait === undefined), `cleared after resume (${model})`);
    }
  });
});

suite('planPaceWait', () => {
  test('one window: waits until its predicted behind time plus grace', () => {
    const reset = START + FIVE_HOUR_WINDOW_MS;
    const predicted = predictBehindAtMs({
      usedPercent: 20,
      resetsAtMs: reset,
      lengthMs: FIVE_HOUR_WINDOW_MS,
      asOfMs: START,
    })!;
    const plan = planPaceWait(
      [{ provider: 'codex', reason: 'ahead of pace', predictedBehindAtMs: predicted }],
      START,
      START + 6 * HOUR,
      6,
    );
    assert.deepEqual(plan, {
      kind: 'pace',
      provider: 'codex',
      predictedBehindAt: predicted,
      until: predicted + USAGE_RESET_GRACE_MS,
    });
  });

  test('multiple windows: the earliest CLI time across CLIs wakes the wait', () => {
    const sooner = START + HOUR;
    const later = START + 2 * HOUR;
    const plan = planPaceWait(
      [
        { provider: 'claude-code', reason: 'ahead', predictedBehindAtMs: later },
        { provider: 'codex', reason: 'ahead', predictedBehindAtMs: sooner },
      ],
      START,
      START + 6 * HOUR,
      6,
    );
    assert.equal(plan.kind, 'pace');
    if (plan.kind === 'pace') {
      assert.equal(plan.provider, 'codex');
      assert.equal(plan.predictedBehindAt, sooner);
    }
  });

  test('crossing after reset uses the next-cycle prediction', () => {
    const reset = START + FIVE_HOUR_WINDOW_MS;
    const predicted = predictBehindAtMs({
      usedPercent: 96,
      resetsAtMs: reset,
      lengthMs: FIVE_HOUR_WINDOW_MS,
      asOfMs: START,
    })!;
    assert.equal(
      predicted,
      reset + (AI_USAGE_PACE_TOLERANCE_POINTS / 100) * FIVE_HOUR_WINDOW_MS,
    );
    const plan = planPaceWait(
      [{ provider: 'codex', reason: 'ahead', predictedBehindAtMs: predicted }],
      START,
      START + 8 * HOUR,
      8,
    );
    assert.equal(plan.kind, 'pace');
    if (plan.kind === 'pace') {
      assert.equal(plan.predictedBehindAt, predicted);
    }
  });

  test('no computable prediction rechecks every 30 minutes', () => {
    const plan = planPaceWait(
      [{ provider: 'copilot', reason: 'pace unknown (no known-length usage window)' }],
      START,
      START + 6 * HOUR,
      6,
    );
    assert.deepEqual(plan, {
      kind: 'recheck',
      until: START + USAGE_RECHECK_INTERVAL_MS,
    });
  });

  test('0 max wait hours declines pace waits', () => {
    const plan = planPaceWait(
      [{ provider: 'codex', reason: 'ahead', predictedBehindAtMs: START + HOUR }],
      START,
      START + 6 * HOUR,
      0,
    );
    assert.equal(plan.kind, 'decline');
    assert.match(plan.kind === 'decline' ? plan.reason : '', /aiLoopUsageResetMaxWaitHours/);
  });

  test('a prediction beyond the cap declines with the CLI and time', () => {
    const predicted = START + 10 * HOUR;
    const plan = planPaceWait(
      [{ provider: 'codex', reason: 'ahead', predictedBehindAtMs: predicted }],
      START,
      START + 6 * HOUR,
      6,
    );
    assert.equal(plan.kind, 'decline');
    assert.match(plan.kind === 'decline' ? plan.reason : '', /OpenAI Codex CLI/);
    assert.match(plan.kind === 'decline' ? plan.reason : '', new RegExp(new Date(predicted).toISOString()));
  });
});
