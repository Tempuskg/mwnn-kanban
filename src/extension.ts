import * as vscode from 'vscode';
import { createAiLoopProgressOptions, createStatusBarProgressOptions } from './aiLoopProgress';
import {
  createCliOutputFeed,
  formatCliRunExit,
  formatCliRunStart,
} from './agentCliFeedback';
import {
  readAgentCliModelCatalog,
  readAgentCliStageModels,
  type AgentCliModelCatalog,
  type AgentCliStageModels,
} from './agentCliModels';
import {
  AGENT_CLI_LABELS,
  AGENT_CLI_PROVIDER_IDS,
  resolveAgentCliTarget,
  resolveAllAgentCliTargets,
  type AgentCliHandoffKind,
  type AgentCliPathOverrides,
  type AgentCliProcessObserver,
  type AgentCliProviderId,
  type AgentCliTarget,
} from './agentCliHandoff';
import {
  createAgentCliFallbackRunner,
  readAgentCliFallbackOrder,
  type AgentCliFallbackSettings,
} from './agentCliFallback';
import {
  readAgentCliEscalationLadders,
  type AgentCliEscalationSettings,
} from './agentCliEscalation';
import {
  createAiLoopBudget,
  formatAiLoopBudgetStopEntry,
  formatAiLoopBudgetStopMessage,
  formatAiLoopBudgetTally,
  readAiLoopMaxDispatches,
  type AiLoopRunOutcome,
} from './aiLoopBudget';
import {
  isAgentCliPreference,
  listAiLoopExecutionModeChoices,
  type AiLoopProviderPreference,
} from './aiLoopProvider';
import {
  buildCardDefinitionPrompt,
  buildCardHandoffPrompt,
  buildCardVerificationPrompt,
  buildPlanImportPrompt,
  findAiCardSelection,
  formatDefinitionHandoffEntry,
  formatHandoffEntry,
  listAiCardSelections,
  summarizeCardDescription,
  withPreferredModelNote,
  type PlanImportSource,
} from './aiCards';
import { cardPreferredModelFor } from './utils';
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
  activateProFeatures,
  createBoardCapability,
  createBoardChangeEvent,
  hasProLicense,
  initializeProLicenseCommands,
  isProLicenseActive,
  onDidChangeProLicense,
  showUpgradePrompt,
  type BoardChangeEvent,
} from './pro';
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
import { openProPortfolio } from './portfolioButton';
import { createBoardStore, readBoardStateIfPresent, type FileSystemLike } from './boardStore';
import {
  parseSkillDocument,
  planSkillInstallation,
  referencePathsForEnv,
  type AiEnvironment,
  type SkillSource,
} from './skills';
import type { BoardState } from './types';
import { createWorkspaceFileSystem } from './workspaceFileSystem';

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

function readAiLoopVerifyCards(): boolean {
  return vscode.workspace
    .getConfiguration('mwnn-kanban')
    .get<boolean>('aiLoopVerifyCards', false);
}

/**
 * The per-run dispatch cap, validated in `aiLoopBudget`. Undefined means no
 * cap, which is the default: a run that has never been capped must behave
 * exactly as it did before this setting existed.
 */
function readAiLoopMaxDispatchesSetting(): number | undefined {
  return readAiLoopMaxDispatches(
    vscode.workspace.getConfiguration('mwnn-kanban').get<unknown>('aiLoopMaxDispatches', 0),
  );
}

function readAiLoopCliFallback(): AgentCliFallbackSettings {
  const config = vscode.workspace.getConfiguration('mwnn-kanban');
  return {
    enabled: config.get<boolean>('aiLoopCliFallbackEnabled', false),
    providers: readAgentCliFallbackOrder(config.get<unknown>('aiLoopCliFallbackOrder', [])),
  };
}

/**
 * Model escalation policy for one loop run. Validated in `agentCliEscalation`,
 * so a malformed ladder degrades to "no escalation for that CLI" instead of
 * breaking a dispatch, and every consumer sees the same already-checked value.
 */
function readAiLoopModelEscalation(): AgentCliEscalationSettings {
  const config = vscode.workspace.getConfiguration('mwnn-kanban');
  return {
    enabled: config.get<boolean>('aiLoopModelEscalationEnabled', false),
    ladders: readAgentCliEscalationLadders(
      config.get<unknown>('aiLoopModelEscalationLadder', {}),
    ),
    overrideCardModel: config.get<boolean>('aiLoopModelEscalationOverridesCardModel', false),
  };
}

function readAgentCliPaths(): AgentCliPathOverrides {
  return vscode.workspace
    .getConfiguration('mwnn-kanban')
    .get<AgentCliPathOverrides>('agentCliPaths', {});
}

