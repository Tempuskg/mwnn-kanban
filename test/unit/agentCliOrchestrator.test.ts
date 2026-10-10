import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { createAgentCliFallbackRunner } from '../../src/agentCliFallback';
import {
  AGENT_CLI_LABELS,
  runAgentCliCardHandoff,
  type AgentCliCardHandoff,
  type AgentCliCardHandoffOptions,
  type AgentCliProcessResult,
  type AgentCliProviderId,
  type AgentCliResolution,
  type AgentCliTarget,
} from '../../src/agentCliHandoff';
import {
  createAgentCliUsageOrchestrator,
  formatOrchestratorChoiceEntry,
  type AgentCliOrchestratorDeps,
  type AgentCliUsageOrchestrator,
} from '../../src/agentCliOrchestrator';
import { unknownUsage, type AgentCliUsageSnapshot } from '../../src/agentCliUsage';
import { runCardWithAgentCli, type RunCardWithAgentCliDeps } from '../../src/runWithAi';
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
import type { Assignee, BoardState, Card } from '../../src/types';

const START = Date.parse('2026-10-07T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function target(provider: AgentCliProviderId): AgentCliTarget {
  return {
    provider,
    label: AGENT_CLI_LABELS[provider],
    executable: `${provider}-executable`,
    launcher: 'standalone',
  };
}

