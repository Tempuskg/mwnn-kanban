import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { detectCreditExhaustion, redactSecrets } from '../../src/agentCliCredit';
import { runAgentCliProcess } from '../../src/agentCliHandoff';
import {
  createAgentCliFallbackRunner,
  readAgentCliFallbackOrder,
  type AgentCliFallbackDeps,
  type AgentCliSwitchRecord,
} from '../../src/agentCliFallback';
import {
  AGENT_CLI_LABELS,
  runAgentCliCardHandoff,
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
} from '../../src/utils';
import type { BoardState, Card } from '../../src/types';

const NOW = new Date('2026-09-19T09:30:00.000Z');

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
  state = addCard(state, state.columns[2]!.id, 'Exercise the fallback');
  const cardId = state.columns[2]!.cards[0]!.id;
  state = setAssignee(state, cardId, { kind: 'ai' });
  state = setDescription(state, cardId, 'Continue the stage on another CLI.');
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

function creditFailure(message: string): AgentCliProcessResult {
  return { started: true, cancelled: false, exitCode: 1, signal: null, stdout: '', stderr: message };
}

function unrelatedFailure(message: string): AgentCliProcessResult {
  return { started: true, cancelled: false, exitCode: 1, signal: null, stdout: '', stderr: message };
}

function cleanExit(): AgentCliProcessResult {
  return { started: true, cancelled: false, exitCode: 0, signal: null, stdout: 'done', stderr: '' };
}

interface SimulatedCli {
  /** Simulated process outcome for this provider, by attempt order. */
  readonly result: (invocation: AgentCliInvocation) => AgentCliProcessResult;
}

interface SimulationLog {
  readonly provider: AgentCliProviderId;
  readonly prompt: string;
  readonly cwd: string;
}

/**
 * Drive the real handoff (and therefore the real completion-evidence rules)
 * with simulated CLI processes, so no test ever spends real CLI credits.
 */
