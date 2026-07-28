import * as vscode from 'vscode';
import { createAiLoopProgressOptions, createStatusBarProgressOptions } from './aiLoopProgress';
import {
  createCliOutputFeed,
  formatCliRunExit,
  formatCliRunStart,
} from './agentCliFeedback';
import {
  AGENT_CLI_LABELS,
  AGENT_CLI_PROVIDER_IDS,
  resolveAgentCliTarget,
  resolveAllAgentCliTargets,
  runAgentCliCardHandoff,
  type AgentCliHandoffKind,
  type AgentCliPathOverrides,
  type AgentCliProcessObserver,
  type AgentCliProviderId,
  type AgentCliTarget,
} from './agentCliHandoff';
import {
  isAgentCliPreference,
  listAiLoopExecutionModeChoices,
  type AiLoopProviderPreference,
} from './aiLoopProvider';
import {
  buildCardDefinitionPrompt,
  buildCardHandoffPrompt,
  buildPlanImportPrompt,
  findAiCardSelection,
  formatDefinitionHandoffEntry,
  formatHandoffEntry,
  listAiCardSelections,
  summarizeCardDescription,
  type PlanImportSource,
} from './aiCards';
import {
  CHAT_PROVIDER_LABELS,
  createChatHandoffInFlight,
  deliverClipboardHandoff,
  describeChatHandoffTarget,
  formatChatHandoffFailure,
  listAvailableChatProviders,
  shouldAutoPasteChatHandoff,
  type ChatHandoffTarget,
  type ChatProviderCommands,
  type ChatProviderId,
} from './chatHandoff';
import {
  listRunWithAiProviderChoices,
  runCardWithAgentCli,
  type RunCardWithAgentCliDeps,
  type RunWithAiProviderChoice,
} from './runWithAi';
import {
  buildDoabilityPrompt,
  buildTriagePrompt,
  formatTriageHandoffEntry,
  parseDoabilityDecision,
  runBoardLoop,
  type DoabilityVerdict,
  type LoopGateways,
  type LoopSummary,
} from './boardLoop';
import { BoardPanel } from './boardPanel';
import { BoardSidebarViewProvider } from './sidebarView';
import { createBoardStore, type FileSystemLike } from './boardStore';
import {
  parseSkillDocument,
  planSkillInstallation,
  referencePathsForEnv,
  type AiEnvironment,
  type SkillSource,
} from './skills';
import type { BoardState } from './types';

/** Skill documents bundled with the extension, under `media/skills/<slug>.md`. */
const SKILL_SLUGS = ['mwnn-plan-import', 'mwnn-card-authoring'] as const;

/** Which AI environment a chosen chat handoff provider corresponds to. */
const PROVIDER_ENVIRONMENTS: Record<ChatProviderId, AiEnvironment> = {
  copilot: 'copilot',
  codex: 'codex',
  'claude-code': 'claude-code',
};

type BoardStore = Awaited<ReturnType<typeof createBoardStore>>;
type BoardColumn = BoardState['columns'][number];
type BoardCard = BoardColumn['cards'][number];
type AiLoopTarget =
  | { readonly kind: 'chat'; readonly target: ChatHandoffTarget }
  | { readonly kind: 'cli'; readonly target: AgentCliTarget };

function readDefaultColumns(): string[] {
  const config = vscode.workspace.getConfiguration('mwnn-kanban');
  return config.get<string[]>('defaultColumns', ['Backlog', 'Ready', 'In Progress', 'Verify', 'Done']);
}

function readBoardFolder(): string {
  return vscode.workspace.getConfiguration('mwnn-kanban').get<string>('boardFolder', '.mwnn');
}

function readDefaultReadyReverseWip(): number {
  return vscode.workspace.getConfiguration('mwnn-kanban').get<number>('defaultReadyReverseWip', 3);
}

function confirmDeletion(): boolean {
  return vscode.workspace.getConfiguration('mwnn-kanban').get<boolean>('confirmCardDeletion', true);
}

function readEnableRunWithAI(): boolean {
  return vscode.workspace.getConfiguration('mwnn-kanban').get<boolean>('enableRunWithAI', true);
}

function readChatProviderCommands(): ChatProviderCommands {
  return vscode.workspace
    .getConfiguration('mwnn-kanban')
    .get<ChatProviderCommands>('chatProviderCommands', {});
}

function readAiLoopProvider(): AiLoopProviderPreference {
  return vscode.workspace
    .getConfiguration('mwnn-kanban')
    .get<AiLoopProviderPreference>('aiLoopProvider', 'prompt');
}

function readAiLoopReviewFreshDefinitions(): boolean {
  return vscode.workspace
    .getConfiguration('mwnn-kanban')
    .get<boolean>('aiLoopReviewFreshDefinitions', false);
}