function resolverFor(available: readonly AgentCliProviderId[]): NonNullable<AgentCliOrchestratorDeps['resolveTarget']> {
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

interface Clock {
  now: number;
}

interface ProbeLog {
  calls: AgentCliProviderId[];
  active: number;
  maxActive: number;
}

/**
 * An orchestrator over scripted snapshots, with no real process: reported
 * figures for some providers, unknown for the rest.
 */
function orchestratorWith(
  available: readonly AgentCliProviderId[],
  snapshots: Partial<Record<AgentCliProviderId, AgentCliUsageSnapshot | 'throw'>>,
  clock: Clock,
  log: ProbeLog = { calls: [], active: 0, maxActive: 0 },
): AgentCliUsageOrchestrator {
  return createAgentCliUsageOrchestrator({
    configuredPaths: {},
    cwd: 'E:\\workspace',
    now: () => clock.now,
    resolveTarget: resolverFor(available),
    probe: async (probed) => {
      log.calls.push(probed.provider);
      log.active += 1;
      log.maxActive = Math.max(log.maxActive, log.active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.active -= 1;
      const scripted = snapshots[probed.provider];
      if (scripted === 'throw') {
        throw new Error('probe crashed');
      }
      return scripted ?? unknownUsage(probed.provider, `${probed.label} usage is not supported yet.`);
    },
  });
}

async function chosenProvider(orchestrator: AgentCliUsageOrchestrator): Promise<string> {
  const decision = await orchestrator.choose();
  return decision.kind === 'chosen' ? decision.target.provider : 'none';
}

suite('Usage Orchestrator choice', () => {
  test('drains: reset-reporting CLI, then each unknown CLI until exhaustion, then no-reset reporting CLIs', async () => {
    const clock: Clock = { now: START };
    const orchestrator = orchestratorWith(
      ['copilot', 'codex', 'claude-code', 'cursor'],
      {
        codex: { kind: 'reported', provider: 'codex', remainingPercent: 40, resetsAt: START + 5 * HOUR },
        cursor: { kind: 'reported', provider: 'cursor', remainingPercent: 70 },
      },
      clock,
    );

    assert.equal(await chosenProvider(orchestrator), 'codex');
    orchestrator.markExhausted('codex');
    // Unknown CLIs in built-in order, each kept until it stops accepting work.
    assert.equal(await chosenProvider(orchestrator), 'copilot');
    assert.equal(await chosenProvider(orchestrator), 'copilot');
    orchestrator.markExhausted('copilot');
    assert.equal(await chosenProvider(orchestrator), 'claude-code');
    orchestrator.markExhausted('claude-code');
    assert.equal(await chosenProvider(orchestrator), 'cursor');
    orchestrator.markExhausted('cursor');
    const none = await orchestrator.choose();
    assert.equal(none.kind, 'none');
    assert.match(none.kind === 'none' ? none.reason : '', /no agent CLI with usage left/);

    // The exhausted reset-reporting CLI comes back once its reset passes; the
    // unknown ones, which report no reset, never do in this run.
    clock.now = START + 5 * HOUR + 1;
    assert.equal(await chosenProvider(orchestrator), 'codex');
  });

  test('probes available CLIs concurrently and reuses snapshots only within the freshness window', async () => {
    const clock: Clock = { now: START };
    const log: ProbeLog = { calls: [], active: 0, maxActive: 0 };
    const orchestrator = orchestratorWith(['codex', 'claude-code', 'cursor'], {}, clock, log);

    await orchestrator.choose();
    assert.deepEqual([...log.calls].sort(), ['claude-code', 'codex', 'cursor']);
    assert.equal(log.maxActive, 3);

    clock.now = START + 30_000;
    await orchestrator.choose();
    assert.equal(log.calls.length, 3, 'fresh snapshots are reused');

    clock.now = START + 61_000;
    await orchestrator.choose();
    assert.equal(log.calls.length, 6, 'stale snapshots are re-read');
  });

  test('a failing probe still yields a choice, and an unavailable CLI is skipped', async () => {
    const clock: Clock = { now: START };
    const orchestrator = orchestratorWith(['codex'], { codex: 'throw' }, clock);
    const decision = await orchestrator.choose();
    assert.equal(decision.kind, 'chosen');
    assert.equal(decision.kind === 'chosen' ? decision.chosen.snapshot.kind : undefined, 'unknown');
    assert.deepEqual(
      decision.ranking.skipped.map((entry) => entry.provider),
      ['copilot', 'claude-code', 'cursor'],
    );
  });

  test('a reporting CLI at 0% with no reset is out for the rest of the run', async () => {
    const clock: Clock = { now: START };
    const orchestrator = orchestratorWith(
      ['codex', 'cursor'],
      { codex: { kind: 'reported', provider: 'codex', remainingPercent: 0 } },
      clock,
    );
    assert.equal(await chosenProvider(orchestrator), 'cursor');
  });

  test('the Activity entry names the CLI and why', () => {
    const at = new Date(START);
    const reset = formatOrchestratorChoiceEntry(
      {
        provider: 'codex',
        rule: 'soonest-reset',
        snapshot: { kind: 'reported', provider: 'codex', remainingPercent: 94, resetsAt: START + HOUR },
      },
      'implementation',
      at,
    );
    assert.match(reset, /Usage Orchestrator chose OpenAI Codex CLI/);
    assert.match(reset, /94% remaining/);
    assert.match(reset, new RegExp(new Date(START + HOUR).toISOString().replace(/[.]/g, '\\.')));

    const drained = formatOrchestratorChoiceEntry(
      { provider: 'cursor', rule: 'unknown-drain', snapshot: unknownUsage('cursor', 'no usage query') },
      'definition',
      at,
    );
    assert.match(drained, /usage is unknown/);
    assert.match(drained, /drained until it stops accepting work/);
    assert.doesNotMatch(drained, /^STATUS:/m);
  });
});

interface FakeBoard {
  readonly store: {
    reload(): Promise<BoardState>;
    appendActivity(cardId: string, entry: string): Promise<void>;
    moveCard(cardId: string, toColumnId: string, toIndex: number): Promise<void>;
    setAssignee(cardId: string, assignee: Assignee | undefined): Promise<void>;
    setAcceptanceCriteria(cardId: string, acceptanceCriteria: string): Promise<void>;
  };
  card(cardId: string): Card;
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
      moveCard: async (cardId, toColumnId, toIndex) => {
        state = moveCard(state, cardId, toColumnId, toIndex);
      },
      setAssignee: async (cardId, assignee) => {
        state = setAssignee(state, cardId, assignee);
      },
      setAcceptanceCriteria: async (cardId, acceptanceCriteria) => {
        state = setAcceptanceCriteria(state, cardId, acceptanceCriteria);
      },
    },
    card,
  };
}

function boardWithCard(): { readonly state: BoardState; readonly cardId: string } {
  let state = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Verify', 'Done']);
  state = addCard(state, state.columns[2]!.id, 'Orchestrated work');
  const cardId = state.columns[2]!.cards[0]!.id;
  state = setAssignee(state, cardId, { kind: 'ai' });
  state = setDescription(state, cardId, 'Spread work across CLIs.');
  state = setAcceptanceCriteria(state, cardId, '- [ ] The stage finishes');
  return { state, cardId };
}

const creditFailure: AgentCliProcessResult = {
  started: true,
  cancelled: false,
  exitCode: 1,
  signal: null,
  stdout: '',
  stderr: "You've hit your weekly usage limit for this plan.",
};