/**
 * Workspace model lists per agent CLI. Validated in `agentCliModels`, so a
 * malformed setting degrades to "no default configured" instead of breaking a
 * dispatch, and every consumer sees the same already-checked value.
 */
function readAgentCliModels(): AgentCliModelCatalog {
  return readAgentCliModelCatalog(
    vscode.workspace.getConfiguration('mwnn-kanban').get<unknown>('agentCliModels', {}),
  );
}

/**
 * Per-stage model rules. Validated in `agentCliModels` for the same reason as
 * the model lists: an unknown stage key or a blank value degrades to "no rule"
 * for that stage instead of breaking a dispatch.
 */
function readAgentCliStageModelRules(): AgentCliStageModels {
  return readAgentCliStageModels(
    vscode.workspace.getConfiguration('mwnn-kanban').get<unknown>('agentCliStageModels', {}),
  );
}

function getImplicitWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (workspaceFolder) {
      return workspaceFolder;
    }
  }

  return vscode.workspace.workspaceFolders?.[0];
}

/**
 * Run the Pro Portfolio command for the sidebar button. The command only exists
 * while the Pro package is loaded, so a missing registration surfaces as a
 * message instead of an unhandled rejection.
 */
function openPortfolioDashboard(): void {
  void openProPortfolio({
    executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
    showInformationMessage: (message) => vscode.window.showInformationMessage(message),
  });
}

