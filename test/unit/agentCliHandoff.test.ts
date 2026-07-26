import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { suite, test } from 'node:test';
import {
  AGENT_CLI_LABELS,
  AGENT_CLI_PROVIDER_IDS,
  buildAgentCliInvocation,
  parseTerminalCardStatus,
  resolveAgentCliTarget,
  runAgentCliCardHandoff,
  runAgentCliProcess,
  type AgentCliCardHandoffOptions,
  type AgentCliProcessResult,
  type AgentCliProviderId,
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

interface FakeHandoffStore {
  store: {
    reload(): Promise<BoardState>;
    appendActivity(cardId: string, entry: string): Promise<void>;
  };
  mutate(apply: (state: BoardState) => BoardState): void;
  card(cardId: string): Card;
}

function fakeStore(initial: BoardState): FakeHandoffStore {
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
  };
}

function boardWithCard(defined = true): { readonly state: BoardState; readonly cardId: string } {
  let state = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Verify', 'Done']);
  state = addCard(state, state.columns[2]!.id, 'Exercise the provider');
  const cardId = state.columns[2]!.cards[0]!.id;
  state = setAssignee(state, cardId, { kind: 'ai' });
  if (defined) {
    state = setDescription(state, cardId, 'Make a provider-backed change.');
    state = setAcceptanceCriteria(state, cardId, '- [ ] The provider completes the work');
  }
  return { state, cardId };
}

function target(provider: AgentCliProviderId, executable = `${provider}-executable`): AgentCliTarget {
  return {
    provider,
    label: AGENT_CLI_LABELS[provider],
    executable,
  };
}

function successfulProcess(): AgentCliProcessResult {
  return {
    started: true,
    cancelled: false,
    exitCode: 0,
    signal: null,
    stdout: 'finished',
    stderr: '',
  };
}

function handoffOptions(
  runProcess: NonNullable<AgentCliCardHandoffOptions['runProcess']>,
): AgentCliCardHandoffOptions {
  return {
    runProcess,
    now: () => new Date('2026-07-24T16:00:00.000Z'),
  };
}

suite('agent CLI provider registry and discovery', () => {
  test('builds the documented non-interactive command and pipes the exact prompt via stdin for every provider', () => {
    const prompt = 'Existing MWNN implementation handoff\nwith multiple lines & symbols';
    const expected: Record<AgentCliProviderId, readonly string[]> = {
      copilot: ['--allow-all-tools', '--no-ask-user', '--silent'],
      codex: ['exec', '--sandbox', 'workspace-write', '-'],
      'claude-code': ['-p', '--permission-mode', 'bypassPermissions', '--output-format', 'text'],
      cursor: [
        '-p',
        '--force',
        '--output-format',
        'text',
        'Carry out the complete hand-off instructions piped to you on stdin.',
      ],
    };

    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      const invocation = buildAgentCliInvocation(
        target(provider, `C:\\Program Files\\Agents\\${provider}.exe`),
        prompt,
        'E:\\workspaces\\project with spaces',
      );
      assert.equal(invocation.provider, provider);
      assert.equal(invocation.command, `C:\\Program Files\\Agents\\${provider}.exe`);
      assert.equal(invocation.cwd, 'E:\\workspaces\\project with spaces');
      assert.deepEqual(invocation.args, expected[provider]);
      assert.equal(invocation.stdin, prompt, `${provider} did not receive the exact prompt on stdin`);
      // cmd.exe truncates its command line at the first newline, so a .cmd
      // shim launch is only safe while every argument stays single-line.
      assert.ok(
        invocation.args.every((arg) => !/[\r\n]/.test(arg)),
        `${provider} argv must never contain newlines`,
      );
    }
  });

  test('keeps a quoted configured executable path containing spaces intact', async () => {
    const configuredPath = 'C:\\Program Files\\GitHub Copilot\\copilot.exe';
    const candidates: string[] = [];
    const resolution = await resolveAgentCliTarget(
      'copilot',
      { copilot: `"${configuredPath}"` },
      {
        cwd: 'E:\\workspace',
        platform: 'win32',
        canExecute: async (candidate) => {
          candidates.push(candidate);
          return candidate === configuredPath;
        },
      },
    );

    assert.equal(resolution.available, true);
    assert.equal(resolution.available ? resolution.target.executable : undefined, configuredPath);
    assert.deepEqual(candidates, [configuredPath]);
  });

  test('follows PATHEXT and ignores extensionless npm shims on Windows', async () => {
    const candidates: string[] = [];
    const resolution = await resolveAgentCliTarget(
      'codex',
      {},
      {
        platform: 'win32',
        env: {
          PATH: 'C:\\Users\\dev\\AppData\\Roaming\\npm',
          PATHEXT: '.EXE;.CMD',
        },
        canExecute: async (candidate) => {
          candidates.push(candidate);
          return candidate.toLowerCase().endsWith('\\codex.cmd');
        },
      },
    );

    assert.equal(resolution.available, true);
    assert.equal(
      resolution.available ? resolution.target.executable.toLowerCase() : undefined,
      'c:\\users\\dev\\appdata\\roaming\\npm\\codex.cmd',
    );
    assert.ok(candidates.every((candidate) => pathHasExtension(candidate)));
  });

  for (const provider of AGENT_CLI_PROVIDER_IDS) {
    test(`reports an actionable missing-executable error for ${provider}`, async () => {
      const resolution = await resolveAgentCliTarget(
        provider,
        {},
        {
          env: { PATH: '' },
          canExecute: async () => false,
        },
      );

      assert.equal(resolution.available, false);
      if (!resolution.available) {
        assert.match(resolution.reason, new RegExp(AGENT_CLI_LABELS[provider]));
        assert.match(resolution.reason, /Install the CLI/);
        assert.ok(resolution.reason.includes(`agentCliPaths["${provider}"]`));
        assert.match(resolution.reason, /paths containing spaces are supported/);
      }
    });
  }
});

