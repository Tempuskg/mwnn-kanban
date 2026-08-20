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
  prepareAgentCliInvocation,
  resolveAllAgentCliTargets,
  resolveAgentCliTarget,
  resolveCursorWindowsLaunch,
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

function target(
  provider: AgentCliProviderId,
  executable = `${provider}-executable`,
  launcher: AgentCliTarget['launcher'] = 'standalone',
): AgentCliTarget {
  return {
    provider,
    label: AGENT_CLI_LABELS[provider],
    executable,
    launcher,
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
      cursor: ['-p', '--force', '--output-format', 'text'],
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

  test('builds the modern gh copilot passthrough command without putting the prompt on argv', () => {
    const prompt = 'First handoff line\nSecond line with %PATH% & symbols\nThird line';
    const invocation = buildAgentCliInvocation(
      target('copilot', 'C:\\Program Files\\GitHub CLI\\gh.exe', 'gh-copilot'),
      prompt,
      'E:\\workspaces\\project with spaces',
    );

    assert.equal(invocation.command, 'C:\\Program Files\\GitHub CLI\\gh.exe');
    assert.deepEqual(invocation.args, [
      'copilot',
      '--',
      '--allow-all-tools',
      '--no-ask-user',
      '--silent',
    ]);
    assert.equal(invocation.stdin, prompt);
    assert.equal(invocation.cwd, 'E:\\workspaces\\project with spaces');
    assert.ok(invocation.args.every((arg) => !/[\r\n]/.test(arg)));
  });

  test('prefers standalone copilot over gh copilot and returns one Copilot provider target', async () => {
    let probeCalls = 0;
    const options = {
      cwd: 'E:\\workspace',
      platform: 'win32' as const,
      env: { PATH: 'C:\\Tools', PATHEXT: '.EXE' },
      canExecute: async (candidate: string) =>
        /\\(?:copilot|gh)\.exe$/i.test(candidate),
      probeGhCopilot: async () => {
        probeCalls += 1;
        return { supported: true };
      },
    };

    const resolution = await resolveAgentCliTarget('copilot', {}, options);
    assert.equal(resolution.available, true);
    if (resolution.available) {
      assert.equal(resolution.target.executable.toLowerCase(), 'c:\\tools\\copilot.exe');
      assert.equal(resolution.target.launcher, 'standalone');
    }
    assert.equal(probeCalls, 0, 'gh must not be probed while standalone copilot is available');

    const all = await resolveAllAgentCliTargets({}, options);
    assert.equal(
      all.filter((candidate) =>
        candidate.available ? candidate.target.provider === 'copilot' : candidate.provider === 'copilot').length,
      1,
    );
  });

  test('falls back to a supported gh copilot command when standalone copilot is unavailable', async () => {
    const probes: { executable: string; cwd: string }[] = [];
    const resolution = await resolveAgentCliTarget(
      'copilot',
      {},
      {
        cwd: 'E:\\workspace with spaces',
        platform: 'win32',
        env: { PATH: 'C:\\Program Files\\GitHub CLI', PATHEXT: '.EXE' },
        canExecute: async (candidate) => /\\gh\.exe$/i.test(candidate),
        probeGhCopilot: async (executable, cwd) => {
          probes.push({ executable, cwd });
          return { supported: true };
        },
      },
    );

    assert.equal(resolution.available, true);
    if (resolution.available) {
      assert.equal(resolution.target.executable, 'C:\\Program Files\\GitHub CLI\\gh.EXE');
      assert.equal(resolution.target.launcher, 'gh-copilot');
    }
    assert.deepEqual(probes, [{
      executable: 'C:\\Program Files\\GitHub CLI\\gh.EXE',
      cwd: 'E:\\workspace with spaces',
    }]);
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
    assert.equal(resolution.available ? resolution.target.launcher : undefined, 'standalone');
    assert.deepEqual(candidates, [configuredPath]);
  });

  test('a configured GitHub CLI path with spaces has highest priority and is recognized as gh copilot', async () => {
    const configuredPath = 'C:\\Program Files\\GitHub CLI\\gh.exe';
    const candidates: string[] = [];
    const resolution = await resolveAgentCliTarget(
      'copilot',
      { copilot: `"${configuredPath}"` },
      {
        cwd: 'E:\\workspace',
        platform: 'win32',
        env: { PATH: 'C:\\Tools', PATHEXT: '.EXE' },
        canExecute: async (candidate) => {
          candidates.push(candidate);
          return candidate === configuredPath || /\\copilot\.exe$/i.test(candidate);
        },
        probeGhCopilot: async (executable) => {
          assert.equal(executable, configuredPath);
          return { supported: true };
        },
      },
    );

    assert.equal(resolution.available, true);
    if (resolution.available) {
      assert.equal(resolution.target.executable, configuredPath);
      assert.equal(resolution.target.launcher, 'gh-copilot');
    }
    assert.deepEqual(candidates, [configuredPath], 'the override must prevent PATH fallback');
  });

  test('does not fall back to PATH when the configured Copilot executable is missing', async () => {
    const configuredPath = 'C:\\Missing Tools\\copilot.exe';
    const candidates: string[] = [];
    const resolution = await resolveAgentCliTarget(
      'copilot',
      { copilot: configuredPath },
      {
        platform: 'win32',
        env: { PATH: 'C:\\Tools', PATHEXT: '.EXE' },
        canExecute: async (candidate) => {
          candidates.push(candidate);
          return /\\Tools\\copilot\.exe$/i.test(candidate);
        },
      },
    );

    assert.equal(resolution.available, false);
    assert.deepEqual(candidates, [configuredPath]);
    if (!resolution.available) {
      assert.match(resolution.reason, /configured path/);
      assert.match(resolution.reason, /either executable/);
    }
  });

  test('rejects gh versions that expose no modern Copilot passthrough', async () => {
    const resolution = await resolveAgentCliTarget(
      'copilot',
      {},
      {
        platform: 'win32',
        env: { PATH: 'C:\\Tools', PATHEXT: '.EXE' },
        canExecute: async (candidate) => /\\gh\.exe$/i.test(candidate),
        probeGhCopilot: async () => ({
          supported: false,
          reason: 'Its help only exposes the retired suggest and explain commands.',
        }),
      },
    );

    assert.equal(resolution.available, false);
    if (!resolution.available) {
      assert.match(resolution.reason, /modern built-in `gh copilot` passthrough/);
      assert.match(resolution.reason, /retired suggest and explain/);
      assert.match(resolution.reason, /github\/gh-copilot/);
      assert.match(resolution.reason, /update GitHub CLI/);
    }
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
        assert.match(resolution.reason, provider === 'copilot' ? /standalone Copilot CLI/ : /Install the CLI/);
        assert.ok(resolution.reason.includes(`agentCliPaths["${provider}"]`));
        assert.match(resolution.reason, /paths containing spaces are supported/);
      }
    });
  }
});