/**
 * Real handoff evidence rules over simulated processes: a CLI either fails on
 * exhaustion, or writes `STATUS: DONE` to the card and exits cleanly.
 */
function simulated(
  board: FakeBoard,
  exhaustedProviders: Set<AgentCliProviderId>,
  log: AgentCliProviderId[],
  concurrent: { count: number; max: number },
): (handoff: AgentCliCardHandoff, options?: AgentCliCardHandoffOptions) => ReturnType<typeof runAgentCliCardHandoff> {
  return (handoff, options) =>
    runAgentCliCardHandoff(handoff, {
      ...options,
      now: () => new Date(START),
      runProcess: async (invocation) => {
        concurrent.count += 1;
        concurrent.max = Math.max(concurrent.max, concurrent.count);
        log.push(invocation.provider);
        try {
          if (exhaustedProviders.has(invocation.provider)) {
            return creditFailure;
          }
          await board.store.appendActivity(handoff.cardId, `${invocation.label} finished.\nSTATUS: DONE`);
          return { started: true, cancelled: false, exitCode: 0, signal: null, stdout: 'done', stderr: '' };
        } finally {
          concurrent.count -= 1;
        }
      },
    });
}

suite('Usage Orchestrator in the AI loop runner', () => {
  test('re-ranks before every stage and re-routes an exhausted stage to the next-ranked CLI', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const clock: Clock = { now: START };
    const orchestrator = orchestratorWith(
      ['codex', 'claude-code', 'cursor'],
      { codex: { kind: 'reported', provider: 'codex', remainingPercent: 50, resetsAt: START + 3 * HOUR } },
      clock,
    );
    const exhaustedProviders = new Set<AgentCliProviderId>(['codex']);
    const log: AgentCliProviderId[] = [];
    const concurrent = { count: 0, max: 0 };
    const rankings: string[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('cursor'),
      // Fallback disabled and empty: an orchestrated run retries anyway.
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => new Date(START),
      orchestrator,
      onRanking: (lines) => rankings.push(...lines),
      runHandoff: simulated(board, exhaustedProviders, log, concurrent),
    });

    const card = board.card(cardId);
    const outcome = await runner.run({ kind: 'implementation', card, buildPrompt: (current) => `Work on ${current.title}` });
    assert.equal(outcome.kind, 'ran');
    assert.ok(outcome.kind === 'ran' && outcome.result.completed);
    assert.equal(outcome.kind === 'ran' ? outcome.target.provider : undefined, 'claude-code');
    assert.deepEqual(log, ['codex', 'claude-code']);
    assert.equal(concurrent.max, 1, 'at most one handoff is active');

    const activity = board.card(cardId).activity ?? '';
    assert.match(activity, /Usage Orchestrator chose OpenAI Codex CLI/);
    assert.match(activity, /Switched from OpenAI Codex CLI/);
    assert.match(activity, /Usage Orchestrator chose Anthropic Claude Code CLI/);
    assert.match(activity, /being drained until it stops accepting work/);
    assert.ok(rankings.some((line) => /skipped - .*Copilot/.test(line)));

    // The next stage re-ranks: Codex is out until its reset, so Claude Code
    // keeps draining; after the reset Codex is chosen again.
    const next = await runner.run({ kind: 'verification', card: board.card(cardId), buildPrompt: () => 'Verify' });
    assert.equal(next.kind === 'ran' ? next.target.provider : undefined, 'claude-code');
    exhaustedProviders.delete('codex');
    clock.now = START + 3 * HOUR + 1;
    const afterReset = await runner.run({ kind: 'verification', card: board.card(cardId), buildPrompt: () => 'Verify' });
    assert.equal(afterReset.kind === 'ran' ? afterReset.target.provider : undefined, 'codex');
  });

  test('keeps model evidence scoped to each orchestrated CLI after a credit fallback', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const clock: Clock = { now: START };
    const orchestrator = orchestratorWith(['copilot', 'claude-code'], {}, clock);
    const output: string[] = [];
    const providers: AgentCliProviderId[] = [];
    let nowCalls = 0;
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('cursor'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      orchestrator,
      runHandoff: (handoff, options) => runAgentCliCardHandoff(handoff, {
        ...options,
        now: () => new Date(START + nowCalls++ * 1_000),
        observer: { onOutput: (chunk) => output.push(chunk) },
        runProcess: async (invocation, _signal, observer) => {
          providers.push(invocation.provider);
          if (invocation.provider === 'copilot') {
            observer?.onOutput?.('Using model: claude-opus-5.5\n', 'stdout');
            return {
              ...creditFailure,
              stderr: 'You have exhausted your weekly usage limit.',
            };
          }
          observer?.onOutput?.('{"type":"system","subtype":"init","model":"claude-sonnet-5.5"}\n', 'stdout');
          await board.store.appendActivity(cardId, 'Claude finished.\nSTATUS: DONE');
          return { started: true, cancelled: false, exitCode: 0, signal: null, stdout: '', stderr: '' };
        },
      }),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: () => 'Complete the work.',
    });
    assert.equal(outcome.kind, 'ran');
    assert.ok(outcome.kind === 'ran' && outcome.result.completed);
    assert.deepEqual(providers, ['copilot', 'claude-code']);

    const activity = board.card(cardId).activity ?? '';
    const starts = output.filter((entry) => /Usage Orchestrator dispatch dispatch-.* started/.test(entry));
    const observations = output.filter((entry) => /Actual model: ".*"/.test(entry));
    assert.equal(starts.length, 2);
    assert.equal(observations.length, 2);
    const attemptIds = starts.map((entry) => /dispatch-[-a-z0-9]+/.exec(entry)?.[0]);
    assert.ok(attemptIds[0]);
    assert.ok(attemptIds[1]);
    assert.notEqual(attemptIds[0], attemptIds[1]);
    assert.match(observations[0] ?? '', /claude-opus-5\.5/);
    assert.match(observations[0] ?? '', /GitHub Copilot CLI/);
    assert.match(observations[1] ?? '', /claude-sonnet-5\.5/);
    assert.match(observations[1] ?? '', /Anthropic Claude Code CLI/);
    assert.ok(observations.every((entry) => activity.includes(entry.trimEnd())));
    assert.match(activity, /Usage Orchestrator chose GitHub Copilot CLI/);
    assert.match(activity, /Switched from GitHub Copilot CLI to Anthropic Claude Code CLI/);
    assert.match(activity, /Usage Orchestrator chose Anthropic Claude Code CLI/);
  });

  test('records distinct requested and observed models for an orchestrated escalation retry', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const output: string[] = [];
    const models: (string | undefined)[] = [];
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('copilot'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      modelCatalog: { copilot: ['cheap-model'] },
      escalation: {
        enabled: true,
        ladders: { copilot: ['cheap-model', 'strong-model'] },
        overrideCardModel: false,
      },
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      orchestrator: orchestratorWith(['copilot'], {}, { now: START }),
      runHandoff: (handoff, options) => runAgentCliCardHandoff(handoff, {
        ...options,
        observer: { onOutput: (chunk) => output.push(chunk) },
        runProcess: async (invocation, _signal, observer) => {
          const modelIndex = invocation.args.indexOf('--model');
          const requested = modelIndex < 0 ? undefined : invocation.args[modelIndex + 1];
          models.push(requested);
          const actual = requested === 'strong-model' ? 'copilot-model-strong' : 'copilot-model-cheap';
          observer?.onOutput?.(`Model: ${actual}\n`, 'stdout');
          if (requested === 'strong-model') {
            await board.store.appendActivity(cardId, 'Escalated run finished.\nSTATUS: DONE');
          }
          return { started: true, cancelled: false, exitCode: 0, signal: null, stdout: '', stderr: '' };
        },
      }),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: () => 'Complete the work.',
    });
    assert.equal(outcome.kind, 'ran');
    assert.ok(outcome.kind === 'ran' && outcome.result.completed);
    assert.deepEqual(models, ['cheap-model', 'strong-model']);

    const starts = output.filter((entry) => /Usage Orchestrator dispatch dispatch-.* started/.test(entry));
    const observations = output.filter((entry) => /Actual model: "copilot-model-/.test(entry));
    assert.equal(starts.length, 2);
    assert.equal(observations.length, 2);
    assert.match(starts[0] ?? '', /Requested model: "cheap-model" \(source: the workspace default model;/);
    assert.match(starts[1] ?? '', /Requested model: "strong-model" \(source: the AI loop model escalation ladder;/);
    assert.match(observations[0] ?? '', /copilot-model-cheap/);
    assert.match(observations[1] ?? '', /copilot-model-strong/);
    assert.ok(starts.every((entry) => board.card(cardId).activity?.includes(entry.trimEnd())));
    assert.ok(observations.every((entry) => board.card(cardId).activity?.includes(entry.trimEnd())));
  });

  test('pauses without advancing when no eligible CLI is left', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const clock: Clock = { now: START };
    const pauses: string[] = [];
    const log: AgentCliProviderId[] = [];
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('cursor'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => new Date(START),
      orchestrator: orchestratorWith(['cursor'], {}, clock),
      onPause: (reason) => pauses.push(reason),
      runHandoff: simulated(board, new Set(['cursor']), log, { count: 0, max: 0 }),
    });

    const columnOf = async (): Promise<string | undefined> =>
      (await board.store.reload()).columns.find((column) =>
        column.cards.some((candidate) => candidate.id === cardId))?.id;
    const columnBefore = await columnOf();
    const outcome = await runner.run({ kind: 'implementation', card: board.card(cardId), buildPrompt: () => 'Work' });
    assert.equal(outcome.kind === 'ran' ? outcome.exhaustedWithoutFallback : undefined, true);
    assert.deepEqual(log, ['cursor']);
    assert.equal(pauses.length, 1);
    assert.equal(await columnOf(), columnBefore);
    assert.match(board.card(cardId).activity ?? '', /AI loop paused: no AI CLI with usage left/);
    assert.equal((await runner.run({ kind: 'implementation', card: board.card(cardId), buildPrompt: () => 'Work' })).kind, 'paused');
  });

  test('without an orchestrator no usage is probed and the fixed CLI runs', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: AgentCliProviderId[] = [];
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => new Date(START),
      runHandoff: simulated(board, new Set(), log, { count: 0, max: 0 }),
    });
    const outcome = await runner.run({ kind: 'implementation', card: board.card(cardId), buildPrompt: () => 'Work' });
    assert.equal(outcome.kind === 'ran' ? outcome.target.provider : undefined, 'codex');
    assert.deepEqual(log, ['codex']);
    assert.doesNotMatch(board.card(cardId).activity ?? '', /Usage Orchestrator/);
  });
});