function simulatedHandoff(
  providers: Partial<Record<AgentCliProviderId, SimulatedCli>>,
  log: SimulationLog[],
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
        log.push({ provider: invocation.provider, prompt: invocation.stdin, cwd: invocation.cwd });
        const simulated = providers[invocation.provider];
        if (!simulated) {
          throw new Error(`No simulated CLI for ${invocation.provider}`);
        }
        const result = simulated.result(invocation);
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

suite('agent CLI credit exhaustion detection', () => {
  test('recognizes exhausted credits and spent usage or session allowances', () => {
    const messages = [
      'Error: Your credit balance is too low to access the Anthropic API.',
      'Claude usage limit reached. Your limit will reset at 9pm.',
      "You've hit your weekly usage limit for this plan.",
      'Error code: 429 - insufficient_quota: You exceeded your current quota.',
      'Premium request limit reached for this billing period.',
      'This account is out of credits.',
      'Session limit exceeded for the current plan.',
    ];
    for (const message of messages) {
      assert.ok(
        detectCreditExhaustion(creditFailure(message)),
        `expected an exhaustion signal for: ${message}`,
      );
    }
  });

  test('does not treat authentication, network, rate-limit, or generic failures as exhausted credits', () => {
    const messages = [
      'Error: not logged in. Run `codex login` first.',
      'HTTP 401 Unauthorized: invalid API key supplied.',
      'request failed: getaddrinfo ENOTFOUND api.example.com',
      'fetch failed: socket hang up',
      '429 Too Many Requests: rate limit exceeded, retrying in 20s',
      'Rate limited; please wait before trying again.',
      'Error: command failed with exit code 1',
      'TypeError: Cannot read properties of undefined',
    ];
    for (const message of messages) {
      assert.equal(
        detectCreditExhaustion(unrelatedFailure(message)),
        undefined,
        `expected no exhaustion signal for: ${message}`,
      );
    }
  });

  test('ignores cancelled runs, unstarted processes, and clean exits with missing evidence', () => {
    assert.equal(
      detectCreditExhaustion({ ...creditFailure('out of credits'), cancelled: true }),
      undefined,
    );
    assert.equal(
      detectCreditExhaustion({ ...creditFailure('out of credits'), started: false }),
      undefined,
    );
    assert.equal(
      detectCreditExhaustion({
        started: true,
        cancelled: false,
        exitCode: 0,
        signal: null,
        stdout: 'usage limit reached (in a summary of an earlier run)',
        stderr: '',
      }),
      undefined,
    );
  });

  test('strips credentials from the recorded exhaustion detail', () => {
    const signal = detectCreditExhaustion(
      creditFailure('out of credits for api_key=sk-live-ABCDEF1234567890 (token ghp_ABCDEF1234567890)'),
    );
    assert.ok(signal);
    assert.ok(!signal.detail.includes('sk-live-ABCDEF1234567890'));
    assert.ok(!signal.detail.includes('ghp_ABCDEF1234567890'));
    assert.ok(signal.detail.includes('[redacted]'));
    assert.equal(
      redactSecrets('Authorization: Bearer abcdef1234567890').includes('abcdef1234567890'),
      false,
    );
  });
});

suite('AI loop CLI fallback configuration', () => {
  test('keeps the configured order while dropping duplicates and unknown providers', () => {
    assert.deepEqual(
      readAgentCliFallbackOrder(['cursor', 'codex', 'cursor', 'nope', 7, ' claude-code ']),
      ['cursor', 'codex', 'claude-code'],
    );
    assert.deepEqual(readAgentCliFallbackOrder(undefined), []);
    assert.deepEqual(readAgentCliFallbackOrder('codex'), []);
  });
});

suite('AI loop CLI fallback behaviour', () => {
  test('continues the interrupted stage on the next configured CLI and records the switch', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: SimulationLog[] = [];
    const concurrent = { count: 0, max: 0 };
    const progress: string[] = [];
    const switches: AgentCliSwitchRecord[] = [];
    board.mutate((current) =>
      appendActivity(current, cardId, 'Partial work by the first CLI is preserved.'));

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['claude-code', 'cursor'] },
      configuredPaths: {},
      cwd: 'E:\\workspace root',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      onProgress: (message) => progress.push(message),
      onSwitch: (record) => switches.push(record),
      resolveTarget: resolverFor(['claude-code', 'cursor']),
      runHandoff: simulatedHandoff(
        {
          codex: { result: () => creditFailure('You have run out of credits for this session.') },
          'claude-code': {
            result: () => {
              board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
              return cleanExit();
            },
          },
        },
        log,
        concurrent,
      ),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: (card) => `Implement "${card.title}"\nAppend STATUS: DONE.\nActivity so far: ${card.activity ?? ''}`,
    });

    assert.equal(outcome.kind, 'ran');
    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, true);
    assert.equal(outcome.target.provider, 'claude-code');
    assert.equal(runner.activeTarget().provider, 'claude-code');
    assert.deepEqual(log.map((entry) => entry.provider), ['codex', 'claude-code']);
    assert.equal(concurrent.max, 1, 'the failed CLI must end before its replacement starts');

    // Same workspace, same stage instructions and markers, latest card contents.
    const replacementPrompt = log[1]!.prompt;
    assert.equal(log[1]!.cwd, 'E:\\workspace root');
    assert.ok(replacementPrompt.startsWith('Implement "Exercise the fallback"'));
    assert.ok(replacementPrompt.includes('Append STATUS: DONE.'));
    assert.ok(replacementPrompt.includes('Partial work by the first CLI is preserved.'));
    assert.ok(replacementPrompt.includes('## Handoff note'));
    assert.ok(replacementPrompt.includes('credits or usage allowance ran out'));
    assert.ok(replacementPrompt.includes('do not restart completed work'));

    const activity = board.activity(cardId);
    assert.ok(activity.includes('Partial work by the first CLI is preserved.'), 'history is preserved');
    assert.ok(activity.includes(`### ${NOW.toISOString()} - Switched from ${AGENT_CLI_LABELS.codex} to ${AGENT_CLI_LABELS['claude-code']}`));
    assert.ok(activity.includes('Interrupted stage: implementation.'));
    assert.ok(activity.includes(`Previous CLI: ${AGENT_CLI_LABELS.codex}`));
    assert.ok(activity.includes(`Replacement CLI: ${AGENT_CLI_LABELS['claude-code']}`));
    assert.ok(activity.includes('Exhaustion reason: You have run out of credits for this session.'));
    assert.ok(activity.includes('The switch did not advance the card'));

    assert.equal(switches.length, 1);
    assert.ok(progress.some((message) => message.startsWith(`${AGENT_CLI_LABELS.codex}: implementation handoff`)));
    assert.ok(progress.some((message) => message.includes(`continuing the implementation stage with ${AGENT_CLI_LABELS['claude-code']}`)));
    assert.ok(progress.some((message) => message.startsWith(`${AGENT_CLI_LABELS['claude-code']}: implementation handoff`)));
  });

  test('falls back for every CLI-backed stage', async (context) => {
    for (const kind of ['definition', 'triage', 'implementation', 'verification'] as const) {
      await context.test(kind, async () => {
        const initial = boardWithCard();
        const state = kind === 'triage'
          ? setAssignee(initial.state, initial.cardId, undefined)
          : initial.state;
        const board = fakeBoard(state);
        const log: SimulationLog[] = [];
        const runner = createAgentCliFallbackRunner({
          initialTarget: target('copilot'),
          settings: { enabled: true, providers: ['codex'] },
          configuredPaths: {},
          cwd: 'E:\\workspace',
          store: board.store,
          signal: new AbortController().signal,
          now: () => NOW,
          resolveTarget: resolverFor(['codex']),
          runHandoff: simulatedHandoff(
            {
              copilot: { result: () => creditFailure('Monthly premium request limit reached.') },
              codex: {
                result: () => {
                  board.mutate((current) => {
                    switch (kind) {
                      case 'definition':
                        return setAcceptanceCriteria(
                          setDescription(current, initial.cardId, 'Defined by the replacement CLI.'),
                          initial.cardId,
                          '- [ ] Verified by the replacement CLI',
                        );
                      case 'triage':
                        return setAssignee(current, initial.cardId, { kind: 'ai' });
                      case 'verification':
                        return appendActivity(current, initial.cardId, 'VERIFY: PASS');
                      default:
                        return appendActivity(current, initial.cardId, 'STATUS: DONE');
                    }
                  });
                  return cleanExit();
                },
              },
            },
            log,
          ),
        });

        const outcome = await runner.run({
          kind,
          card: board.card(initial.cardId),
          buildPrompt: (card) => `${kind} stage for ${card.id}`,
        });

        assert.ok(outcome.kind === 'ran');
        assert.equal(outcome.result.completed, true);
        assert.equal(outcome.target.provider, 'codex');
        assert.deepEqual(log.map((entry) => entry.provider), ['copilot', 'codex']);
      });
    }
  });

  test('chains through the configured order, skipping duplicates, the exhausted CLI, and unavailable CLIs', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: SimulationLog[] = [];
    const progress: string[] = [];
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: {
        enabled: true,
        // Duplicates, the active provider, and an uninstalled provider are all
        // in the configured order on purpose.
        providers: ['codex', 'copilot', 'claude-code', 'claude-code', 'cursor'],
      },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      onProgress: (message) => progress.push(message),
      resolveTarget: resolverFor(['claude-code', 'cursor']),
      runHandoff: simulatedHandoff(
        {
          codex: { result: () => creditFailure('Out of credits.') },
          'claude-code': { result: () => creditFailure('Claude usage limit reached.') },
          cursor: {
            result: () => {
              board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
              return cleanExit();
            },
          },
        },
        log,
      ),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: (card) => `Implement ${card.id}`,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, true);
    assert.deepEqual(log.map((entry) => entry.provider), ['codex', 'claude-code', 'cursor']);
    assert.deepEqual([...outcome.switches].map((record) => record.to.provider), ['claude-code', 'cursor']);
    assert.deepEqual([...runner.exhaustedProviders()], ['codex', 'claude-code']);
    assert.ok(progress.some((message) => message.includes(`Skipping ${AGENT_CLI_LABELS.copilot}`)));
  });

  test('never retries a provider whose allowance was already spent in the same run', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: SimulationLog[] = [];
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['claude-code'] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: resolverFor(['codex', 'claude-code']),
      runHandoff: simulatedHandoff(
        {
          codex: { result: () => creditFailure('Out of credits.') },
          'claude-code': {
            result: () => {
              board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
              return cleanExit();
            },
          },
        },
        log,
      ),
    });

    await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: (card) => `Implement ${card.id}`,
    });
    const second = await runner.run({
      kind: 'verification',
      card: board.card(cardId),
      buildPrompt: (card) => `Verify ${card.id}`,
    });

    assert.ok(second.kind === 'ran');
    // The second stage starts on the replacement, and the exhausted CLI is
    // never dispatched again during this run.
    assert.deepEqual(log.map((entry) => entry.provider), ['codex', 'claude-code', 'claude-code']);
    assert.equal(runner.activeTarget().provider, 'claude-code');
  });

  test('pauses without advancing the card when no eligible fallback remains', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: SimulationLog[] = [];
    const pauses: string[] = [];
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['claude-code', 'cursor'] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      onPause: (reason) => pauses.push(reason),
      resolveTarget: resolverFor(['claude-code']),
      runHandoff: simulatedHandoff(
        {
          codex: { result: () => creditFailure('Out of credits.') },
          'claude-code': { result: () => creditFailure('Claude usage limit reached.') },
        },
        log,
      ),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: (card) => `Implement ${card.id}`,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, false);
    assert.equal(outcome.exhaustedWithoutFallback, true);
    assert.deepEqual(log.map((entry) => entry.provider), ['codex', 'claude-code']);
    assert.equal(pauses.length, 1);
    assert.ok(pauses[0]?.includes('Restore credits'));
    assert.ok(pauses[0]?.includes('mwnn-kanban.aiLoopCliFallbackOrder'));

    const activity = board.activity(cardId);
    assert.ok(activity.includes('AI loop paused: no AI CLI with an available allowance'));
    assert.ok(activity.includes('The implementation stage was not completed and the card was not advanced.'));

    // The run stays paused instead of cycling through providers again.
    const second = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: (card) => `Implement ${card.id}`,
    });
    assert.equal(second.kind, 'paused');
    assert.equal(log.length, 2);
    assert.equal(runner.isPaused(), true);
  });

  test('disabled fallback keeps the existing single-CLI behaviour', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: SimulationLog[] = [];
    const switches: AgentCliSwitchRecord[] = [];
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: false, providers: ['claude-code'] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      onSwitch: (record) => switches.push(record),
      resolveTarget: resolverFor(['claude-code']),
      runHandoff: simulatedHandoff(
        { codex: { result: () => creditFailure('Out of credits.') } },
        log,
      ),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: (card) => `Implement ${card.id}`,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, false);
    assert.equal(outcome.target.provider, 'codex');
    assert.deepEqual(log.map((entry) => entry.provider), ['codex']);
    assert.equal(switches.length, 0);
    assert.equal(runner.isPaused(), false);
    assert.ok(!board.activity(cardId).includes('Switched from'));
    assert.ok(outcome.result.reason?.includes('ran out of credits'));
  });

  test('an unrelated CLI failure never switches providers', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: SimulationLog[] = [];
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['claude-code'] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: resolverFor(['claude-code']),
      runHandoff: simulatedHandoff(
        { codex: { result: () => unrelatedFailure('HTTP 401 Unauthorized: invalid API key supplied.') } },
        log,
      ),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: (card) => `Implement ${card.id}`,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, false);
    assert.equal(outcome.result.creditExhaustion, undefined);
    assert.deepEqual(log.map((entry) => entry.provider), ['codex']);
    assert.equal(runner.activeTarget().provider, 'codex');
  });

  test('a clean exit without completion evidence fails the stage instead of switching', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: SimulationLog[] = [];
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['claude-code'] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: resolverFor(['claude-code']),
      runHandoff: simulatedHandoff({ codex: { result: () => cleanExit() } }, log),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: (card) => `Implement ${card.id}`,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.completed, false);
    assert.ok(outcome.result.reason?.includes('no terminal `STATUS: DONE`'));
    assert.deepEqual(log.map((entry) => entry.provider), ['codex']);
  });

  test('a replacement that produces no completion evidence does not advance the stage', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: SimulationLog[] = [];
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['claude-code'] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: resolverFor(['claude-code']),
      runHandoff: simulatedHandoff(
        {
          codex: { result: () => creditFailure('Out of credits.') },
          'claude-code': { result: () => cleanExit() },
        },
        log,
      ),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: (card) => `Implement ${card.id}`,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.switches.length, 1, 'the switch happened');
    assert.equal(outcome.result.completed, false, 'but the switch alone never completes the stage');
    assert.ok(outcome.result.reason?.includes('no terminal `STATUS: DONE`'));
  });

  test('repeated failure signals cannot launch a duplicate handoff for the loop', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: SimulationLog[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['claude-code'] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: resolverFor(['claude-code']),
      runHandoff: async (handoff, options) => {
        log.push({ provider: handoff.target.provider, prompt: handoff.prompt, cwd: handoff.cwd });
        await gate;
        return simulatedHandoff(
          {
            codex: { result: () => creditFailure('Out of credits.') },
            'claude-code': {
              result: () => {
                board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
                return cleanExit();
              },
            },
          },
          [],
        )(handoff, options);
      },
    });

    const request = {
      kind: 'implementation' as const,
      card: board.card(cardId),
      buildPrompt: (card: Card) => `Implement ${card.id}`,
    };
    const first = runner.run(request);
    const duplicate = await runner.run(request);
    assert.deepEqual(duplicate, { kind: 'busy' });
    release?.();
    await first;
    assert.equal(log.filter((entry) => entry.provider === 'codex').length, 1);
  });

  test('cancelling during failure handling stops further dispatches', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: SimulationLog[] = [];
    let cancelled = false;
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['claude-code'] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      isCancelled: () => cancelled,
      now: () => NOW,
      resolveTarget: resolverFor(['claude-code']),
      runHandoff: simulatedHandoff(
        {
          codex: {
            result: () => {
              // The user stops the loop while the exhaustion is handled.
              cancelled = true;
              return creditFailure('Out of credits.');
            },
          },
        },
        log,
      ),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: (card) => `Implement ${card.id}`,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.switches.length, 0);
    assert.deepEqual(log.map((entry) => entry.provider), ['codex']);
    assert.ok(!board.activity(cardId).includes('Switched from'));

    // A late event cannot restart the run either.
    const late = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: (card) => `Implement ${card.id}`,
    });
    assert.ok(late.kind === 'ran');
    assert.equal(late.result.cancelled, true);
    assert.equal(log.length, 1);
  });

  test('a real CLI that ends with a credit failure reports exactly one exhaustion signal', async () => {
    // A process can raise several failure events (error, close, exit); the
    // runner settles once, so the loop can switch at most once per handoff.
    const exits: AgentCliProcessResult[] = [];
    const result = await runAgentCliProcess(
      {
        provider: 'codex',
        label: 'simulated exhausted CLI',
        command: process.execPath,
        args: [
          '-e',
          "process.stderr.write('You have run out of credits.\n'); process.exit(1);",
        ],
        stdin: '',
        cwd: process.cwd(),
      },
      new AbortController().signal,
      { onExit: (ended) => exits.push(ended) },
    );

    assert.equal(exits.length, 1);
    assert.equal(result.exitCode, 1);
    assert.ok(detectCreditExhaustion(result));
  });

  test('an already cancelled loop dispatches nothing', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const log: SimulationLog[] = [];
    const controller = new AbortController();
    controller.abort();
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['claude-code'] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: controller.signal,
      now: () => NOW,
      resolveTarget: resolverFor(['claude-code']),
      runHandoff: simulatedHandoff({}, log),
    });

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: (card) => `Implement ${card.id}`,
    });

    assert.ok(outcome.kind === 'ran');
    assert.equal(outcome.result.cancelled, true);
    assert.equal(log.length, 0);
  });
});