function readAgentCliPaths(): AgentCliPathOverrides {
  return vscode.workspace
    .getConfiguration('mwnn-kanban')
    .get<AgentCliPathOverrides>('agentCliPaths', {});
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot) {
    registerUnavailableCommands(context);
    return;
  }

  const workspaceFs = createWorkspaceFileSystem(workspaceRoot);
  const store = await createBoardStore({
    fileSystem: workspaceFs,
    boardFolder: readBoardFolder(),
    defaultColumns: readDefaultColumns(),
    defaultReadyReverseWip: readDefaultReadyReverseWip(),
    legacyMemento: context.workspaceState,
  });

  const inFlightCardHandoffs = createChatHandoffInFlight();

  const runCardHandoff = async (cardId: string, action: () => Promise<boolean>): Promise<boolean> => {
    const attempt = await inFlightCardHandoffs.run(cardId, action);
    if (!attempt.started) {
      void vscode.window.showInformationMessage('A handoff for this card is already in progress. Please wait for it to finish.');
      return false;
    }
    return attempt.value;
  };

  // Every provider CLI run streams its full output here, so the user can
  // follow along and read back what a CLI actually did.
  const cliOutputChannel = vscode.window.createOutputChannel('MWNN Agent CLI', { log: true });
  context.subscriptions.push(cliOutputChannel);

  const SHOW_CLI_OUTPUT_ACTION = 'Show Output';
  const showCliInformation = (message: string): void => {
    void vscode.window.showInformationMessage(message, SHOW_CLI_OUTPUT_ACTION).then((choice) => {
      if (choice === SHOW_CLI_OUTPUT_ACTION) {
        cliOutputChannel.show(true);
      }
    });
  };
  const showCliWarning = (message: string): void => {
    cliOutputChannel.warn(message);
    void vscode.window.showWarningMessage(message, SHOW_CLI_OUTPUT_ACTION).then((choice) => {
      if (choice === SHOW_CLI_OUTPUT_ACTION) {
        cliOutputChannel.show(true);
      }
    });
  };

  /**
   * Live feedback for one agent-CLI process: full output into the output
   * channel, a throttled latest-line into the progress UI, and a running
   * badge with that same line on the card in the board webview.
   */
  const createCliRunObserver = (
    card: { readonly id: string; readonly title: string },
    kind: AgentCliHandoffKind,
    providerLabel: string,
    reportProgress: (message: string) => void,
  ): AgentCliProcessObserver => {
    const postStatus = (running: boolean, statusLine?: string): void => {
      BoardPanel.postCliRunStatusIfOpen({
        cardId: card.id,
        providerLabel,
        running,
        ...(statusLine !== undefined ? { statusLine } : {}),
      });
    };
    const feed = createCliOutputFeed({
      onLine: (line, stream) =>
        cliOutputChannel.info(stream === 'stderr' ? `[stderr] ${line}` : line),
      onStatus: (line) => {
        reportProgress(line);
        postStatus(true, line);
      },
    });
    return {
      onStart: (invocation) => {
        for (const line of formatCliRunStart(invocation, kind, card.title)) {
          cliOutputChannel.info(line);
        }
        postStatus(true, `Starting ${providerLabel}…`);
      },
      onOutput: (chunk, stream) => feed.write(chunk, stream),
      onExit: (result) => {
        feed.flush();
        cliOutputChannel.info(formatCliRunExit(result));
        postStatus(false);
      },
    };
  };

  const agentCliRunDeps = (): RunCardWithAgentCliDeps => ({
    configuredPaths: readAgentCliPaths(),
    cwd: workspaceRoot.fsPath,
    store,
    runWithProgress: runAgentCliWithStatusBarProgress,
    createProcessObserver: (runContext, reportProgress) =>
      createCliRunObserver(runContext.card, runContext.kind, runContext.providerLabel, reportProgress),
    showInformation: showCliInformation,
    showWarning: showCliWarning,
    refreshBoard: () => BoardPanel.postStateIfOpen(),
  });

  const runCardWithAISelection = async (cardId?: string): Promise<void> => {
    if (!readEnableRunWithAI()) {
      void vscode.window.showInformationMessage('Enable "MWNN Kanban: Run With AI" in settings to use this command.');
      return;
    }

    const state = store.getState();
    const selection = cardId ? findAiCardSelection(state, cardId) : await pickAiCard(state);
    if (!selection) {
      if (cardId) {
        void vscode.window.showInformationMessage('Assign this card to AI before running it with AI.');
      }
      return;
    }

    await runCardHandoff(selection.card.id, async () => {
      const choice = await pickRunWithAiProvider();
      if (!choice) {
        return false;
      }

      const boardFolder = readBoardFolder().replace(/\\/g, '/').replace(/\/+$/, '');
      const cardFilePath = `${boardFolder}/cards/${selection.card.id}.md`;
      const prompt = buildCardHandoffPrompt(selection.card, cardFilePath);

      if (choice.kind === 'cli') {
        return runCardWithAgentCli(
          { provider: choice.provider, kind: 'implementation', card: selection.card, prompt },
          agentCliRunDeps(),
        );
      }

      const handedOff = await handOffPromptToChat(choice.target, prompt, `"${selection.card.title}"`);
      if (!handedOff) {
        return false;
      }

      // Record the dispatch ourselves: the hand-off is fire-and-forget, so we
      // cannot rely on the external agent to leave any trace in the activity log.
      await store.appendActivity(selection.card.id, formatHandoffEntry(CHAT_PROVIDER_LABELS[choice.target.provider]));
      BoardPanel.postStateIfOpen();
      return true;
    });
  };

  const fillCardDefinitionWithAI = async (cardId: string): Promise<void> => {
    if (!readEnableRunWithAI()) {
      void vscode.window.showInformationMessage('Enable "MWNN Kanban: Run With AI" in settings to let AI fill in card definitions.');
      return;
    }

    const card = findCardById(store.getState(), cardId);
    if (!card) {
      return;
    }

    await runCardHandoff(card.id, async () => {
      const choice = await pickRunWithAiProvider('Fill in this card with which AI provider?');
      if (!choice) {
        return false;
      }

      const boardFolder = readBoardFolder().replace(/\\/g, '/').replace(/\/+$/, '');
      const cardFilePath = `${boardFolder}/cards/${card.id}.md`;
      const prompt = buildCardDefinitionPrompt(card, cardFilePath);

      if (choice.kind === 'cli') {
        return runCardWithAgentCli(
          { provider: choice.provider, kind: 'definition', card, prompt },
          agentCliRunDeps(),
        );
      }

      const handedOff = await handOffPromptToChat(choice.target, prompt, `"${card.title}"`);
      if (!handedOff) {
        return false;
      }

      await store.appendActivity(card.id, formatDefinitionHandoffEntry(CHAT_PROVIDER_LABELS[choice.target.provider]));
      BoardPanel.postStateIfOpen();
      return true;
    });
  };

  const importPlan = async (): Promise<void> => {
    if (!readEnableRunWithAI()) {
      void vscode.window.showInformationMessage('Enable "MWNN Kanban: Run With AI" in settings to import a plan with AI.');
      return;
    }

    const source = await collectPlanSource();
    if (source === undefined) {
      // The user cancelled at the source picker, file picker, or had no files.
      return;
    }
    const state = store.getState();
    const targetColumn = state.columns.find((column) => column.role === 'backlog') ?? state.columns[0];
    if (!targetColumn) {
      void vscode.window.showInformationMessage('Add a column before importing a plan.');
      return;
    }

    const target = await pickChatProvider();
    if (!target) {
      return;
    }

    // Install the skills into every AI tool this workspace uses (plus the tool we
    // are handing off to) so the guidance travels with the project on any machine.
    // Best-effort: the prompt is self-contained, so a write failure never blocks import.
    const providerEnv = PROVIDER_ENVIRONMENTS[target.provider];
    try {
      await ensureSkillsInstalled(context.extensionUri, workspaceFs, providerEnv);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(
        `Could not install the MWNN skills into this workspace: ${message}. Continuing — the prompt is self-contained.`,
      );
    }

    const boardFolder = readBoardFolder().replace(/\\/g, '/').replace(/\/+$/, '');
    const prompt = buildPlanImportPrompt(
      source,
      { columnId: targetColumn.id, columnTitle: targetColumn.title, existingCount: targetColumn.cards.length },
      boardFolder,
      referencePathsForEnv(providerEnv, SKILL_SLUGS),
    );
    const handedOff = await handOffPromptToChat(target, prompt, 'the plan');
    if (!handedOff) {
      return;
    }

    openBoard().postState();
    void vscode.window.showInformationMessage(
      `Handed the plan to ${CHAT_PROVIDER_LABELS[target.provider]} to import into ${targetColumn.title}. New cards appear as the agent writes them.`,
    );
  };

  // At most one AI loop runs at a time. The flag stops either execution mode;
  // for CLI mode, the AbortController also terminates the active child process.
  let activeLoop: { cancelled: boolean; abortController: AbortController } | undefined;

  const runBoardLoopCommand = async (): Promise<void> => {
    if (!readEnableRunWithAI()) {
      void vscode.window.showInformationMessage('Enable "MWNN Kanban: Run With AI" in settings to use this command.');
      return;
    }
    if (activeLoop) {
      void vscode.window.showInformationMessage('The MWNN AI loop is already running.');
      return;
    }

    const selectedTarget = await pickAiLoopTarget(workspaceRoot.fsPath);
    if (!selectedTarget) {
      return;
    }

    const boardFolder = readBoardFolder().replace(/\\/g, '/').replace(/\/+$/, '');
    const cardFilePath = (card: BoardCard): string => `${boardFolder}/cards/${card.id}.md`;
    const loop = { cancelled: false, abortController: new AbortController() };
    activeLoop = loop;

    // Rebound to the live progress reporter once the loop's withProgress
    // starts; CLI handoffs stream their latest output line through it.
    let reportLoopProgress: (message: string) => void = () => {};

    let gateways: LoopGateways;
    if (selectedTarget.kind === 'chat') {
      const chatTarget = selectedTarget.target;
      const providerLabel = CHAT_PROVIDER_LABELS[chatTarget.provider];
      gateways = {
        dispatchCard: async (card) =>
          runCardHandoff(card.id, async () => {
            const handedOff = await handOffPromptToChat(
              chatTarget,
              buildCardHandoffPrompt(card, cardFilePath(card)),
              `"${card.title}"`,
            );
            if (handedOff) {
              await store.appendActivity(card.id, formatHandoffEntry(providerLabel));
              BoardPanel.postStateIfOpen();
            }
            return handedOff;
          }),
        requestDefinition: async (card) =>
          runCardHandoff(card.id, async () => {
            const handedOff = await handOffPromptToChat(
              chatTarget,
              buildCardDefinitionPrompt(card, cardFilePath(card)),
              `"${card.title}"`,
            );
            if (handedOff) {
              await store.appendActivity(card.id, formatDefinitionHandoffEntry(providerLabel));
              BoardPanel.postStateIfOpen();
            }
            return handedOff;
          }),
        decideDoability: decideCardDoability,
        requestTriage: async (card) =>
          runCardHandoff(card.id, async () => {
            const handedOff = await handOffPromptToChat(
              chatTarget,
              buildTriagePrompt(card, cardFilePath(card)),
              `"${card.title}"`,
            );
            if (handedOff) {
              await store.appendActivity(card.id, formatTriageHandoffEntry(providerLabel));
              BoardPanel.postStateIfOpen();
            }
            return handedOff;
          }),
      };
    } else {
      const cliTarget = selectedTarget.target;
      const runCliHandoff = async (
        kind: AgentCliHandoffKind,
        card: BoardCard,
        prompt: string,
      ): Promise<{ readonly started: boolean; readonly activityBaseline?: number }> => {
        const attempt = await inFlightCardHandoffs.run(card.id, () =>
          runAgentCliCardHandoff(
            {
              kind,
              target: cliTarget,
              cardId: card.id,
              prompt,
              cwd: workspaceRoot.fsPath,
              store,
              signal: loop.abortController.signal,
            },
            {
              observer: createCliRunObserver(
                card,
                kind,
                cliTarget.label,
                (message) => reportLoopProgress(message),
              ),
            },
          ));
        if (!attempt.started) {
          void vscode.window.showInformationMessage(
            'A handoff for this card is already in progress. Stop it or wait for it to finish.',
          );
          return { started: false };
        }

        BoardPanel.postStateIfOpen();
        const result = attempt.value;
        if (!result.completed && !result.cancelled && result.reason) {
          showCliWarning(result.reason);
        }
        return {
          started: result.completed,
          activityBaseline: result.activityBaseline,
        };
      };

      gateways = {
        dispatchCard: (card) =>
          runCliHandoff('implementation', card, buildCardHandoffPrompt(card, cardFilePath(card))),
        requestDefinition: (card) =>
          runCliHandoff('definition', card, buildCardDefinitionPrompt(card, cardFilePath(card))),
        decideDoability: decideCardDoability,
        requestTriage: (card) =>
          runCliHandoff('triage', card, buildTriagePrompt(card, cardFilePath(card))),
      };
    }

    try {
      const summary = await vscode.window.withProgress(
        createAiLoopProgressOptions(vscode.ProgressLocation),
        (progress, token) => {
          reportLoopProgress = (message) => progress.report({ message });
          token.onCancellationRequested(() => {
            loop.cancelled = true;
            loop.abortController.abort();
          });
          return runBoardLoop(
            store,
            gateways,
            { isCancelled: () => loop.cancelled, delay: waitForMilliseconds },
            {
              onEvent: (message) => progress.report({ message }),
              reviewFreshDefinitions: readAiLoopReviewFreshDefinitions(),
            },
          );
        },
      );
      BoardPanel.postStateIfOpen();
      void vscode.window.showInformationMessage(summarizeLoopRun(summary));
    } finally {
      activeLoop = undefined;
    }
  };

  const stopBoardLoopCommand = (): void => {
    if (!activeLoop) {
      void vscode.window.showInformationMessage('The MWNN AI loop is not running.');
      return;
    }
    activeLoop.cancelled = true;
    activeLoop.abortController.abort();
  };

  const boardPanelDeps = {
    store,
    extensionUri: context.extensionUri,
    confirmDeletion,
    runCardWithAI: runCardWithAISelection,
    fillCardDefinition: fillCardDefinitionWithAI,
    zoomMemento: context.workspaceState,
  };

  const openBoard = (): BoardPanel => BoardPanel.show(boardPanelDeps);

  context.subscriptions.push(registerBoardWatcher(workspaceRoot, readBoardFolder(), store));
  context.subscriptions.push(
    // Reopen the board automatically when VS Code restores a session in which
    // the board panel was open (restart or window reload). Restoration routes
    // through the existing singleton, so a restored panel behaves exactly like
    // a freshly opened one.
    vscode.window.registerWebviewPanelSerializer(BoardPanel.viewType, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
        BoardPanel.restore(panel, boardPanelDeps);
      },
    }),
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      BoardSidebarViewProvider.viewType,
      new BoardSidebarViewProvider(
        context.extensionUri,
        openBoard,
        () => void importPlan(),
        () => void runBoardLoopCommand(),
        () => BoardPanel.status(),
        BoardPanel.onDidChangeState,
      ),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('mwnn-kanban.openBoard', () => {
      openBoard();
    }),
    vscode.commands.registerCommand('mwnn-kanban.addColumn', async () => {
      const title = await vscode.window.showInputBox({ prompt: 'New column title' });
      const normalizedTitle = title?.trim();
      if (!normalizedTitle) {
        return;
      }
      await store.addColumn(normalizedTitle);
      openBoard().postState();
    }),
    vscode.commands.registerCommand('mwnn-kanban.renameColumn', async () => {
      const column = await pickColumn(store.getState(), 'Rename which column?');
      if (!column) {
        return;
      }

      const title = await vscode.window.showInputBox({
        prompt: 'Column title',
        value: column.title,
      });
      const normalizedTitle = title?.trim();
      if (!normalizedTitle) {
        return;
      }

      await store.renameColumn(column.id, normalizedTitle);
      openBoard().postState();
    }),
    vscode.commands.registerCommand('mwnn-kanban.deleteColumn', async () => {
      const state = store.getState();
      if (state.columns.length <= 1) {
        void vscode.window.showInformationMessage('The board must keep at least one column.');
        return;
      }

      const column = await pickColumn(state, 'Delete which column?');
      if (!column) {
        return;
      }

      let targetColumnId: string | undefined;
      if (column.cards.length > 0) {
        const target = await pickColumn(
          { ...state, columns: state.columns.filter((candidate) => candidate.id !== column.id) },
          `Move ${column.cards.length} card(s) into which column?`,
        );
        if (!target) {
          return;
        }
        targetColumnId = target.id;
      }

      const choice = await vscode.window.showWarningMessage(
        `Delete column "${column.title}"?`,
        { modal: true },
        'Delete',
      );
      if (choice !== 'Delete') {
        return;
      }

      await store.removeColumn(column.id, targetColumnId);
      openBoard().postState();
    }),
    vscode.commands.registerCommand('mwnn-kanban.setColumnLimits', async () => {
      const column = await pickColumn(store.getState(), 'Set limits for which column?');
      if (!column) {
        return;
      }

      const wipLimit = await promptForLimit('WIP limit', column.wipLimit ?? null);
      if (wipLimit.cancelled) {
        return;
      }

      const reverseWip = await promptForLimit('Ready reverse-WIP minimum', column.reverseWip ?? null);
      if (reverseWip.cancelled) {
        return;
      }

      await store.setColumnConfig(column.id, {
        wipLimit: wipLimit.value,
        reverseWip: reverseWip.value,
      });
      openBoard().postState();
    }),
    vscode.commands.registerCommand('mwnn-kanban.runCardWithAI', async () => {
      await runCardWithAISelection();
    }),
    vscode.commands.registerCommand('mwnn-kanban.runBoardLoop', async () => {
      await runBoardLoopCommand();
    }),
    vscode.commands.registerCommand('mwnn-kanban.stopBoardLoop', () => {
      stopBoardLoopCommand();
    }),
    vscode.commands.registerCommand('mwnn-kanban.stopCardRun', () => {
      stopCardCliRuns();
    }),
    vscode.commands.registerCommand('mwnn-kanban.importPlan', async () => {
      await importPlan();
    }),
    vscode.commands.registerCommand('mwnn-kanban.resetBoard', async () => {
      const choice = await vscode.window.showWarningMessage(
        'Reset the board? All cards will be removed.',
        { modal: true },
        'Reset',
      );
      if (choice !== 'Reset') {
        return;
      }
      await store.reset();
      openBoard().postState();
    }),
  );
}