/** The license signal backing `mwnn-kanban.hasProLicense`, read synchronously. */
function proLicenseStatus(): { readonly licensed: boolean } {
  return { licensed: isProLicenseActive() };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(...initializeProLicenseCommands(context, {
    registerCommand: (command, callback) =>
      vscode.commands.registerCommand(command, callback),
    executeCommand: (command, ...args) =>
      vscode.commands.executeCommand(command, ...args),
    getImplicitWorkspaceFolder,
    getConfiguration: (workspaceFolder) =>
      vscode.workspace.getConfiguration(
        'mwnn-kanban-pro',
        workspaceFolder?.uri,
      ),
    showInputBox: (options) => vscode.window.showInputBox(options),
    showInformationMessage: (message, ...items) =>
      vscode.window.showInformationMessage(message, ...items),
    showWarningMessage: (message, options, ...items) =>
      vscode.window.showWarningMessage(message, options, ...items),
    showErrorMessage: (message) => vscode.window.showErrorMessage(message),
    openExternal: (target) => vscode.env.openExternal(target),
    parseUri: (value) => vscode.Uri.parse(value),
  }));

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot) {
    registerUnavailableCommands(context);
    return;
  }

  const boardFolder = readBoardFolder();
  const boardChangeEmitter = new vscode.EventEmitter<BoardChangeEvent>();
  context.subscriptions.push(boardChangeEmitter);
  const workspaceFs = createWorkspaceFileSystem(workspaceRoot);
  const store = await createBoardStore({
    fileSystem: workspaceFs,
    boardFolder,
    defaultColumns: readDefaultColumns(),
    defaultReadyReverseWip: readDefaultReadyReverseWip(),
    legacyMemento: context.workspaceState,
    onDidChange: (change) => {
      boardChangeEmitter.fire(createBoardChangeEvent(
        change,
        workspaceRoot.fsPath,
        boardFolder,
      ));
    },
  });

  const boardCapability = createBoardCapability({
    store,
    workspaceRoot: workspaceRoot.fsPath,
    boardFolder,
    onDidChangeBoard: boardChangeEmitter.event,
    readBoardAt: (rootFsPath, targetBoardFolder) =>
      readBoardStateIfPresent({
        fileSystem: createWorkspaceFileSystem(vscode.Uri.file(rootFsPath)),
        boardFolder: targetBoardFolder,
      }),
    showBoard: () => {
      openBoard();
    },
    revealCard: (cardId) => BoardPanel.revealCard(cardId),
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
    modelCatalog: readAgentCliModels(),
    stageModels: readAgentCliStageModelRules(),
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

      const prompt = buildCardHandoffPrompt(
        selection.card,
        boardCapability.cardFilePath(selection.card.id),
      );

      if (choice.kind === 'cli') {
        // The CLI path selects the model with the provider's own argument, so
        // the prompt it receives is the unchanged one.
        return runCardWithAgentCli(
          { provider: choice.provider, kind: 'implementation', card: selection.card, prompt },
          agentCliRunDeps(),
        );
      }

      // Only the model this card names for the CLI behind the chosen chat
      // target: the prompt is delivered to one agent, so naming the other
      // providers' models would be noise it cannot act on.
      const handedOff = await handOffPromptToChat(
        choice.target,
        withPreferredModelNote(prompt, cardPreferredModelFor(selection.card, choice.target.provider)),
        `"${selection.card.title}"`,
      );
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

      const prompt = buildCardDefinitionPrompt(card, boardCapability.cardFilePath(card.id));

      if (choice.kind === 'cli') {
        return runCardWithAgentCli(
          { provider: choice.provider, kind: 'definition', card, prompt },
          agentCliRunDeps(),
        );
      }

      const handedOff = await handOffPromptToChat(
        choice.target,
        withPreferredModelNote(prompt, cardPreferredModelFor(card, choice.target.provider)),
        `"${card.title}"`,
      );
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

    const normalizedBoardFolder = boardFolder.replace(/\\/g, '/').replace(/\/+$/, '');
    const prompt = buildPlanImportPrompt(
      source,
      { columnId: targetColumn.id, columnTitle: targetColumn.title, existingCount: targetColumn.cards.length },
      normalizedBoardFolder,
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

    const cardFilePath = (card: BoardCard): string => boardCapability.cardFilePath(card.id);
    const loop = { cancelled: false, abortController: new AbortController() };
    activeLoop = loop;

    // One ledger per run: it counts every handoff this run launches and, when
    // the user configured a cap, refuses the one that would exceed it. Read
    // once per run like the CLI paths and fallback order, so changing the
    // setting mid-run cannot move the goalposts underneath a running loop.
    const maxDispatches = readAiLoopMaxDispatchesSetting();
    const budget = createAiLoopBudget(
      maxDispatches !== undefined ? { maxDispatches } : {},
    );
    // Set when the credit fallback pauses, so the closing report can tell a
    // spent allowance apart from a budget stop and from a plain cancellation.
    let cliPaused = false;

    /**
     * Stop the run because the cap refused a handoff. The refused dispatch was
     * never launched, so the in-flight card is untouched: it keeps its column
     * and its assignee, and only gains an Activity entry saying why the loop
     * stopped short of it. Cancelling the loop here is what guarantees no
     * further handoffs follow; the ledger's latched stop refuses them anyway.
     */
    const stopOnBudget = async (cardId: string): Promise<void> => {
      const stop = budget.stop();
      if (!stop) {
        return;
      }
      loop.cancelled = true;
      try {
        await store.appendActivity(cardId, formatAiLoopBudgetStopEntry(stop));
      } catch {
        // The card was deleted around the stop; the run still stops, and the
        // notification still explains why.
      }
      BoardPanel.postStateIfOpen();
    };

    // Rebound to the live progress reporter once the loop's withProgress
    // starts; CLI handoffs stream their latest output line through it.
    let reportLoopProgress: (message: string) => void = () => {};

    let gateways: LoopGateways;
    if (selectedTarget.kind === 'chat') {
      const chatTarget = selectedTarget.target;
      const providerLabel = CHAT_PROVIDER_LABELS[chatTarget.provider];
      /**
       * Chat handoffs are counted and capped like CLI ones, but they settle
       * with no model: the chat extension picks the model inside its own UI,
       * so there is nothing the extension observed and nothing it may invent.
       * The reservation is taken before the handoff rather than after, because
       * only a pre-launch check can keep the cap from being overshot.
       */
      const reserveChatDispatch = async (
        kind: AgentCliHandoffKind,
        card: BoardCard,
      ): Promise<boolean> => {
        const reservation = budget.reserve({
          stage: kind,
          provider: `chat:${chatTarget.provider}`,
          providerLabel,
          cardId: card.id,
          cardTitle: card.title,
        });
        if (!reservation.allowed) {
          await stopOnBudget(card.id);
          return false;
        }
        budget.settle();
        return true;
      };
      /**
       * Every chat stage has the same shape - claim a dispatch, build the
       * prompt, hand it to chat, record the handoff - so they share one body
       * and differ only in the stage, the prompt, and the Activity entry. That
       * also means the budget is applied identically to all four.
       */
      const runChatHandoff = async (
        kind: AgentCliHandoffKind,
        card: BoardCard,
        buildPrompt: (current: BoardCard) => string,
        formatEntry: (label: string) => string,
      ): Promise<boolean> => {
        if (!(await reserveChatDispatch(kind, card))) {
          return false;
        }
        return runCardHandoff(card.id, async () => {
          const handedOff = await handOffPromptToChat(
            chatTarget,
            withPreferredModelNote(buildPrompt(card), cardPreferredModelFor(card, chatTarget.provider)),
            `"${card.title}"`,
          );
          if (handedOff) {
            await store.appendActivity(card.id, formatEntry(providerLabel));
            BoardPanel.postStateIfOpen();
          }
          return handedOff;
        });
      };

      gateways = {
        dispatchCard: (card) =>
          runChatHandoff(
            'implementation',
            card,
            (current) => buildCardHandoffPrompt(current, cardFilePath(current)),
            formatHandoffEntry,
          ),
        requestDefinition: (card) =>
          runChatHandoff(
            'definition',
            card,
            (current) => buildCardDefinitionPrompt(current, cardFilePath(current)),
            formatDefinitionHandoffEntry,
          ),
        decideDoability: decideCardDoability,
        requestTriage: (card) =>
          runChatHandoff(
            'triage',
            card,
            (current) => buildTriagePrompt(current, cardFilePath(current)),
            formatTriageHandoffEntry,
          ),
        verifyCard: (card) =>
          runChatHandoff(
            'verification',
            card,
            (current) => buildCardVerificationPrompt(current, cardFilePath(current)),
            formatVerificationHandoffEntry,
          ),
      };
    } else {
      const cliTarget = selectedTarget.target;
      // One fallback runner per loop run: it owns the active CLI, the
      // providers whose allowance is already spent, and the single-handoff
      // guard. The user's saved provider preference is never written to.
      const fallbackRunner = createAgentCliFallbackRunner({
        initialTarget: cliTarget,
        settings: readAiLoopCliFallback(),
        configuredPaths: readAgentCliPaths(),
        // Read once per loop run, like the CLI paths and fallback order.
        modelCatalog: readAgentCliModels(),
        stageModels: readAgentCliStageModelRules(),
        escalation: readAiLoopModelEscalation(),
        cwd: workspaceRoot.fsPath,
        store,
        signal: loop.abortController.signal,
        isCancelled: () => loop.cancelled,
        onProgress: (message) => {
          reportLoopProgress(message);
          cliOutputChannel.info(message);
        },
        onSwitch: (record) => {
          void vscode.window.showInformationMessage(
            `${record.from.label} ran out of credits during the ${record.kind} stage. Continuing the same card with ${record.to.label}.`,
          );
        },
        onEscalate: (record) => {
          void vscode.window.showInformationMessage(
            `${record.target.label} did not complete the ${record.kind} stage on ${record.from ? `model "${record.from}"` : 'its default model'}. Retrying the same card on "${record.to}".`,
          );
        },
        onPause: (reason) => {
          // No eligible CLI is left: stop dispatching instead of cycling
          // providers, leaving the interrupted card where it is.
          loop.cancelled = true;
          cliPaused = true;
          showCliWarning(reason);
        },
        // Consulted before every process, including credit-fallback
        // replacements and escalation retries, so the cap bounds the run's
        // real dispatch count rather than only its stage count.
        beforeDispatch: ({ kind, target, card }) => {
          const reservation = budget.reserve({
            stage: kind,
            provider: target.provider,
            providerLabel: target.label,
            cardId: card.id,
            cardTitle: card.title,
          });
          return reservation.allowed
            ? { allowed: true }
            : { allowed: false, reason: formatAiLoopBudgetStopMessage(reservation.stop) };
        },
        // The model a dispatch actually ran on, which is what the tally groups
        // by; a rejected or unconfigured model settles as the CLI's own default.
        afterDispatch: (settlement) => budget.settle(settlement.model),
        createObserver: (target, request) => {
          const observer = createCliRunObserver(
            request.card,
            request.kind,
            target.label,
            (message) => reportLoopProgress(message),
          );
          return {
            ...observer,
            onExit: (result) => {
              // The only source of usage or cost figures is what this CLI
              // printed itself; the ledger copies matching lines verbatim and
              // attributes them to this provider, and invents nothing when the
              // CLI reports nothing.
              budget.recordUsage(target.label, `${result.stdout}\n${result.stderr}`);
              observer.onExit?.(result);
            },
          };
        },
      });

      const runCliHandoff = async (
        kind: AgentCliHandoffKind,
        card: BoardCard,
        buildPrompt: (current: BoardCard) => string,
      ): Promise<{ readonly started: boolean; readonly activityBaseline?: number }> => {
        const attempt = await inFlightCardHandoffs.run(card.id, () =>
          fallbackRunner.run({ kind, card, buildPrompt }));
        if (!attempt.started) {
          void vscode.window.showInformationMessage(
            'A handoff for this card is already in progress. Stop it or wait for it to finish.',
          );
          return { started: false };
        }

        BoardPanel.postStateIfOpen();
        const outcome = attempt.value;
        if (outcome.kind === 'busy') {
          void vscode.window.showInformationMessage(
            'A CLI handoff is already running for this loop. Stop it or wait for it to finish.',
          );
          return { started: false };
        }
        if (outcome.kind === 'paused') {
          return { started: false };
        }
        if (outcome.kind === 'stopped') {
          // The dispatch budget refused this handoff before anything was
          // spawned, so the card is untouched and the run ends here.
          await stopOnBudget(card.id);
          return { started: false };
        }

        const result = outcome.result;
        // A card model the CLI that actually ran cannot accept is a silent
        // downgrade otherwise: the stage still runs, just on the default model.
        if (result.modelSelection && !result.modelSelection.applied && result.modelSelection.reason) {
          showCliWarning(result.modelSelection.reason);
        }
        if (!result.completed && !result.cancelled && result.reason && !outcome.exhaustedWithoutFallback) {
          showCliWarning(result.reason);
        }
        return {
          started: result.completed,
          activityBaseline: result.activityBaseline,
        };
      };

      gateways = {
        dispatchCard: (card) =>
          runCliHandoff('implementation', card, (current) =>
            buildCardHandoffPrompt(current, cardFilePath(current))),
        requestDefinition: (card) =>
          runCliHandoff('definition', card, (current) =>
            buildCardDefinitionPrompt(current, cardFilePath(current))),
        decideDoability: decideCardDoability,
        requestTriage: (card) =>
          runCliHandoff('triage', card, (current) =>
            buildTriagePrompt(current, cardFilePath(current))),
        verifyCard: (card) =>
          runCliHandoff('verification', card, (current) =>
            buildCardVerificationPrompt(current, cardFilePath(current))),
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
              verifyWithAi: readAiLoopVerifyCards(),
            },
          );
        },
      );
      BoardPanel.postStateIfOpen();
      // The tally is reported however the run ended - finished, cancelled,
      // paused on spent credits, or stopped on budget - and each of those
      // says which it was, so a budget stop is never mistaken for a CLI that
      // ran out of allowance or for a loop that simply had nothing left to do.
      const budgetStop = budget.stop();
      const outcome: AiLoopRunOutcome = budgetStop
        ? 'budget'
        : cliPaused
          ? 'paused'
          : summary.cancelled
            ? 'cancelled'
            : 'finished';
      const headline = budgetStop
        ? formatAiLoopBudgetStopMessage(budgetStop)
        : summarizeLoopRun(summary);
      void vscode.window.showInformationMessage(
        `${headline} ${formatAiLoopBudgetTally(budget.tally(), outcome)}`,
      );
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

  context.subscriptions.push(registerBoardWatcher(workspaceRoot, boardFolder, store));
  context.subscriptions.push(
    // The webview renders from the state message, and two of that message's
    // fields come from settings rather than the store: the card UI's model
    // suggestions and whether Run with AI is offered. Re-push on a change to
    // either so an edited model list reaches an already-open board instead of
    // waiting for a window reload or the next board edit.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('mwnn-kanban.agentCliModels') ||
        event.affectsConfiguration('mwnn-kanban.enableRunWithAI')
      ) {
        BoardPanel.postStateIfOpen();
      }
    }),
  );
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
        openPortfolioDashboard,
        () => BoardPanel.status(),
        proLicenseStatus,
        BoardPanel.onDidChangeState,
        onDidChangeProLicense,
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

  void activateProFeatures({
    extensionContext: context,
    hasProLicense,
    showUpgradePrompt,
    log: (message) => cliOutputChannel.appendLine(`[pro] ${message}`),
    registerDisposable: (disposable) => context.subscriptions.push(disposable),
    capabilities: { board: boardCapability },
  });
}

export function deactivate(): void {
  // Nothing to clean up; the panel disposes itself.
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
        // The Portfolio dashboard is workspace-independent, so it stays wired
        // even without a folder open; license gating still decides visibility.
        openPortfolioDashboard,
        // No workspace means no board can open; the button stays in its default
        // "Open Board" state and never changes.
        () => ({ open: false, focused: false }),
        proLicenseStatus,
        BoardPanel.onDidChangeState,
        onDidChangeProLicense,
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
    parts.push(`handed ${summary.parked.length} back for human verification`);
  }
  if (summary.verified.length > 0) {
    parts.push(`verified ${summary.verified.length} into Done`);
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

function formatVerificationHandoffEntry(
  providerLabel: string,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - Verification requested from ${providerLabel}`,
    `Asked ${providerLabel} to verify every acceptance criterion and record the verdict.`,
  ].join('\n');
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