suite('Usage Orchestrator in Run Card with AI', () => {
  function deps(board: FakeBoard, overrides: Partial<RunCardWithAgentCliDeps>): {
    readonly deps: RunCardWithAgentCliDeps;
    readonly warnings: string[];
  } {
    const warnings: string[] = [];
    return {
      warnings,
      deps: {
        configuredPaths: {},
        cwd: 'E:\\workspace',
        store: board.store,
        runWithProgress: (_title, task) => task(new AbortController().signal, () => undefined),
        showInformation: () => undefined,
        showWarning: (message) => warnings.push(message),
        refreshBoard: () => undefined,
        ...overrides,
      },
    };
  }

  test('ranks once at dispatch and records the choice', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: AgentCliProviderId[] = [];
    let chooseCalls = 0;
    const orchestrator = orchestratorWith(
      ['codex', 'cursor'],
      { codex: { kind: 'reported', provider: 'codex', remainingPercent: 12, resetsAt: START + HOUR } },
      { now: START },
    );
    const harness = deps(board, {
      orchestrator: {
        choose: () => {
          chooseCalls += 1;
          return orchestrator.choose();
        },
      },
      runHandoff: simulated(board, new Set(), log, { count: 0, max: 0 }),
    });

    const completed = await runCardWithAgentCli(
      { provider: 'orchestrator', kind: 'implementation', card: { id: cardId, title: 'Orchestrated work' }, prompt: 'Work' },
      harness.deps,
    );
    assert.equal(completed, true);
    assert.equal(chooseCalls, 1);
    assert.deepEqual(log, ['codex']);
    assert.match(board.card(cardId).activity ?? '', /Usage Orchestrator chose OpenAI Codex CLI/);
  });

  test('a fixed CLI choice never consults the orchestrator', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: AgentCliProviderId[] = [];
    const harness = deps(board, {
      orchestrator: {
        choose: () => {
          throw new Error('must not probe');
        },
      },
      resolveTarget: resolverFor(['cursor']),
      runHandoff: simulated(board, new Set(), log, { count: 0, max: 0 }),
    });
    const completed = await runCardWithAgentCli(
      { provider: 'cursor', kind: 'implementation', card: { id: cardId, title: 'Orchestrated work' }, prompt: 'Work' },
      harness.deps,
    );
    assert.equal(completed, true);
    assert.deepEqual(log, ['cursor']);
    assert.doesNotMatch(board.card(cardId).activity ?? '', /Usage Orchestrator/);
  });
});