function pathHasExtension(candidate: string): boolean {
  return /\.[^\\/]+$/.test(candidate);
}

suite('agent CLI card handoff evidence', () => {
  for (const provider of AGENT_CLI_PROVIDER_IDS) {
    test(`${provider} accepts a successful implementation only after STATUS: DONE is in the card`, async () => {
      const { state, cardId } = boardWithCard();
      const board = fakeStore(state);
      const prompt = `implementation prompt for ${provider}`;
      const result = await runAgentCliCardHandoff(
        {
          kind: 'implementation',
          target: target(provider),
          cardId,
          prompt,
          cwd: 'E:\\workspace',
          store: board.store,
          signal: new AbortController().signal,
        },
        handoffOptions(async (invocation) => {
          assert.equal(invocation.cwd, 'E:\\workspace');
          assert.equal(invocation.stdin, prompt);
          board.mutate((current) =>
            appendActivity(current, cardId, 'Implemented and tested.\nSTATUS: DONE'));
          return successfulProcess();
        }),
      );

      assert.equal(result.completed, true);
      assert.equal(result.cancelled, false);
      assert.deepEqual(result.terminalStatus, { kind: 'done' });
      assert.match(board.card(cardId).activity ?? '', new RegExp(`${AGENT_CLI_LABELS[provider]} implementation handoff started`));
    });

    test(`${provider} accepts a definition handoff only after the card becomes defined`, async () => {
      const { state, cardId } = boardWithCard(false);
      const board = fakeStore(state);
      const prompt = `definition prompt for ${provider}`;
      const result = await runAgentCliCardHandoff(
        {
          kind: 'definition',
          target: target(provider),
          cardId,
          prompt,
          cwd: 'E:\\workspace',
          store: board.store,
          signal: new AbortController().signal,
        },
        handoffOptions(async (invocation) => {
          assert.equal(invocation.stdin, prompt);
          board.mutate((current) =>
            setAcceptanceCriteria(
              setDescription(current, cardId, 'The agent supplied a complete definition.'),
              cardId,
              '- [ ] The new behavior is verifiable',
            ));
          return successfulProcess();
        }),
      );

      assert.equal(result.completed, true);
      assert.equal(result.cancelled, false);
      assert.match(board.card(cardId).description ?? '', /complete definition/);
    });

    test(`${provider} rejects an unsuccessful exit even if the agent wrote DONE`, async () => {
      const { state, cardId } = boardWithCard();
      const board = fakeStore(state);
      const result = await runAgentCliCardHandoff(
        {
          kind: 'implementation',
          target: target(provider),
          cardId,
          prompt: 'do the work',
          cwd: 'E:\\workspace',
          store: board.store,
          signal: new AbortController().signal,
        },
        handoffOptions(async () => {
          board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
          return {
            ...successfulProcess(),
            exitCode: 17,
            stderr: 'authentication expired',
          };
        }),
      );

      assert.equal(result.completed, false);
      assert.match(result.reason ?? '', /exit code 17/);
      assert.match(result.reason ?? '', /authentication expired/);
      assert.match(board.card(cardId).activity ?? '', /handoff failed/);
      assert.match(board.card(cardId).activity ?? '', /card was not advanced/i);
    });

    test(`${provider} rejects invalid and absent terminal card statuses`, async (context) => {
      for (const terminal of ['STATUS: MAYBE', undefined] as const) {
        await context.test(terminal ?? 'no status', async () => {
          const { state, cardId } = boardWithCard();
          const board = fakeStore(state);
          const result = await runAgentCliCardHandoff(
            {
              kind: 'implementation',
              target: target(provider),
              cardId,
              prompt: 'do the work',
              cwd: 'E:\\workspace',
              store: board.store,
              signal: new AbortController().signal,
            },
            handoffOptions(async () => {
              if (terminal) {
                board.mutate((current) => appendActivity(current, cardId, terminal));
              }
              return successfulProcess();
            }),
          );

          assert.equal(result.completed, false);
          assert.match(result.reason ?? '', terminal ? /is invalid/ : /no terminal/);
          assert.match(board.card(cardId).activity ?? '', /handoff failed/);
        });
      }
    });

    test(`${provider} records a start failure without completing the card`, async () => {
      const { state, cardId } = boardWithCard();
      const board = fakeStore(state);
      const result = await runAgentCliCardHandoff(
        {
          kind: 'implementation',
          target: target(provider, `C:\\Missing Agents\\${provider}.exe`),
          cardId,
          prompt: 'do the work',
          cwd: 'E:\\workspace',
          store: board.store,
          signal: new AbortController().signal,
        },
        handoffOptions(async () => ({
          started: false,
          cancelled: false,
          exitCode: null,
          signal: null,
          stdout: '',
          stderr: '',
          error: 'ENOENT',
        })),
      );

      assert.equal(result.completed, false);
      assert.match(result.reason ?? '', /Could not start/);
      assert.match(result.reason ?? '', /ENOENT/);
      assert.match(result.reason ?? '', /configured executable path/);
      assert.match(board.card(cardId).activity ?? '', /handoff failed/);
    });

    test(`${provider} cancellation stops the handoff without recording failure`, async () => {
      const { state, cardId } = boardWithCard();
      const board = fakeStore(state);
      const controller = new AbortController();
      let processStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        processStarted = resolve;
      });
      const run = runAgentCliCardHandoff(
        {
          kind: 'implementation',
          target: target(provider),
          cardId,
          prompt: 'long-running work',
          cwd: 'E:\\workspace',
          store: board.store,
          signal: controller.signal,
        },
        handoffOptions(async (_invocation, signal) => {
          processStarted?.();
          return new Promise((resolve) => {
            signal.addEventListener('abort', () => {
              resolve({
                started: true,
                cancelled: true,
                exitCode: null,
                signal: 'SIGTERM',
                stdout: '',
                stderr: '',
              });
            }, { once: true });
          });
        }),
      );

      await started;
      controller.abort();
      const result = await run;

      assert.equal(result.completed, false);
      assert.equal(result.cancelled, true);
      assert.equal(result.reason, undefined);
      const activity = board.card(cardId).activity ?? '';
      assert.match(activity, /handoff cancelled/);
      assert.match(activity, /remains assigned for a recoverable retry/);
      assert.doesNotMatch(activity, /handoff failed/);
      assert.deepEqual(board.card(cardId).assignee, { kind: 'ai' });
    });
  }

  test('accepts a BLOCKED terminal status only when it includes a reason', () => {
    assert.deepEqual(
      parseTerminalCardStatus('before\nSTATUS: BLOCKED: credentials are missing', 7),
      { valid: true, status: { kind: 'blocked', reason: 'credentials are missing' } },
    );
    assert.equal(parseTerminalCardStatus('before\nSTATUS: BLOCKED', 7).valid, false);
    assert.equal(parseTerminalCardStatus('before\nSTATUS: DONE', 7).valid, true);
  });
});