export function deactivate(): void {
  // Nothing to clean up; the panel disposes itself.
}

function createWorkspaceFileSystem(rootUri: vscode.Uri): FileSystemLike {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function resolve(relativePath: string): vscode.Uri {
    const segments = relativePath.split('/').filter((segment) => segment.length > 0);
    return vscode.Uri.joinPath(rootUri, ...segments);
  }

  return {
    async exists(relativePath: string): Promise<boolean> {
      try {
        await vscode.workspace.fs.stat(resolve(relativePath));
        return true;
      } catch {
        return false;
      }
    },
    async readFile(relativePath: string): Promise<string> {
      const bytes = await vscode.workspace.fs.readFile(resolve(relativePath));
      return decoder.decode(bytes);
    },
    async writeFile(relativePath: string, content: string): Promise<void> {
      await vscode.workspace.fs.writeFile(resolve(relativePath), encoder.encode(content));
    },
    async deleteFile(relativePath: string): Promise<void> {
      try {
        await vscode.workspace.fs.delete(resolve(relativePath), { useTrash: false });
      } catch {
        // Ignore already-missing files during sync cleanup.
      }
    },
    async readDirectory(relativePath: string): Promise<readonly string[]> {
      const entries = await vscode.workspace.fs.readDirectory(resolve(relativePath));
      return entries.map(([name]) => name);
    },
    async createDirectory(relativePath: string): Promise<void> {
      await vscode.workspace.fs.createDirectory(resolve(relativePath));
    },
  };
}

