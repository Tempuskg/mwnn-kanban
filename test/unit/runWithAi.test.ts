import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  AGENT_CLI_LABELS,
  AGENT_CLI_PROVIDER_IDS,
  resolveAgentCliTarget,
  runAgentCliCardHandoff,
  type AgentCliCardHandoff,
  type AgentCliCardHandoffResult,
  type AgentCliProcessResult,
  type AgentCliProviderId,
} from '../../src/agentCliHandoff';
import {
  CHAT_PROVIDER_LABELS,
  createChatHandoffInFlight,
  type ChatHandoffTarget,
} from '../../src/chatHandoff';
import {
  describeAgentCliRunOutcome,
  listRunWithAiProviderChoices,
  runCardWithAgentCli,
  type RunCardWithAgentCliDeps,
  type RunCardWithAgentCliRequest,
} from '../../src/runWithAi';
import {
  addCard,
  appendActivity,
  cloneBoard,
  defaultBoard,
  moveCard,
  setAcceptanceCriteria,
  setAssignee,
  setColumnConfig,
  setDescription,
} from '../../src/utils';
import type { Assignee, BoardState, Card, Column } from '../../src/types';

const CHAT_TARGETS: readonly ChatHandoffTarget[] = [
  { provider: 'copilot', commandId: 'workbench.action.chat.open', promptDelivery: 'query' },
  { provider: 'claude-code', commandId: 'claude-vscode.editor.open', promptDelivery: 'positional' },
];

interface FakeHandoffStore {
  store: {
    reload(): Promise<BoardState>;
    appendActivity(cardId: string, entry: string): Promise<void>;
    moveCard(cardId: string, toColumnId: string, toIndex: number): Promise<void>;
    setAssignee(cardId: string, assignee: Assignee | undefined): Promise<void>;
    setAcceptanceCriteria(cardId: string, acceptanceCriteria: string): Promise<void>;
  };
  mutate(apply: (state: BoardState) => BoardState): void;
  card(cardId: string): Card;
  columnOf(cardId: string): Column;
  appendedEntries(): readonly string[];
}