suite('agent CLI process observation', () => {
  test('streams live output and lifecycle events to the observer', async () => {
    const startInvocations: unknown[] = [];
    const output: { chunk: string; stream: 'stdout' | 'stderr' }[] = [];
    let exitResult: AgentCliProcessResult | undefined;
    const invocation = {
      provider: 'codex' as const,
      label: 'test child',
      command: process.execPath,
      args: ['-e', "process.stdout.write('out-line\\n'); process.stderr.write('err-line\\n');"],
      stdin: '',
      cwd: process.cwd(),
    };

    const result = await runAgentCliProcess(invocation, new AbortController().signal, {
      onStart: (started) => startInvocations.push(started),
      onOutput: (chunk, stream) => output.push({ chunk, stream }),
      onExit: (ended) => {
        exitResult = ended;
      },
    });

    assert.deepEqual(startInvocations, [invocation]);
    const stdout = output.filter((entry) => entry.stream === 'stdout').map((entry) => entry.chunk).join('');
    const stderr = output.filter((entry) => entry.stream === 'stderr').map((entry) => entry.chunk).join('');
    assert.match(stdout, /out-line/);
    assert.match(stderr, /err-line/);
    assert.deepEqual(exitResult, result);
    assert.equal(result.exitCode, 0);
  });

  test('the card handoff forwards its observer to the process runner', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeStore(state);
    const observer = { onOutput: () => undefined };
    let receivedObserver: unknown;

    const result = await runAgentCliCardHandoff(
      {
        kind: 'implementation',
        target: target('claude-code'),
        cardId,
        prompt: 'Existing MWNN card handoff prompt',
        cwd: process.cwd(),
        store: board.store,
        signal: new AbortController().signal,
      },
      {
        runProcess: async (_invocation, _signal, forwarded) => {
          receivedObserver = forwarded;
          board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
          return successfulProcess();
        },
        now: () => new Date('2026-07-26T15:00:00.000Z'),
        observer,
      },
    );

    assert.equal(result.completed, true);
    assert.equal(receivedObserver, observer);
  });
});

