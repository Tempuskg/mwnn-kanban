import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  AI_LOOP_MAX_DISPATCHES_SETTING,
  createAiLoopBudget,
  formatAiLoopBudgetStopEntry,
  formatAiLoopBudgetStopMessage,
  formatAiLoopBudgetTally,
  parseCliUsageLines,
  readAiLoopMaxDispatches,
  type AiLoopDispatchIntent,
} from '../../src/aiLoopBudget';
import {
  createAgentCliFallbackRunner,
  type AgentCliFallbackDeps,
} from '../../src/agentCliFallback';
import {
  AGENT_CLI_LABELS,
  type AgentCliCardHandoffResult,
  type AgentCliProviderId,
  type AgentCliTarget,
} from '../../src/agentCliHandoff';
import type { AgentCliHandoffKind } from '../../src/agentCliStages';
import {
  addCard,
  appendActivity,
  cloneBoard,
  defaultBoard,
  setAcceptanceCriteria,
  setAssignee,
  setDescription,
} from '../../src/utils';
import type { BoardState, Card } from '../../src/types';

const NOW = new Date('2026-09-19T14:00:00.000Z');

function intent(
  stage: AgentCliHandoffKind,
  provider: string,
  cardId = 'card-1',
): AiLoopDispatchIntent {
  return {
    stage,
    provider,
    providerLabel: provider === 'claude-code' ? 'Claude Code' : 'Codex CLI',
    cardId,
    cardTitle: `Work on ${cardId}`,
  };
}

/** Claim one dispatch and settle it on `model`, as a real run would. */
function dispatch(
  budget: ReturnType<typeof createAiLoopBudget>,
  stage: AgentCliHandoffKind,
  provider: string,
  model?: string,
): boolean {
  const reservation = budget.reserve(intent(stage, provider));
  if (!reservation.allowed) {
    return false;
  }
  budget.settle(model);
  return true;
}

suite('AI loop dispatch budget setting', () => {
  test('treats anything but a positive whole number as no cap', () => {
    for (const value of [0, -1, -10, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '5', null, undefined, {}]) {
      assert.equal(readAiLoopMaxDispatches(value), undefined, `expected no cap for ${String(value)}`);
    }
  });

  test('accepts positive whole numbers, truncates fractions, and bounds absurd values', () => {
    assert.equal(readAiLoopMaxDispatches(1), 1);
    assert.equal(readAiLoopMaxDispatches(12), 12);
    assert.equal(readAiLoopMaxDispatches(7.9), 7);
    assert.equal(readAiLoopMaxDispatches(1_000_000), 10_000);
  });
});

suite('AI loop dispatch tally', () => {
  test('counts dispatches by stage, provider, and the model each one actually ran on', () => {
    const budget = createAiLoopBudget();
    dispatch(budget, 'implementation', 'claude-code', 'claude-opus-5');
    dispatch(budget, 'implementation', 'claude-code', 'claude-opus-5');
    dispatch(budget, 'implementation', 'claude-code');
    dispatch(budget, 'definition', 'claude-code', 'claude-haiku-4-5');
    dispatch(budget, 'triage', 'codex', 'gpt-5');

    const tally = budget.tally();
    assert.equal(tally.total, 5);
    assert.deepEqual(tally.byStage, [
      { stage: 'implementation', count: 3 },
      { stage: 'definition', count: 1 },
      { stage: 'triage', count: 1 },
    ]);
    assert.deepEqual(
      tally.byProvider.map((entry) => [entry.provider, entry.count]),
      [['claude-code', 4], ['codex', 1]],
    );
    assert.deepEqual(
      tally.byModel.map((entry) => [entry.provider, entry.model, entry.count]),
      [
        ['claude-code', 'claude-opus-5', 2],
        // The dispatch that named no model ran on whatever the CLI defaults to,
        // and is reported as its own group rather than folded into a named one.
        ['claude-code', undefined, 1],
        ['claude-code', 'claude-haiku-4-5', 1],
        ['codex', 'gpt-5', 1],
      ],
    );
  });

  test('never merges the same model name across two providers', () => {
    const budget = createAiLoopBudget();
    dispatch(budget, 'implementation', 'claude-code', 'auto');
    dispatch(budget, 'implementation', 'codex', 'auto');

    assert.equal(budget.tally().byModel.length, 2);
  });

  test('reports a tally with no dispatches without inventing figures', () => {
    const report = formatAiLoopBudgetTally(createAiLoopBudget().tally());
    assert.match(report, /no agent handoffs were dispatched/);
    assert.doesNotMatch(report, /\$/);
  });

  test('reports the partial tally of a cancelled run and says it was cancelled', () => {
    const budget = createAiLoopBudget();
    dispatch(budget, 'implementation', 'claude-code', 'claude-opus-5');
    dispatch(budget, 'verification', 'claude-code', 'claude-opus-5');

    const report = formatAiLoopBudgetTally(budget.tally(), 'cancelled');
    assert.match(report, /cancelled/);
    assert.match(report, /2 dispatches/);
    assert.match(report, /implementation 1/);
    assert.match(report, /verification 1/);
    assert.match(report, /Claude Code on claude-opus-5 2/);
  });

  test('distinguishes a budget stop from a pause and from normal completion', () => {
    const budget = createAiLoopBudget({ maxDispatches: 1 });
    dispatch(budget, 'implementation', 'claude-code', 'claude-opus-5');
    const tally = budget.tally();

    assert.match(formatAiLoopBudgetTally(tally, 'finished'), /^AI loop usage: /);
    assert.match(formatAiLoopBudgetTally(tally, 'paused'), /before it paused/);
    assert.match(formatAiLoopBudgetTally(tally, 'budget'), /at the dispatch cap/);
    assert.match(formatAiLoopBudgetTally(tally, 'cancelled'), /before it was cancelled/);
  });
});