/** Read and parse the skill documents bundled with the extension. */
async function loadBundledSkills(extensionUri: vscode.Uri): Promise<SkillSource[]> {
  const decoder = new TextDecoder();
  const skills: SkillSource[] = [];
  for (const slug of SKILL_SLUGS) {
    const uri = vscode.Uri.joinPath(extensionUri, 'media', 'skills', `${slug}.md`);
    const raw = decoder.decode(await vscode.workspace.fs.readFile(uri));
    skills.push(parseSkillDocument(slug, raw));
  }
  return skills;
}

/** Detect which AI tools a workspace uses, from their marker files/folders. */
async function detectAiEnvironments(fs: FileSystemLike): Promise<Set<AiEnvironment>> {
  const found = new Set<AiEnvironment>();
  if (await fs.exists('.github')) {
    found.add('copilot');
  }
  if ((await fs.exists('AGENTS.md')) || (await fs.exists('.codex'))) {
    found.add('codex');
  }
  if ((await fs.exists('.claude')) || (await fs.exists('CLAUDE.md'))) {
    found.add('claude-code');
  }
  if ((await fs.exists('.cursor')) || (await fs.exists('.cursorrules'))) {
    found.add('cursor');
  }
  return found;
}

/**
 * Install the bundled skills into each detected AI environment, plus the
 * detected provider we are about to hand off to. Skips files whose content is
 * unchanged so re-imports don't churn. Returns the paths written this run.
 */