suite('agent CLI prompt delivery over stdin', () => {
  const echoStdinScript =
    "let data = ''; process.stdin.on('data', (chunk) => { data += chunk; }); process.stdin.on('end', () => process.stdout.write(data));";

  test('the child receives the exact multi-line prompt on stdin', async () => {
    const prompt = 'Define the card.\nSecond line with "quotes", %PATH%, & symbols.\nThird line.';
    const result = await runAgentCliProcess(
      {
        provider: 'codex',
        label: 'test child',
        command: process.execPath,
        args: ['-e', echoStdinScript],
        stdin: prompt,
        cwd: process.cwd(),
      },
      new AbortController().signal,
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, prompt);
  });

  test(
    'the multi-line prompt survives a Windows .cmd shim launch intact',
    { skip: process.platform !== 'win32' },
    async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-agent-cli-'));
      const shim = path.join(dir, 'echo-agent.cmd');
      // Mirrors an npm shim: a .cmd wrapper that forwards to node.
      await fs.writeFile(shim, `@"${process.execPath}" -e "${echoStdinScript.replace(/"/g, '""')}"\r\n`);
      try {
        const prompt = 'Define the card.\nSecond line with symbols & spaces.\nThird line.';
        const result = await runAgentCliProcess(
          {
            provider: 'codex',
            label: 'shim child',
            command: shim,
            args: [],
            stdin: prompt,
            cwd: dir,
          },
          new AbortController().signal,
        );

        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, prompt);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  );

  test('a newline smuggled into a .cmd shim argument fails instead of truncating', {
    skip: process.platform !== 'win32',
  }, async () => {
    const result = await runAgentCliProcess(
      {
        provider: 'codex',
        label: 'shim child',
        command: 'C:\\fake\\agent.cmd',
        args: ['first line\nsecond line'],
        stdin: '',
        cwd: process.cwd(),
      },
      new AbortController().signal,
    );

    assert.equal(result.started, false);
    assert.match(result.error ?? '', /newline/);
    assert.match(result.error ?? '', /stdin/);
  });
});

suite('agent CLI process cancellation', () => {
  test('aborting the signal terminates a live child process', async () => {
    const controller = new AbortController();
    const running = runAgentCliProcess(
      {
        provider: 'codex',
        label: 'test child',
        command: process.execPath,
        args: ['-e', 'setInterval(() => undefined, 1000)'],
        stdin: '',
        cwd: process.cwd(),
      },
      controller.signal,
    );
    setTimeout(() => controller.abort(), 50);

    const result = await running;
    assert.equal(result.started, true);
    assert.equal(result.cancelled, true);
    assert.notEqual(result.signal ?? result.exitCode, 0);
  });
});