suite('AI loop dispatch cap', () => {
  test('is disabled by default, so an uncapped run dispatches without limit', () => {
    const budget = createAiLoopBudget();
    assert.equal(budget.limit, undefined);
    for (let index = 0; index < 50; index += 1) {
      const reservation = budget.reserve(intent('implementation', 'claude-code'));
      assert.equal(reservation.allowed, true);
      if (reservation.allowed) {
        assert.equal(reservation.remaining, undefined);
      }
      budget.settle('claude-opus-5');
    }
    assert.equal(budget.stop(), undefined);
    assert.equal(budget.tally().total, 50);
    assert.equal(budget.tally().limit, undefined);
  });

  test('a cap of zero or a malformed cap behaves exactly like no cap', () => {
    for (const maxDispatches of [0, -3, Number.NaN]) {
      const budget = createAiLoopBudget({ maxDispatches });
      assert.equal(budget.limit, undefined);
      assert.equal(budget.reserve(intent('implementation', 'claude-code')).allowed, true);
      assert.equal(budget.stop(), undefined);
    }
  });

  test('allows exactly the configured number of dispatches and then refuses', () => {
    const budget = createAiLoopBudget({ maxDispatches: 3 });
    for (let index = 0; index < 3; index += 1) {
      const reservation = budget.reserve(intent('implementation', 'claude-code'));
      assert.equal(reservation.allowed, true, `dispatch ${index + 1} should be allowed`);
      if (reservation.allowed) {
        assert.equal(reservation.remaining, 2 - index);
      }
      budget.settle('claude-opus-5');
    }

    const denied = budget.reserve(intent('verification', 'claude-code', 'card-9'));
    assert.equal(denied.allowed, false);
    if (!denied.allowed) {
      assert.equal(denied.stop.limit, 3);
      assert.equal(denied.stop.dispatches, 3);
      assert.equal(denied.stop.intent.cardId, 'card-9');
      assert.equal(denied.stop.intent.stage, 'verification');
    }
    // The refused dispatch is not counted: it never ran.
    assert.equal(budget.tally().total, 3);
  });

  test('latches the stop, so nothing afterwards can resume dispatching', () => {
    const budget = createAiLoopBudget({ maxDispatches: 1 });
    dispatch(budget, 'implementation', 'claude-code', 'claude-opus-5');
    const first = budget.reserve(intent('definition', 'claude-code', 'card-2'));
    assert.equal(first.allowed, false);

    // A late exit or output event arriving after the cap was hit.
    budget.settle('claude-opus-5');
    budget.recordUsage('Claude Code', 'total tokens: 1200');

    for (const stage of ['implementation', 'definition', 'triage', 'verification'] as const) {
      assert.equal(budget.reserve(intent(stage, 'codex', 'card-3')).allowed, false);
    }
    const stop = budget.stop();
    assert.ok(stop);
    // The latched stop still describes the *first* refusal, not the last.
    assert.equal(stop.intent.cardId, 'card-2');
    assert.equal(budget.tally().total, 1);
  });

  test('a stray settle with nothing outstanding cannot corrupt the tally', () => {
    const budget = createAiLoopBudget();
    budget.settle('claude-opus-5');
    assert.equal(budget.tally().total, 0);

    dispatch(budget, 'implementation', 'claude-code', 'claude-opus-5');
    budget.settle('some-other-model');
    assert.deepEqual(
      budget.tally().byModel.map((entry) => entry.model),
      ['claude-opus-5'],
    );
  });

  test('the stop message and Activity entry name the budget, not spent credits', () => {
    const budget = createAiLoopBudget({ maxDispatches: 1 });
    dispatch(budget, 'implementation', 'claude-code', 'claude-opus-5');
    budget.reserve(intent('implementation', 'claude-code', 'card-2'));
    const stop = budget.stop();
    assert.ok(stop);

    const message = formatAiLoopBudgetStopMessage(stop);
    assert.match(message, /dispatch cap of 1/);
    assert.match(message, /not spent CLI credits/);
    assert.match(message, new RegExp(AI_LOOP_MAX_DISPATCHES_SETTING.replace(/[.]/g, '\\.')));
    assert.match(message, /0 removes the cap/);
    assert.match(message, /was not advanced/);

    const entry = formatAiLoopBudgetStopEntry(stop, NOW);
    assert.match(entry, /^### 2026-09-19T14:00:00\.000Z - AI loop stopped: dispatch budget reached$/m);
    assert.match(entry, /never started and no CLI ran for it/);
    assert.match(entry, /not exhausted CLI credits/);
    assert.doesNotMatch(entry, /out of credits/i);
  });
});

suite('CLI usage reporting', () => {
  test('quotes usage and cost lines the CLI printed, attributed to that CLI', () => {
    const budget = createAiLoopBudget();
    dispatch(budget, 'implementation', 'claude-code', 'claude-opus-5');
    budget.recordUsage(
      'Claude Code',
      [
        'Editing src/extension.ts',
        'Total cost: $0.42 USD',
        'Tokens: 12000 input, 3400 output',
        'Done.',
      ].join('\n'),
    );

    const tally = budget.tally();
    assert.deepEqual(tally.usage, [
      { providerLabel: 'Claude Code', text: 'Total cost: $0.42 USD' },
      { providerLabel: 'Claude Code', text: 'Tokens: 12000 input, 3400 output' },
    ]);
    const report = formatAiLoopBudgetTally(tally);
    assert.match(report, /Claude Code reported "Total cost: \$0\.42 USD"/);
    assert.match(report, /Claude Code reported "Tokens: 12000 input, 3400 output"/);
  });

  test('a CLI that reports no usage yields dispatch counts only, with no invented figures', () => {
    const budget = createAiLoopBudget();
    dispatch(budget, 'implementation', 'codex', 'gpt-5');
    budget.recordUsage('Codex CLI', 'Applying patch...\nAll checks passed.\n');
    budget.recordUsage('Codex CLI', '');
    budget.recordUsage('Codex CLI', undefined);

    const tally = budget.tally();
    assert.deepEqual(tally.usage, []);
    const report = formatAiLoopBudgetTally(tally);
    assert.match(report, /1 dispatch;/);
    assert.match(report, /Codex CLI on gpt-5 1/);
    assert.doesNotMatch(report, /\$/);
    assert.doesNotMatch(report, /reported/);
  });

  test('ignores prose that mentions cost or tokens without reporting a number', () => {
    assert.deepEqual(parseCliUsageLines('This change may increase token cost for future runs.'), []);
    assert.deepEqual(parseCliUsageLines('Estimating the usage of this helper across the repo.'), []);
  });

  test('never logs credentials found next to a usage line', () => {
    const budget = createAiLoopBudget();
    budget.recordUsage(
      'Codex CLI',
      'tokens used: 900 (api_key=sk-live-ABCDEFGH12345678 Bearer abcdefgh12345678)',
    );

    const [line] = budget.tally().usage;
    assert.ok(line);
    assert.doesNotMatch(line.text, /sk-live-ABCDEFGH12345678/);
    assert.doesNotMatch(line.text, /abcdefgh12345678/);
    assert.match(line.text, /redacted/);
    assert.match(line.text, /tokens used: 900/);
  });

  test('malformed, binary, and hostile output cannot crash the run or corrupt the tally', () => {
    const budget = createAiLoopBudget();
    dispatch(budget, 'implementation', 'claude-code', 'claude-opus-5');

    for (const output of [undefined, null, 42, {}, [], Number.NaN, '\u0000\u0001\u0002']) {
      assert.doesNotThrow(() => budget.recordUsage('Claude Code', output));
    }
    // An escape-sequence-wrapped line is still readable, and only once.
    budget.recordUsage('Claude Code', '\u001b[1m\u001b[32mTotal tokens: 55\u001b[0m');
    budget.recordUsage('Claude Code', 'Total tokens: 55');
    // A flood of usage-shaped lines cannot grow the report without bound.
    budget.recordUsage(
      'Claude Code',
      Array.from({ length: 500 }, (_unused, index) => `tokens: ${index}`).join('\n'),
    );
    // A single absurdly long line is truncated rather than stored whole.
    budget.recordUsage('Codex CLI', `tokens: 1 ${'x'.repeat(50_000)}`);

    const tally = budget.tally();
    assert.equal(tally.total, 1, 'usage parsing must never change the dispatch count');
    assert.ok(tally.usage.length <= 12, `expected a bounded usage list, got ${tally.usage.length}`);
    assert.ok(tally.usage.some((line) => line.text === 'Total tokens: 55'));
    assert.equal(
      tally.usage.filter((line) => line.text === 'Total tokens: 55').length,
      1,
      'the same reported line must not be counted twice',
    );
    for (const line of tally.usage) {
      assert.ok(line.text.length <= 200, 'each reported line must be length-bounded');
    }
  });

  test('scans a very large output without throwing', () => {
    const budget = createAiLoopBudget();
    const noise = 'building...\n'.repeat(40_000);
    assert.doesNotThrow(() => budget.recordUsage('Claude Code', `${noise}Total cost: $1.10`));
    assert.deepEqual(
      budget.tally().usage.map((line) => line.text),
      ['Total cost: $1.10'],
    );
  });
});

/* -------------------------------------------------------------------------
 * Integration: the budget as the fallback runner's pre-dispatch gate.
 * ---------------------------------------------------------------------- */

function boardWithCard(): { readonly state: BoardState; readonly cardId: string } {
  let state = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Verify', 'Done']);
  state = addCard(state, state.columns[2]!.id, 'Exercise the dispatch budget');
  const cardId = state.columns[2]!.cards[0]!.id;
  state = setAssignee(state, cardId, { kind: 'ai' });
  state = setDescription(state, cardId, 'Run under a per-run dispatch cap.');
  state = setAcceptanceCriteria(state, cardId, '- [ ] The stage finishes');
  return { state, cardId };
}

function fakeStore(initial: BoardState): {
  readonly store: AgentCliFallbackDeps['store'];
  activity(cardId: string): string;
} {
  let state = cloneBoard(initial);
  const card = (cardId: string): Card | undefined => {
    for (const column of state.columns) {
      const found = column.cards.find((candidate) => candidate.id === cardId);
      if (found) {
        return found;
      }
    }
    return undefined;
  };
  return {
    store: {
      reload: async () => cloneBoard(state),
      appendActivity: async (cardId, entry) => {
        state = appendActivity(state, cardId, entry);
      },
    },
    activity: (cardId) => card(cardId)?.activity ?? '',
  };
}

function target(provider: AgentCliProviderId): AgentCliTarget {
  return {
    provider,
    label: AGENT_CLI_LABELS[provider],
    executable: `${provider}-executable`,
    launcher: 'standalone',
  };
}

/** An inconclusive result, which is what the escalation ladder retries on. */
function inconclusive(model?: string): AgentCliCardHandoffResult {
  return {
    completed: false,
    cancelled: false,
    activityBaseline: 0,
    failure: 'missing-evidence',
    reason: 'The stage produced no completion evidence.',
    ...(model !== undefined
      ? {
          modelSelection: {
            requested: model,
            source: 'workspace-default' as const,
            applied: true,
            args: ['--model', model],
          },
        }
      : {}),
  };
}

suite('dispatch budget inside the AI loop CLI runner', () => {
  test('counts every launched process, including escalation retries', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeStore(state);
    const budget = createAiLoopBudget();
    const models = ['cheap-model', 'strong-model'];
    let attempt = 0;

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('claude-code'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      escalation: {
        enabled: true,
        ladders: { 'claude-code': models },
        overrideCardModel: false,
      },
      cwd: '/workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      beforeDispatch: ({ kind, target: cli, card }) => {
        const reservation = budget.reserve({
          stage: kind,
          provider: cli.provider,
          providerLabel: cli.label,
          cardId: card.id,
          cardTitle: card.title,
        });
        return reservation.allowed
          ? { allowed: true }
          : { allowed: false, reason: formatAiLoopBudgetStopMessage(reservation.stop) };
      },
      afterDispatch: (settlement) => budget.settle(settlement.model),
      runHandoff: async () => {
        const model = models[attempt] ?? 'cheap-model';
        attempt += 1;
        return inconclusive(model);
      },
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: (await board.store.reload()).columns[2]!.cards[0]!,
      buildPrompt: () => 'prompt',
    });

    assert.equal(outcome.kind, 'ran');
    // One stage, two processes: the tally follows the processes.
    assert.equal(budget.tally().total, 2);
    assert.deepEqual(
      budget.tally().byModel.map((entry) => [entry.model, entry.count]),
      [['cheap-model', 1], ['strong-model', 1]],
    );
    assert.deepEqual(budget.tally().byStage, [{ stage: 'implementation', count: 2 }]);
    assert.equal(board.activity(cardId).includes('STATUS'), false);
  });

  test('stops before launching the process that would exceed the cap', async () => {
    const { state } = boardWithCard();
    const board = fakeStore(state);
    const budget = createAiLoopBudget({ maxDispatches: 1 });
    const launched: string[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('claude-code'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      escalation: {
        enabled: true,
        ladders: { 'claude-code': ['cheap-model', 'strong-model'] },
        overrideCardModel: false,
      },
      cwd: '/workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      beforeDispatch: ({ kind, target: cli, card }) => {
        const reservation = budget.reserve({
          stage: kind,
          provider: cli.provider,
          providerLabel: cli.label,
          cardId: card.id,
          cardTitle: card.title,
        });
        return reservation.allowed
          ? { allowed: true }
          : { allowed: false, reason: formatAiLoopBudgetStopMessage(reservation.stop) };
      },
      afterDispatch: (settlement) => budget.settle(settlement.model),
      runHandoff: async () => {
        launched.push('process');
        return inconclusive('cheap-model');
      },
    });

    const card = (await board.store.reload()).columns[2]!.cards[0]!;
    const outcome = await runner.run({
      kind: 'implementation',
      card,
      buildPrompt: () => 'prompt',
    });

    assert.equal(outcome.kind, 'stopped');
    if (outcome.kind === 'stopped') {
      assert.match(outcome.reason, /dispatch cap of 1/);
    }
    // The escalation retry was refused before it spawned anything.
    assert.equal(launched.length, 1);
    assert.equal(budget.tally().total, 1);
    assert.ok(budget.stop());

    // And nothing launched afterwards, even for another card or stage.
    const second = await runner.run({
      kind: 'verification',
      card,
      buildPrompt: () => 'prompt',
    });
    assert.equal(second.kind, 'stopped');
    assert.equal(launched.length, 1);
  });

  test('an uncapped runner behaves exactly as it did without a budget hook', async () => {
    const { state } = boardWithCard();
    const board = fakeStore(state);
    const launched: string[] = [];

    const deps = (
      extra: Partial<AgentCliFallbackDeps>,
    ): AgentCliFallbackDeps => ({
      initialTarget: target('claude-code'),
      settings: { enabled: false, providers: [] },
      configuredPaths: {},
      escalation: {
        enabled: true,
        ladders: { 'claude-code': ['cheap-model', 'strong-model'] },
        overrideCardModel: false,
      },
      cwd: '/workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      runHandoff: async () => {
        launched.push('process');
        return inconclusive('cheap-model');
      },
      ...extra,
    });

    const card = (await board.store.reload()).columns[2]!.cards[0]!;
    const withoutBudget = await createAgentCliFallbackRunner(deps({})).run({
      kind: 'implementation',
      card,
      buildPrompt: () => 'prompt',
    });
    const baseline = launched.length;
    launched.length = 0;

    const budget = createAiLoopBudget();
    const withDisabledCap = await createAgentCliFallbackRunner(
      deps({
        beforeDispatch: ({ kind, target: cli, card: current }) => {
          const reservation = budget.reserve({
            stage: kind,
            provider: cli.provider,
            providerLabel: cli.label,
            cardId: current.id,
            cardTitle: current.title,
          });
          return reservation.allowed ? { allowed: true } : { allowed: false, reason: 'capped' };
        },
        afterDispatch: (settlement) => budget.settle(settlement.model),
      }),
    ).run({ kind: 'implementation', card, buildPrompt: () => 'prompt' });

    assert.equal(withDisabledCap.kind, withoutBudget.kind);
    assert.equal(launched.length, baseline);
    assert.equal(budget.stop(), undefined);
  });
});