async function ensureSkillsInstalled(
  extensionUri: vscode.Uri,
  fs: FileSystemLike,
  providerEnv: AiEnvironment,
): Promise<string[]> {
  const skills = await loadBundledSkills(extensionUri);

  const environments = await detectAiEnvironments(fs);
  environments.add(providerEnv);

  const existingAgentsMd = environments.has('codex') && (await fs.exists('AGENTS.md'))
    ? await fs.readFile('AGENTS.md')
    : undefined;

  const plan = planSkillInstallation(skills, [...environments], existingAgentsMd);
  const written: string[] = [];
  for (const write of plan.writes) {
    const separator = write.path.lastIndexOf('/');
    if (separator !== -1) {
      await fs.createDirectory(write.path.slice(0, separator));
    }

    if (await fs.exists(write.path)) {
      const current = await fs.readFile(write.path);
      if (current === write.content) {
        continue;
      }
    }

    await fs.writeFile(write.path, write.content);
    written.push(write.path);
  }
  return written;
}

function registerUnavailableCommands(context: vscode.ExtensionContext): void {
  const showWorkspaceMessage = (): Thenable<string | undefined> =>
    vscode.window.showInformationMessage('Open a workspace folder to use MWNN Kanban.');

  context.subscriptions.push(
    // Without a workspace folder there is no store to back a board, so a panel
    // persisted from a previous session cannot be safely restored. Claim the
    // view type and dispose any restored panel instead of crashing or opening
    // a board against a missing store.
    vscode.window.registerWebviewPanelSerializer(BoardPanel.viewType, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
        panel.dispose();
      },
    }),
    vscode.window.registerWebviewViewProvider(
      BoardSidebarViewProvider.viewType,
      new BoardSidebarViewProvider(
        context.extensionUri,
        () => void showWorkspaceMessage(),
        () => void showWorkspaceMessage(),
        () => void showWorkspaceMessage(),
        // No workspace means no board can open; the button stays in its default
        // "Open Board" state and never changes.
        () => ({ open: false, focused: false }),
        BoardPanel.onDidChangeState,
      ),
    ),
    vscode.commands.registerCommand('mwnn-kanban.openBoard', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.addColumn', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.renameColumn', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.deleteColumn', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.setColumnLimits', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.runCardWithAI', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.runBoardLoop', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.stopBoardLoop', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.stopCardRun', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.importPlan', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.resetBoard', showWorkspaceMessage),
  );
}