function fakeStore(initial: BoardState): FakeHandoffStore {
  let state = cloneBoard(initial);
  const appended: string[] = [];
  const card = (cardId: string): Card => {
    for (const column of state.columns) {
      const found = column.cards.find((candidate) => candidate.id === cardId);
      if (found) {
        return found;
      }
    }
    throw new Error(`Card ${cardId} not found`);
  };
  const columnOf = (cardId: string): Column => {
    const column = state.columns.find((candidate) =>
      candidate.cards.some((candidateCard) => candidateCard.id === cardId));
    if (!column) {
      throw new Error(`Card ${cardId} not found`);
    }
    return column;
  };
  return {
    store: {
      reload: async () => cloneBoard(state),
      appendActivity: async (cardId, entry) => {
        appended.push(entry);
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
    mutate(apply) {
      state = apply(state);
    },
    card,
    columnOf,
    appendedEntries: () => appended,
  };
}

function boardWithCard(defined = true): { readonly state: BoardState; readonly cardId: string } {
  let state = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Verify', 'Done']);
  state = addCard(state, state.columns[2]!.id, 'Run the card via CLI');
  const cardId = state.columns[2]!.cards[0]!.id;
  state = setAssignee(state, cardId, { kind: 'ai' });
  if (defined) {
    state = setDescription(state, cardId, 'Make a CLI-backed change.');
    state = setAcceptanceCriteria(state, cardId, '- [ ] The CLI completes the work');
  }
  return { state, cardId };
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

interface DispatchHarness {
  readonly deps: RunCardWithAgentCliDeps;
  readonly infos: string[];
  readonly warnings: string[];
  readonly progressTitles: string[];
  readonly progressMessages: string[];
  refreshes: number;
}

function dispatchHarness(
  board: FakeHandoffStore,
  overrides: Partial<RunCardWithAgentCliDeps> = {},
): DispatchHarness {
  const infos: string[] = [];
  const warnings: string[] = [];
  const progressTitles: string[] = [];
  const progressMessages: string[] = [];
  const harness: DispatchHarness = {
    infos,
    warnings,
    progressTitles,
    progressMessages,
    refreshes: 0,
    deps: {
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      runWithProgress: (title, task) => {
        progressTitles.push(title);
        return task(new AbortController().signal, (message) => progressMessages.push(message));
      },
      showInformation: (message) => infos.push(message),
      showWarning: (message) => warnings.push(message),
      refreshBoard: () => {
        harness.refreshes += 1;
      },
      ...overrides,
    },
  };
  return harness;
}

function request(
  provider: AgentCliProviderId,
  cardId: string,
  prompt = 'Existing MWNN card handoff prompt',
  kind: RunCardWithAgentCliRequest['kind'] = 'implementation',
): RunCardWithAgentCliRequest {
  return { provider, kind, card: { id: cardId, title: 'Run the card via CLI' }, prompt };
}

/** Resolves against a fake filesystem where only `available` paths execute. */
function fakeResolver(
  available: readonly string[],
): NonNullable<RunCardWithAgentCliDeps['resolveTarget']> {
  return (provider, configuredPaths, options) =>
    resolveAgentCliTarget(provider, configuredPaths, {
      ...options,
      platform: 'win32',
      env: { PATH: 'C:\\Tools' },
      canExecute: async (candidate) =>
        available.some((path) => path.toLowerCase() === candidate.toLowerCase()),
      probeGhCopilot: async () => ({ supported: true }),
    });
}

/** Real shared handoff logic with only the process spawn stubbed out. */
function realHandoffWith(
  runProcess: (invocation: { readonly args: readonly string[]; readonly command: string; readonly stdin: string; readonly cwd: string }) => Promise<AgentCliProcessResult>,
): (handoff: AgentCliCardHandoff) => Promise<AgentCliCardHandoffResult> {
  return (handoff) =>
    runAgentCliCardHandoff(handoff, {
      runProcess: (invocation) => runProcess(invocation),
      now: () => new Date('2026-07-26T15:00:00.000Z'),
    });
}

suite('Run with AI provider selection', () => {
  test('offers installed chat extensions followed by all four agent CLI providers', () => {
    const choices = listRunWithAiProviderChoices(CHAT_TARGETS);

    assert.deepEqual(
      choices.map((choice) => choice.kind),
      ['chat', 'chat', 'cli', 'cli', 'cli', 'cli'],
    );
    assert.deepEqual(
      choices.slice(0, 2).map((choice) => choice.label),
      [CHAT_PROVIDER_LABELS.copilot, CHAT_PROVIDER_LABELS['claude-code']],
    );
    assert.deepEqual(
      choices.slice(2).map((choice) => (choice.kind === 'cli' ? choice.provider : undefined)),
      [...AGENT_CLI_PROVIDER_IDS],
    );
  });

  test('labels make clear which entries are CLIs and which are chat extensions', () => {
    for (const choice of listRunWithAiProviderChoices(CHAT_TARGETS)) {
      if (choice.kind === 'cli') {
        assert.match(choice.label, /CLI/);
        assert.equal(choice.description, 'Local agent CLI');
        assert.match(choice.detail, /headlessly in the workspace root/);
      } else {
        assert.equal(choice.description, 'VS Code chat extension');
        assert.doesNotMatch(choice.label, /CLI/);
      }
    }
  });

  test('passes chat handoff targets through unchanged', () => {
    const choices = listRunWithAiProviderChoices(CHAT_TARGETS);
    const chatChoices = choices.filter((choice) => choice.kind === 'chat');
    assert.deepEqual(chatChoices.map((choice) => choice.target), [...CHAT_TARGETS]);
  });

  test('still offers every CLI provider when no chat extension is installed', () => {
    const choices = listRunWithAiProviderChoices([]);
    assert.equal(choices.length, AGENT_CLI_PROVIDER_IDS.length);
    assert.ok(choices.every((choice) => choice.kind === 'cli'));
  });
});

suite('Run with AI agent CLI dispatch', () => {
  test('a successful run sends the card prompt, appends the handoff Activity entry, and refreshes the board', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeStore(state);
    const prompt = 'Existing MWNN card handoff prompt\nwith details';
    const harness = dispatchHarness(board, {
      resolveTarget: fakeResolver(['C:\\Tools\\claude.EXE']),
      runHandoff: realHandoffWith(async (invocation) => {
        assert.equal(invocation.cwd, 'E:\\workspace');
        assert.equal(invocation.stdin, prompt, 'the CLI did not receive the exact prompt on stdin');
        board.mutate((current) =>
          appendActivity(current, cardId, 'Implemented and tested.\nSTATUS: DONE'));
        return successfulProcess();
      }),
    });

    const completed = await runCardWithAgentCli(request('claude-code', cardId, prompt), harness.deps);

    assert.equal(completed, true);
    const activity = board.card(cardId).activity ?? '';
    assert.match(activity, /Anthropic Claude Code CLI implementation handoff started/);
    assert.equal(harness.refreshes, 1);
    assert.equal(harness.warnings.length, 0);
    assert.match(harness.infos[0] ?? '', /Anthropic Claude Code CLI finished "Run the card via CLI"/);
    assert.match(harness.progressTitles[0] ?? '', /Anthropic Claude Code CLI/);
  });

  test('honours an agentCliPaths override containing spaces', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeStore(state);
    const configuredPath = 'C:\\Program Files\\GitHub Copilot\\copilot.exe';
    let launchedExecutable: string | undefined;
    const harness = dispatchHarness(board, {
      configuredPaths: { copilot: `"${configuredPath}"` },
      resolveTarget: fakeResolver([configuredPath]),
      runHandoff: realHandoffWith(async (invocation) => {
        launchedExecutable = invocation.command;
        board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
        return successfulProcess();
      }),
    });

    const completed = await runCardWithAgentCli(request('copilot', cardId), harness.deps);

    assert.equal(completed, true);
    assert.equal(launchedExecutable, configuredPath);
  });

  test('runs a configured gh copilot launcher and parks successful work exactly like standalone Copilot', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeStore(state);
    const configuredPath = 'C:\\Program Files\\GitHub CLI\\gh.exe';
    const prompt = 'Implement the card\nthen append exact completion evidence.';
    const harness = dispatchHarness(board, {
      configuredPaths: { copilot: `"${configuredPath}"` },
      resolveTarget: fakeResolver([configuredPath]),
      runHandoff: realHandoffWith(async (invocation) => {
        assert.equal(invocation.command, configuredPath);
        assert.deepEqual(invocation.args, [
          'copilot',
          '--',
          '--allow-all-tools',
          '--no-ask-user',
          '--silent',
        ]);
        assert.equal(invocation.stdin, prompt);
        assert.equal(invocation.cwd, 'E:\\workspace');
        board.mutate((current) =>
          appendActivity(current, cardId, 'Implemented through gh.\nSTATUS: DONE'));
        return successfulProcess();
      }),
    });

    const completed = await runCardWithAgentCli(
      request('copilot', cardId, prompt),
      harness.deps,
    );

    assert.equal(completed, true);
    assert.equal(board.columnOf(cardId).title, 'Verify');
    assert.deepEqual(board.card(cardId).assignee, { kind: 'human' });
    assert.equal(board.card(cardId).acceptanceCriteria, '- [x] The CLI completes the work');
    assert.match(board.card(cardId).activity ?? '', /Run with AI parked in Verify/);
    assert.equal(harness.warnings.length, 0);
  });

  for (const provider of AGENT_CLI_PROVIDER_IDS) {
    test(`a missing ${provider} executable warns with the attempted command and records no Activity`, async () => {
      const { state, cardId } = boardWithCard();
      const board = fakeStore(state);
      const activityBefore = board.card(cardId).activity ?? '';
      const harness = dispatchHarness(board, { resolveTarget: fakeResolver([]) });

      const completed = await runCardWithAgentCli(request(provider, cardId), harness.deps);

      assert.equal(completed, false);
      assert.equal(harness.progressTitles.length, 0, 'no CLI process may be launched');
      assert.equal(board.appendedEntries().length, 0, 'no Activity entry may be recorded');
      assert.equal(board.card(cardId).activity ?? '', activityBefore);
      const warning = harness.warnings[0] ?? '';
      assert.match(warning, new RegExp(AGENT_CLI_LABELS[provider]));
      if (provider === 'copilot') {
        assert.match(warning, /neither standalone command "copilot" nor GitHub CLI command "gh"/);
        assert.match(warning, /modern `gh copilot` passthrough/);
      } else {
        assert.match(warning, /command "[^"]+" on PATH/);
        assert.match(warning, /was not found or is not executable/);
      }
      assert.ok(warning.includes(`agentCliPaths["${provider}"]`));
    });
  }

  test('an unsuccessful exit surfaces the failure and leaves the card recoverable', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeStore(state);
    const harness = dispatchHarness(board, {
      resolveTarget: fakeResolver(['C:\\Tools\\codex.EXE']),
      runHandoff: realHandoffWith(async () => ({
        ...successfulProcess(),
        exitCode: 41,
        stderr: 'authentication expired',
      })),
    });

    const completed = await runCardWithAgentCli(request('codex', cardId), harness.deps);

    assert.equal(completed, false);
    const warning = harness.warnings[0] ?? '';
    assert.match(warning, /exit code 41/);
    assert.match(warning, /authentication expired/);
    assert.equal(harness.infos.length, 0, 'a failed run must not report success');
    const activity = board.card(cardId).activity ?? '';
    assert.match(activity, /handoff failed/);
    assert.match(activity, /card was not advanced/i);
    assert.deepEqual(board.card(cardId).assignee, { kind: 'ai' });
  });

  test('an exit without terminal card evidence is reported as a failure, not success', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeStore(state);
    const harness = dispatchHarness(board, {
      resolveTarget: fakeResolver(['C:\\Tools\\cursor-agent.EXE']),
      runHandoff: realHandoffWith(async () => successfulProcess()),
    });

    const completed = await runCardWithAgentCli(request('cursor', cardId), harness.deps);

    assert.equal(completed, false);
    assert.match(harness.warnings[0] ?? '', /no terminal `STATUS: DONE`/);
    assert.equal(harness.infos.length, 0);
  });

  test('a blocked terminal status is surfaced as a warning with the agent reason', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeStore(state);
    const harness = dispatchHarness(board, {
      resolveTarget: fakeResolver(['C:\\Tools\\claude.EXE']),
      runHandoff: realHandoffWith(async () => {
        board.mutate((current) =>
          appendActivity(current, cardId, 'STATUS: BLOCKED: credentials are missing'));
        return successfulProcess();
      }),
    });

    const completed = await runCardWithAgentCli(request('claude-code', cardId), harness.deps);

    assert.equal(completed, true);
    assert.match(harness.warnings[0] ?? '', /blocked: credentials are missing/);
    assert.equal(harness.infos.length, 0);
    assert.equal(board.columnOf(cardId).title, 'In Progress', 'a blocked card must not be moved');
    assert.deepEqual(board.card(cardId).assignee, { kind: 'ai' });
  });

  test('a finished implementation is parked in Verify and reassigned to Human, like the AI loop', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeStore(state);
    const harness = dispatchHarness(board, {
      resolveTarget: fakeResolver(['C:\\Tools\\claude.EXE']),
      runHandoff: realHandoffWith(async () => {
        board.mutate((current) =>
          appendActivity(current, cardId, 'Implemented and tested.\nSTATUS: DONE'));
        return successfulProcess();
      }),
    });

    const completed = await runCardWithAgentCli(request('claude-code', cardId), harness.deps);

    assert.equal(completed, true);
    assert.equal(board.columnOf(cardId).title, 'Verify');
    assert.deepEqual(board.card(cardId).assignee, { kind: 'human' });
    assert.equal(
      board.card(cardId).acceptanceCriteria,
      '- [x] The CLI completes the work',
      'STATUS: DONE claims every criterion is met, so the checklist is completed',
    );
    const activity = board.card(cardId).activity ?? '';
    assert.match(activity, /Run with AI parked in Verify/);
    assert.match(activity, /reassigned to Human for verification and sign-off/);
    assert.match(harness.infos[0] ?? '', /now in Verify and assigned to Human/);
  });

  test('a finished card already sitting in Verify is reassigned to Human without moving', async () => {
    const { state, cardId } = boardWithCard();
    const verifyColumnId = state.columns[3]!.id;
    const board = fakeStore(moveCard(state, cardId, verifyColumnId, 0));
    const harness = dispatchHarness(board, {
      resolveTarget: fakeResolver(['C:\\Tools\\claude.EXE']),
      runHandoff: realHandoffWith(async () => {
        board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
        return successfulProcess();
      }),
    });

    const completed = await runCardWithAgentCli(request('claude-code', cardId), harness.deps);

    assert.equal(completed, true);
    assert.equal(board.columnOf(cardId).title, 'Verify');
    assert.deepEqual(board.card(cardId).assignee, { kind: 'human' });
    assert.match(board.card(cardId).activity ?? '', /Run with AI parked in Verify/);
  });

  test('a finished card stays put when the board has no Verify column', async () => {
    let state = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Done']);
    state = addCard(state, state.columns[2]!.id, 'Run the card via CLI');
    const cardId = state.columns[2]!.cards[0]!.id;
    state = setAssignee(state, cardId, { kind: 'ai' });
    state = setDescription(state, cardId, 'Make a CLI-backed change.');
    state = setAcceptanceCriteria(state, cardId, '- [ ] The CLI completes the work');
    const board = fakeStore(state);
    const harness = dispatchHarness(board, {
      resolveTarget: fakeResolver(['C:\\Tools\\claude.EXE']),
      runHandoff: realHandoffWith(async () => {
        board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
        return successfulProcess();
      }),
    });

    const completed = await runCardWithAgentCli(request('claude-code', cardId), harness.deps);

    assert.equal(completed, true);
    assert.equal(board.columnOf(cardId).title, 'In Progress');
    assert.deepEqual(board.card(cardId).assignee, { kind: 'ai' });
    assert.doesNotMatch(board.card(cardId).activity ?? '', /parked in/);
    assert.match(harness.infos[0] ?? '', /reported STATUS: DONE in the card Activity/);
  });

  test('a finished card stays put when Verify is at its WIP limit', async () => {
    let { state, cardId } = boardWithCard();
    const verifyColumnId = state.columns[3]!.id;
    state = setColumnConfig(state, verifyColumnId, { wipLimit: 1 });
    state = addCard(state, verifyColumnId, 'Occupies the only Verify slot');
    const board = fakeStore(state);
    const harness = dispatchHarness(board, {
      resolveTarget: fakeResolver(['C:\\Tools\\claude.EXE']),
      runHandoff: realHandoffWith(async () => {
        board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
        return successfulProcess();
      }),
    });

    const completed = await runCardWithAgentCli(request('claude-code', cardId), harness.deps);

    assert.equal(completed, true);
    assert.equal(board.columnOf(cardId).title, 'In Progress');
    assert.deepEqual(board.card(cardId).assignee, { kind: 'ai' });
    assert.doesNotMatch(board.card(cardId).activity ?? '', /parked in/);
  });

  test('cancellation reports an informational stop instead of a failure', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeStore(state);
    let controller: AbortController | undefined;
    const harness = dispatchHarness(board, {
      resolveTarget: fakeResolver(['C:\\Tools\\claude.EXE']),
      runWithProgress: (_title, task) => {
        controller = new AbortController();
        return task(controller.signal, () => undefined);
      },
      // Simulate the user cancelling the progress notification while the CLI
      // process is running: the abort lands mid-process, not before it starts.
      runHandoff: realHandoffWith(async () => {
        controller?.abort();
        return {
          started: true,
          cancelled: true,
          exitCode: null,
          signal: 'SIGTERM',
          stdout: '',
          stderr: '',
        };
      }),
    });

    const completed = await runCardWithAgentCli(request('claude-code', cardId), harness.deps);

    assert.equal(completed, false);
    assert.equal(harness.warnings.length, 0);
    assert.match(harness.infos[0] ?? '', /Stopped Anthropic Claude Code CLI/);
    assert.match(board.card(cardId).activity ?? '', /handoff cancelled/);
  });

  test('a definition run uses the definition handoff and reports the filled-in card', async () => {
    const { state, cardId } = boardWithCard(false);
    const board = fakeStore(state);
    const prompt = 'Existing MWNN definition prompt';
    const harness = dispatchHarness(board, {
      resolveTarget: fakeResolver(['C:\\Tools\\claude.EXE']),
      runHandoff: realHandoffWith(async (invocation) => {
        assert.equal(invocation.stdin, prompt, 'the CLI did not receive the definition prompt on stdin');
        board.mutate((current) =>
          setAcceptanceCriteria(
            setDescription(current, cardId, 'The agent supplied a complete definition.'),
            cardId,
            '- [ ] The new behavior is verifiable',
          ));
        return successfulProcess();
      }),
    });

    const completed = await runCardWithAgentCli(
      request('claude-code', cardId, prompt, 'definition'),
      harness.deps,
    );

    assert.equal(completed, true);
    const activity = board.card(cardId).activity ?? '';
    assert.match(activity, /Anthropic Claude Code CLI definition handoff started/);
    assert.match(board.card(cardId).description ?? '', /complete definition/);
    assert.equal(harness.warnings.length, 0);
    assert.match(harness.infos[0] ?? '', /filled in "Run the card via CLI"/);
    assert.match(harness.progressTitles[0] ?? '', /^Filling in "Run the card via CLI"/);
    assert.equal(board.columnOf(cardId).title, 'In Progress', 'a definition run never parks the card');
    assert.deepEqual(board.card(cardId).assignee, { kind: 'ai' });
  });

  test('a definition run that leaves the card undefined is surfaced as a failure', async () => {
    const { state, cardId } = boardWithCard(false);
    const board = fakeStore(state);
    const harness = dispatchHarness(board, {
      resolveTarget: fakeResolver(['C:\\Tools\\claude.EXE']),
      runHandoff: realHandoffWith(async () => successfulProcess()),
    });

    const completed = await runCardWithAgentCli(
      request('claude-code', cardId, 'define the card', 'definition'),
      harness.deps,
    );

    assert.equal(completed, false);
    assert.match(harness.warnings[0] ?? '', /still has no complete Description and Acceptance criteria/);
    assert.equal(harness.infos.length, 0);
    assert.match(board.card(cardId).activity ?? '', /definition handoff failed/);
  });

  test('builds a live-feedback observer for the run and forwards it to the handoff', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeStore(state);
    const observer = { onOutput: () => undefined };
    let observedContext: unknown;
    let forwardedObserver: unknown;
    const harness = dispatchHarness(board, {
      resolveTarget: fakeResolver(['C:\\Tools\\claude.EXE']),
      createProcessObserver: (context, reportProgress) => {
        observedContext = context;
        reportProgress('CLI output line');
        return observer;
      },
      runHandoff: async (handoff, options) => {
        forwardedObserver = options?.observer;
        return runAgentCliCardHandoff(handoff, {
          ...(options ?? {}),
          runProcess: async () => {
            board.mutate((current) => appendActivity(current, handoff.cardId, 'STATUS: DONE'));
            return successfulProcess();
          },
          now: () => new Date('2026-07-26T15:00:00.000Z'),
        });
      },
    });

    const completed = await runCardWithAgentCli(request('claude-code', cardId), harness.deps);

    assert.equal(completed, true);
    assert.deepEqual(observedContext, {
      card: { id: cardId, title: 'Run the card via CLI' },
      kind: 'implementation',
      providerLabel: AGENT_CLI_LABELS['claude-code'],
    });
    assert.equal(forwardedObserver, observer);
    assert.deepEqual(harness.progressMessages, ['CLI output line']);
  });

  test('the in-flight guard rejects a second run on the same card while a CLI run is active', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeStore(state);
    const inFlight = createChatHandoffInFlight();
    let releaseProcess: (() => void) | undefined;
    let processLaunches = 0;
    const harness = dispatchHarness(board, {
      resolveTarget: fakeResolver(['C:\\Tools\\claude.EXE']),
      runHandoff: realHandoffWith(async () => {
        processLaunches += 1;
        await new Promise<void>((resolve) => {
          releaseProcess = resolve;
        });
        board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
        return successfulProcess();
      }),
    });
    const dispatch = (): Promise<boolean> =>
      runCardWithAgentCli(request('claude-code', cardId), harness.deps);

    const first = inFlight.run(cardId, dispatch);
    while (releaseProcess === undefined) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const second = await inFlight.run(cardId, dispatch);
    assert.deepEqual(second, { started: false });
    assert.equal(processLaunches, 1, 'the guard must prevent a second CLI process');

    releaseProcess?.();
    const firstAttempt = await first;
    assert.equal(firstAttempt.started, true);
    assert.equal(firstAttempt.started ? firstAttempt.value : undefined, true);
  });
});