function pathHasExtension(candidate: string): boolean {
  return /\.[^\\/]+$/.test(candidate);
}

async function fakeCursorWindowsInstall(versionNames: readonly string[]): Promise<{
  readonly root: string;
  readonly cmd: string;
  readonly launches: ReadonlyArray<{ readonly name: string; readonly node: string; readonly script: string }>;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-cursor-shim-'));
  await fs.writeFile(path.join(root, 'cursor-agent.cmd'), '@echo off\r\n');
  await fs.writeFile(path.join(root, 'cursor-agent.ps1'), '');
  const launches: Array<{ name: string; node: string; script: string }> = [];
  for (const name of versionNames) {
    const versionDir = path.join(root, 'versions', name);
    await fs.mkdir(versionDir, { recursive: true });
    const node = path.join(versionDir, 'node.exe');
    const script = path.join(versionDir, 'index.js');
    await fs.writeFile(node, '');
    await fs.writeFile(script, '');
    launches.push({ name, node, script });
  }
  return { root, cmd: path.join(root, 'cursor-agent.cmd'), launches };
}

suite('Cursor Agent CLI prompt delivery', () => {
  test('unwraps the Windows cmd shim to node.exe so the full prompt reaches stdin', async () => {
    const install = await fakeCursorWindowsInstall(['2026.08.01-aaaaaaa', '2026.08.11-e8db854']);
    const prompt = 'Existing MWNN implementation handoff\nwith multiple lines & symbols';
    try {
      const latest = install.launches.find((launch) => launch.name === '2026.08.11-e8db854');
      assert.ok(latest);
      const unwrapped = await resolveCursorWindowsLaunch(install.cmd, 'win32');
      assert.deepEqual(unwrapped, { command: latest.node, script: latest.script });

      const prepared = await prepareAgentCliInvocation(
        target('cursor', install.cmd),
        prompt,
        'E:\\workspaces\\project with spaces',
        { platform: 'win32' },
      );
      assert.equal(prepared.invocation.command, latest.node);
      assert.deepEqual(prepared.invocation.args, [latest.script, '-p', '--force', '--output-format', 'text']);
      assert.equal(prepared.invocation.stdin, prompt);
      assert.equal(prepared.cleanup, undefined);
      assert.ok(prepared.invocation.args.every((arg) => !/[\r\n]/.test(arg)));
    } finally {
      await fs.rm(install.root, { recursive: true, force: true });
    }
  });

  test('writes a cmd.exe-safe prompt-file pointer when the Windows shim cannot be unwrapped', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-cursor-cmd-'));
    const cmd = path.join(root, 'cursor-agent.cmd');
    const prompt = 'First handoff line\nSecond line with %PATH% & symbols';
    await fs.writeFile(cmd, '@echo off\r\n');
    try {
      const prepared = await prepareAgentCliInvocation(
        target('cursor', cmd),
        prompt,
        'E:\\workspace',
        { platform: 'win32' },
      );
      const pointer = prepared.invocation.args.at(-1) ?? '';
      const file = /Read the UTF-8 file at (.+) first and carry out/.exec(pointer)?.[1];
      assert.ok(file, `pointer argument was ${pointer}`);
      assert.equal(await fs.readFile(file, 'utf8'), prompt);
      assert.deepEqual(prepared.invocation.args.slice(0, 4), ['-p', '--force', '--output-format', 'text']);
      assert.equal(prepared.invocation.stdin, prompt);
      assert.ok(prepared.invocation.args.every((arg) => !/[\r\n]/.test(arg)));
      await prepared.cleanup?.();
      await assert.rejects(() => fs.access(file));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('a Cursor cmd shim handoff launches the unwrapped node entrypoint', async () => {
    const install = await fakeCursorWindowsInstall(['2026.08.11-e8db854']);
    const { state, cardId } = boardWithCard();
    const board = fakeStore(state);
    const prompt = 'Do the work\nand append STATUS: DONE';
    try {
      const latest = install.launches[0];
      assert.ok(latest);
      const result = await runAgentCliCardHandoff(
        {
          kind: 'implementation',
          target: target('cursor', install.cmd),
          cardId,
          prompt,
          cwd: 'E:\\workspace',
          store: board.store,
          signal: new AbortController().signal,
        },
        {
          ...handoffOptions(async (invocation) => {
            assert.equal(invocation.command, latest.node);
            assert.deepEqual(invocation.args, [latest.script, '-p', '--force', '--output-format', 'text']);
            assert.equal(invocation.stdin, prompt);
            board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
            return successfulProcess();
          }),
          platform: 'win32',
        },
      );
      assert.equal(result.completed, true);
    } finally {
      await fs.rm(install.root, { recursive: true, force: true });
    }
  });
});

suite('agent CLI card handoff evidence', () => {
  test('gh copilot uses the shared evidence contract for every AI-loop handoff kind', async (context) => {
    for (const kind of ['definition', 'triage', 'implementation', 'verification'] as const) {
      await context.test(kind, async () => {
        const initial = boardWithCard(kind !== 'definition');
        const state = kind === 'triage'
          ? setAssignee(initial.state, initial.cardId, undefined)
          : initial.state;
        const board = fakeStore(state);
        const prompt = `${kind} handoff\nwith complete MWNN instructions`;
        const result = await runAgentCliCardHandoff(
          {
            kind,
            target: target('copilot', 'C:\\Program Files\\GitHub CLI\\gh.exe', 'gh-copilot'),
            cardId: initial.cardId,
            prompt,
            cwd: 'E:\\workspace root',
            store: board.store,
            signal: new AbortController().signal,
          },
          handoffOptions(async (invocation) => {
            assert.equal(invocation.command, 'C:\\Program Files\\GitHub CLI\\gh.exe');
            assert.deepEqual(invocation.args, [
              'copilot',
              '--',
              '--allow-all-tools',
              '--no-ask-user',
              '--silent',
            ]);
            assert.equal(invocation.stdin, prompt);
            assert.equal(invocation.cwd, 'E:\\workspace root');
            if (kind === 'definition') {
              board.mutate((current) =>
                setAcceptanceCriteria(
                  setDescription(current, initial.cardId, 'Defined through gh copilot.'),
                  initial.cardId,
                  '- [ ] The definition is verifiable',
                ));
            } else if (kind === 'triage') {
              board.mutate((current) => setAssignee(current, initial.cardId, { kind: 'ai' }));
            } else if (kind === 'implementation') {
              board.mutate((current) => appendActivity(current, initial.cardId, 'STATUS: DONE'));
            } else {
              board.mutate((current) => appendActivity(current, initial.cardId, 'VERIFY: PASS'));
            }
            return successfulProcess();
          }),
        );

        assert.equal(result.completed, true);
        assert.equal(result.cancelled, false);
      });
    }
  });

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

  test('gh copilot installation or authentication failures never accept card completion evidence', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeStore(state);
    const result = await runAgentCliCardHandoff(
      {
        kind: 'implementation',
        target: target('copilot', 'C:\\Tools\\gh.exe', 'gh-copilot'),
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
          exitCode: 1,
          stderr: 'failed to install Copilot CLI: authentication required',
        };
      }),
    );

    assert.equal(result.completed, false);
    assert.match(result.reason ?? '', /exit code 1/);
    assert.match(result.reason ?? '', /failed to install Copilot CLI/);
    assert.match(result.reason ?? '', /authentication required/);
    assert.match(result.reason ?? '', /card was not advanced/i);
    assert.match(board.card(cardId).activity ?? '', /handoff failed/);
  });

  test('cancelling a gh copilot handoff leaves the card assigned for a recoverable retry', async () => {
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
        target: target('copilot', 'C:\\Tools\\gh.exe', 'gh-copilot'),
        cardId,
        prompt: 'long-running work',
        cwd: 'E:\\workspace',
        store: board.store,
        signal: controller.signal,
      },
      handoffOptions(async (invocation, signal) => {
        assert.deepEqual(invocation.args.slice(0, 2), ['copilot', '--']);
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
    assert.deepEqual(board.card(cardId).assignee, { kind: 'ai' });
    const activity = board.card(cardId).activity ?? '';
    assert.match(activity, /handoff cancelled/);
    assert.match(activity, /recoverable retry/);
    assert.doesNotMatch(activity, /handoff failed/);
  });

  test('accepts verification only when a parsed verdict was appended by the run', async (context) => {
    for (const verdict of [
      'VERIFY: PASS',
      '`VERIFY: PASS`',
      'VERIFY: PASS — every acceptance criterion is objectively verified.',
      'VERIFY: FAIL: a required behavior is broken',
      'VERIFY: HUMAN: visual sign-off is required',
    ]) {
      await context.test(verdict, async () => {
        const { state, cardId } = boardWithCard();
        const board = fakeStore(state);
        const result = await runAgentCliCardHandoff(
          {
            kind: 'verification',
            target: target('codex'),
            cardId,
            prompt: 'verify the completed work',
            cwd: 'E:\\workspace',
            store: board.store,
            signal: new AbortController().signal,
          },
          handoffOptions(async () => {
            board.mutate((current) => appendActivity(current, cardId, verdict));
            return successfulProcess();
          }),
        );

        assert.equal(result.completed, true);
        assert.equal(result.cancelled, false);
        assert.match(board.card(cardId).activity ?? '', /verification handoff started/);
      });
    }
  });

  test('rejects absent, stale, and unparseable verification verdicts with the required format', async (context) => {
    for (const appended of [undefined, 'VERIFY: PASS: maybe', 'VERIFY: FAIL', 'VERIFY: HUMAN:'] as const) {
      await context.test(appended ?? 'no appended verdict', async () => {
        const { state, cardId } = boardWithCard();
        const board = fakeStore(appendActivity(state, cardId, 'VERIFY: PASS'));
        const result = await runAgentCliCardHandoff(
          {
            kind: 'verification',
            target: target('codex'),
            cardId,
            prompt: 'verify the completed work',
            cwd: 'E:\\workspace',
            store: board.store,
            signal: new AbortController().signal,
          },
          handoffOptions(async () => {
            if (appended !== undefined) {
              board.mutate((current) => appendActivity(current, cardId, appended));
            }
            return successfulProcess();
          }),
        );

        assert.equal(result.completed, false);
        assert.equal(result.cancelled, false);
        assert.match(result.reason ?? '', /VERIFY: PASS/);
        assert.match(result.reason ?? '', /VERIFY: FAIL: <reason>/);
        assert.match(result.reason ?? '', /VERIFY: HUMAN: <reason>/);
        assert.match(board.card(cardId).activity ?? '', /verification handoff failed/);
      });
    }
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

  test('aborting a launcher terminates its descendant process tree', async () => {
    const controller = new AbortController();
    const descendantScript = 'setInterval(() => undefined, 1000)';
    const launcherScript = [
      "const { spawn } = require('node:child_process');",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' });`,
      "process.stdout.write(`${child.pid}\\n`);",
      'setInterval(() => undefined, 1000);',
    ].join(' ');
    let output = '';
    let resolveDescendant: ((pid: number) => void) | undefined;
    let rejectDescendant: ((error: Error) => void) | undefined;
    const descendant = new Promise<number>((resolve, reject) => {
      resolveDescendant = resolve;
      rejectDescendant = reject;
    });
    const discoveryTimeout = setTimeout(() => {
      rejectDescendant?.(new Error('The test launcher did not report its descendant process id.'));
    }, 2_000);
    const running = runAgentCliProcess(
      {
        provider: 'copilot',
        label: 'gh copilot process-tree test launcher',
        command: process.execPath,
        args: ['-e', launcherScript],
        stdin: '',
        cwd: process.cwd(),
      },
      controller.signal,
      {
        onOutput: (chunk, stream) => {
          if (stream !== 'stdout') {
            return;
          }
          output += chunk;
          const match = /^(\d+)\r?\n/.exec(output);
          if (match?.[1]) {
            clearTimeout(discoveryTimeout);
            resolveDescendant?.(Number(match[1]));
          }
        },
      },
    );

    let descendantPid: number | undefined;
    try {
      descendantPid = await descendant;
      assert.equal(processExists(descendantPid), true);
      controller.abort();
      const result = await running;
      assert.equal(result.cancelled, true);
      assert.equal(await waitForProcessExit(descendantPid), true, 'the descendant process survived cancellation');
    } finally {
      clearTimeout(discoveryTimeout);
      controller.abort();
      await running;
      if (descendantPid !== undefined && processExists(descendantPid)) {
        process.kill(descendantPid, 'SIGKILL');
      }
    }
  });
});

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processExists(pid);
}