function registerBoardWatcher(
  workspaceRoot: vscode.Uri,
  boardFolder: string,
  store: BoardStore,
): vscode.Disposable {
  const normalizedBoardFolder = boardFolder.replace(/\\/g, '/').replace(/\/+$/, '');
  const pattern = normalizedBoardFolder.length > 0 ? `${normalizedBoardFolder}/**` : '**';
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceRoot, pattern));

  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  let reloadInFlight = false;

  const scheduleReload = (): void => {
    if (reloadTimer !== undefined) {
      clearTimeout(reloadTimer);
    }

    reloadTimer = setTimeout(() => {
      reloadTimer = undefined;
      if (reloadInFlight) {
        scheduleReload();
        return;
      }

      reloadInFlight = true;
      void store
        .reload()
        .then(() => {
          BoardPanel.postStateIfOpen();
        })
        .finally(() => {
          reloadInFlight = false;
        });
    }, 75);
  };

  watcher.onDidCreate(scheduleReload);
  watcher.onDidChange(scheduleReload);
  watcher.onDidDelete(scheduleReload);

  return new vscode.Disposable(() => {
    if (reloadTimer !== undefined) {
      clearTimeout(reloadTimer);
    }
    watcher.dispose();
  });
}

/**
 * Choose a plan source for the existing AI handoff. Clipboard text and the
 * workspace markdown picker remain available; the added path option accepts a
 * workspace-relative or absolute local path. File imports pass the path through
 * unchanged, and the extension never parses a plan.
 */
async function collectPlanSource(): Promise<PlanImportSource | undefined> {
  const fromClipboard = 'Paste from clipboard';
  const fromWorkspaceFile = 'Select a markdown file from the workspace';
  const fromPath = 'Enter a local file path';
  const source = await vscode.window.showQuickPick(
    [
      { label: fromClipboard, detail: 'Import the plan text currently on your clipboard' },
      { label: fromWorkspaceFile, detail: 'Pick a .md file in this workspace for the AI to read' },
      { label: fromPath, detail: 'Use a workspace-relative or absolute local path for the AI to read' },
    ],
    { placeHolder: 'Import plan from…' },
  );
  if (!source) {
    return undefined;
  }

  if (source.label === fromClipboard) {
    return { kind: 'text', text: await vscode.env.clipboard.readText() };
  }

  if (source.label === fromPath) {
    const path = await vscode.window.showInputBox({
      prompt: 'Path to the local plan file for AI to import',
      placeHolder: 'Workspace-relative or absolute path (for example, docs/plan.md)',
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.trim().length > 0 ? undefined : 'Enter a workspace-relative or absolute local file path.',
    });
    const normalizedPath = path?.trim();
    return normalizedPath ? { kind: 'file', path: normalizedPath } : undefined;
  }

  const files = await vscode.workspace.findFiles('**/*.md', '**/node_modules/**');
  if (files.length === 0) {
    void vscode.window.showInformationMessage('No markdown files were found in this workspace.');
    return undefined;
  }

  const sorted = [...files].sort((left, right) =>
    vscode.workspace.asRelativePath(left).localeCompare(vscode.workspace.asRelativePath(right)),
  );
  const pick = await vscode.window.showQuickPick(
    sorted.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri })),
    { placeHolder: 'Select a markdown plan file' },
  );
  if (!pick) {
    return undefined;
  }

  return { kind: 'file', path: vscode.workspace.asRelativePath(pick.uri) };
}

async function pickColumn(
  state: BoardState,
  placeHolder: string,
): Promise<BoardState['columns'][number] | undefined> {
  const items = state.columns.map((column) => ({
    label: column.title,
    description: `${column.cards.length} card(s)`,
    column,
  }));

  const choice = await vscode.window.showQuickPick(items, { placeHolder });
  return choice?.column;
}

async function pickAiCard(
  state: BoardState,
): Promise<{ readonly card: BoardCard; readonly nextColumn?: BoardColumn } | undefined> {
  const items = listAiCardSelections(state).map((selection) => ({
    label: selection.card.title,
    description: `${findCardColumn(state, selection.card.id)?.title ?? 'Unknown'} - ${(selection.card.assignee?.name ?? 'AI').trim()}`,
    detail: summarizeCardDescription(selection.card.description),
    ...selection,
  }));

  if (items.length === 0) {
    void vscode.window.showInformationMessage('Assign a card to AI before running it with AI.');
    return undefined;
  }

  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: 'Run which AI-assigned card?',
  });
  if (!choice) {
    return undefined;
  }

  return choice.nextColumn
    ? { card: choice.card, nextColumn: choice.nextColumn }
    : { card: choice.card };
}

function findCardColumn(state: BoardState, cardId: string): BoardColumn | undefined {
  return state.columns.find((column) => column.cards.some((card) => card.id === cardId));
}

function findCardById(state: BoardState, cardId: string): BoardCard | undefined {
  for (const column of state.columns) {
    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      return card;
    }
  }
  return undefined;
}

/**
 * Ask a language model whether an AI agent could complete this card, for the
 * loop's unassigned-card triage. Uses the VS Code Language Model API (any
 * available model) because — unlike the chat hand-off — the answer must come
 * back programmatically. Returns undefined when no model is available or the
 * response has no verdict, in which case the loop falls back to a chat
 * hand-off triage.
 */