suite('Run with AI CLI outcome messages', () => {
  test('names the provider and card in every outcome', () => {
    const base = { completed: false, cancelled: false, activityBaseline: 0 };
    const done = describeAgentCliRunOutcome('GitHub Copilot CLI', 'my card', 'implementation', {
      ...base,
      completed: true,
      terminalStatus: { kind: 'done' },
    });
    assert.equal(done.severity, 'info');
    assert.match(done.message, /GitHub Copilot CLI/);
    assert.match(done.message, /my card/);

    const failed = describeAgentCliRunOutcome('GitHub Copilot CLI', 'my card', 'implementation', {
      ...base,
      reason: 'exit code 2',
    });
    assert.equal(failed.severity, 'warning');
    assert.equal(failed.message, 'exit code 2');

    const failedWithoutReason = describeAgentCliRunOutcome('GitHub Copilot CLI', 'my card', 'implementation', base);
    assert.equal(failedWithoutReason.severity, 'warning');
    assert.match(failedWithoutReason.message, /did not complete "my card"/);
  });

  test('a parked implementation names the Verify column and the Human reassignment', () => {
    const outcome = describeAgentCliRunOutcome(
      'GitHub Copilot CLI',
      'my card',
      'implementation',
      { completed: true, cancelled: false, activityBaseline: 0, terminalStatus: { kind: 'done' } },
      'Verify',
    );
    assert.equal(outcome.severity, 'info');
    assert.match(outcome.message, /now in Verify/);
    assert.match(outcome.message, /assigned to Human/);
  });

  test('a completed definition reports the filled-in definition instead of STATUS: DONE', () => {
    const outcome = describeAgentCliRunOutcome('OpenAI Codex CLI', 'my card', 'definition', {
      completed: true,
      cancelled: false,
      activityBaseline: 0,
    });
    assert.equal(outcome.severity, 'info');
    assert.match(outcome.message, /filled in "my card"/);
    assert.match(outcome.message, /Description and Acceptance criteria/);
    assert.doesNotMatch(outcome.message, /STATUS: DONE/);
  });
});