async function decideCardDoability(card: BoardCard): Promise<DoabilityVerdict | undefined> {
  try {
    const [model] = await vscode.lm.selectChatModels();
    if (!model) {
      return undefined;
    }
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(buildDoabilityPrompt(card))],
      {},
    );
    let text = '';
    for await (const fragment of response.text) {
      text += fragment;
    }
    return parseDoabilityDecision(text);
  } catch {
    return undefined;
  }
}

function summarizeLoopRun(summary: LoopSummary): string {
  const parts: string[] = [];
  if (summary.dispatched.length > 0) {
    parts.push(`dispatched ${summary.dispatched.length}`);
  }
  if (summary.advanced.length > 0) {
    parts.push(`advanced ${summary.advanced.length}`);
  }
  if (summary.movedToReady.length > 0) {
    parts.push(`placed ${summary.movedToReady.length} freshly defined in Ready`);
  }
  if (summary.parked.length > 0) {
    parts.push(`parked ${summary.parked.length} in Verify for human sign-off`);
  }
  if (summary.triagedToAi.length > 0 || summary.triagedToHuman.length > 0) {
    parts.push(`triaged ${summary.triagedToAi.length} to AI and ${summary.triagedToHuman.length} to Human`);
  }
  if (summary.definitionsRequested.length > 0) {
    parts.push(`requested ${summary.definitionsRequested.length} definition(s)`);
  }
  if (summary.skipped.length > 0) {
    parts.push(`skipped ${summary.skipped.length}`);
  }
  const activity = parts.length > 0 ? parts.join(', ') : 'no eligible cards found';
  return summary.cancelled ? `MWNN AI loop stopped: ${activity}.` : `MWNN AI loop finished: ${activity}.`;
}

async function pickAiLoopTarget(workspaceCwd: string): Promise<AiLoopTarget | undefined> {
  const preference = readAiLoopProvider();

  if (preference === 'chat') {
    const target = await pickChatProvider();
    return target ? { kind: 'chat', target } : undefined;
  }
  if (isAgentCliPreference(preference)) {
    const target = await pickAgentCliTarget(workspaceCwd, preference);
    return target ? { kind: 'cli', target } : undefined;
  }

  const mode = await vscode.window.showQuickPick(
    listAiLoopExecutionModeChoices(),
    { placeHolder: 'Run the AI loop using which execution channel?' },
  );
  if (!mode) {
    return undefined;
  }
  if (mode.mode === 'chat') {
    const target = await pickChatProvider();
    return target ? { kind: 'chat', target } : undefined;
  }

  const target = await pickAgentCliTarget(workspaceCwd, 'prompt');
  return target ? { kind: 'cli', target } : undefined;
}

/**
 * Resolve a configured local CLI (or let the user choose among discovered
 * CLIs). Missing configured executables are reported before any card moves.
 */
async function pickAgentCliTarget(
  workspaceCwd: string,
  preference: 'prompt' | AgentCliProviderId,
): Promise<AgentCliTarget | undefined> {
  const configuredPaths = readAgentCliPaths();

  if (preference !== 'prompt') {
    const resolution = await resolveAgentCliTarget(
      preference,
      configuredPaths,
      { cwd: workspaceCwd },
    );
    if (!resolution.available) {
      void vscode.window.showWarningMessage(resolution.reason);
      return undefined;
    }
    return resolution.target;
  }

  const resolutions = await resolveAllAgentCliTargets(
    configuredPaths,
    { cwd: workspaceCwd },
  );
  const targets = resolutions.flatMap((resolution) =>
    resolution.available ? [resolution.target] : []);
  if (targets.length === 0) {
    const commands = AGENT_CLI_PROVIDER_IDS
      .map((provider) => `${AGENT_CLI_LABELS[provider]} (${provider})`)
      .join(', ');
    void vscode.window.showWarningMessage(
      `No supported local AI CLI was found for the MWNN loop. Install one of: ${commands}. You can also set a full executable path under mwnn-kanban.agentCliPaths.`,
    );
    return undefined;
  }
  if (targets.length === 1) {
    return targets[0];
  }

  const choice = await vscode.window.showQuickPick(
    targets.map((target) => ({
      label: target.label,
      description: target.provider,
      detail: target.executable,
      target,
    })),
    { placeHolder: 'Run the AI loop with which local CLI?' },
  );
  return choice?.target;
}

interface ChatProviderDiscovery {
  readonly targets: readonly ChatHandoffTarget[];
  readonly codexActivationFailure?: string;
}

async function discoverChatHandoffTargets(): Promise<ChatProviderDiscovery> {
  let availableCommands = await vscode.commands.getCommands(true);
  let codexActivationFailure: string | undefined;
  // Contributed commands can be absent until a closed provider has activated.
  // Activate Codex once at discovery time, then refresh the command list so the
  // first card hand-off can use its new-chat command immediately.
  if (!availableCommands.some((commandId) => commandId.startsWith('chatgpt.'))) {
    const codex = vscode.extensions.getExtension('openai.chatgpt');
    if (codex) {
      try {
        await codex.activate();
        availableCommands = await vscode.commands.getCommands(true);
      } catch (error: unknown) {
        codexActivationFailure = error instanceof Error ? error.message : String(error);
      }
    }
  }
  const targets = listAvailableChatProviders(availableCommands, readChatProviderCommands());
  return codexActivationFailure !== undefined ? { targets, codexActivationFailure } : { targets };
}

async function pickChatProvider(): Promise<ChatHandoffTarget | undefined> {
  const { targets, codexActivationFailure } = await discoverChatHandoffTargets();

  if (targets.length === 0) {
    if (codexActivationFailure) {
      void vscode.window.showWarningMessage(
        formatChatHandoffFailure(CHAT_PROVIDER_LABELS.codex, 'the card', codexActivationFailure),
      );
      return undefined;
    }
    void vscode.window.showInformationMessage(
      'No supported AI chat extension was found. Install GitHub Copilot, Codex (ChatGPT), or Claude Code to hand off cards.',
    );
    return undefined;
  }
  if (targets.length === 1) {
    return targets[0];
  }

  const choice = await vscode.window.showQuickPick(
    targets.map((target) => ({
      label: CHAT_PROVIDER_LABELS[target.provider],
      detail: describeChatHandoffTarget(target),
      target,
    })),
    { placeHolder: 'Hand this card off to which AI chat?' },
  );
  return choice?.target;
}

/**
 * Provider picker for the per-card Run with AI action: every installed chat
 * extension plus all four agent CLI providers. Unlike `pickChatProvider`, the
 * picker is always shown because the CLI entries are always offered; a CLI's
 * executable is resolved only after it is selected.
 */
async function pickRunWithAiProvider(
  placeHolder = 'Run this card with which AI provider?',
): Promise<RunWithAiProviderChoice | undefined> {
  const { targets } = await discoverChatHandoffTargets();
  const choices = listRunWithAiProviderChoices(targets);
  const pick = await vscode.window.showQuickPick(
    choices.map((choice) => ({
      label: choice.label,
      description: choice.description,
      detail: choice.detail,
      choice,
    })),
    { placeHolder },
  );
  return pick?.choice;
}

/**
 * Single-card agent-CLI runs currently in flight, so the Stop Card AI Run
 * command can terminate their child processes. Status-bar progress has no
 * cancel control, so stopping routes through the command instead.
 */
const activeCardCliRuns = new Set<AbortController>();

/**
 * Runs a synchronous agent CLI task behind status-bar progress — the same
 * unobtrusive surface as the AI loop; the Stop Card AI Run command aborts the
 * signal, which terminates the active CLI process.
 */
function runAgentCliWithStatusBarProgress<T>(
  title: string,
  task: (signal: AbortSignal, reportProgress: (message: string) => void) => Promise<T>,
): Promise<T> {
  return Promise.resolve(vscode.window.withProgress(
    createStatusBarProgressOptions(vscode.ProgressLocation, title),
    async (progress) => {
      const abortController = new AbortController();
      activeCardCliRuns.add(abortController);
      try {
        return await task(abortController.signal, (message) => progress.report({ message }));
      } finally {
        activeCardCliRuns.delete(abortController);
      }
    },
  ));
}

function stopCardCliRuns(): void {
  if (activeCardCliRuns.size === 0) {
    void vscode.window.showInformationMessage('No card AI run is in progress.');
    return;
  }
  for (const run of activeCardCliRuns) {
    run.abort();
  }
}

/**
 * Deliver a prompt to the chosen AI chat provider. `subject` names what is being
 * handed off (e.g. a quoted card title, or "the plan") for the user-facing
 * confirmation. Returns whether the prompt was delivered and can be recorded.
 */
async function handOffPromptToChat(
  target: ChatHandoffTarget,
  prompt: string,
  subject: string,
): Promise<boolean> {
  const providerLabel = CHAT_PROVIDER_LABELS[target.provider];
  try {
    if (target.promptDelivery === 'query') {
      // Copilot: the prompt rides in as a { query } argument.
      await vscode.commands.executeCommand(target.commandId, { query: prompt });
      void vscode.window.showInformationMessage(`Handed ${subject} to ${providerLabel}.`);
      return true;
    }

    if (target.promptDelivery === 'positional') {
      // Claude Code: the open command takes (sessionId, initialPrompt); pass no
      // session so a fresh conversation opens pre-filled with the prompt.
      await vscode.commands.executeCommand(target.commandId, undefined, prompt);
      void vscode.window.showInformationMessage(`Handed ${subject} to ${providerLabel}.`);
      return true;
    }

    if (shouldAutoPasteChatHandoff(target)) {
      const result = await deliverClipboardHandoff(target, prompt, {
        writeClipboard: (value) => vscode.env.clipboard.writeText(value),
        activateProvider: () => activateChatProvider(target),
        executeCommand: (commandId) => vscode.commands.executeCommand(commandId),
        wait: waitForMilliseconds,
      });
      if (!result.delivered) {
        void vscode.window.showWarningMessage(formatChatHandoffFailure(providerLabel, subject, result.error));
        return false;
      }
      void vscode.window.showInformationMessage(
        `Opened a new ${providerLabel} thread for ${subject}. The complete prompt was pasted automatically and is still on your clipboard.`,
      );
      return true;
    }
    void vscode.window.showInformationMessage(
      `Opened ${providerLabel} for ${subject}. The prompt is on your clipboard — paste it to start.`,
    );
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showWarningMessage(formatChatHandoffFailure(providerLabel, subject, message));
    return false;
  }
}

async function activateChatProvider(target: ChatHandoffTarget): Promise<void> {
  const extensionIdByProvider: Record<ChatHandoffTarget['provider'], string> = {
    copilot: 'github.copilot-chat',
    codex: 'openai.chatgpt',
    'claude-code': 'anthropic.claude-code',
  };
  const extension = vscode.extensions.getExtension(extensionIdByProvider[target.provider]);
  if (extension) {
    await extension.activate();
  }
}

function waitForMilliseconds(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function promptForLimit(
  label: string,
  currentValue: number | null,
): Promise<{ readonly cancelled: boolean; readonly value: number | null }> {
  const raw = await vscode.window.showInputBox({
    prompt: `${label} (leave blank for none)`,
    value: currentValue === null ? '' : String(currentValue),
    validateInput: (value) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return undefined;
      }

      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return 'Enter a non-negative whole number, or leave blank for none.';
      }
      return undefined;
    },
  });

  if (raw === undefined) {
    return { cancelled: true, value: currentValue };
  }

  const trimmed = raw.trim();
  return {
    cancelled: false,
    value: trimmed.length === 0 ? null : Number(trimmed),
  };
}
