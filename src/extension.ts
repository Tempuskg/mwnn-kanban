import * as vscode from 'vscode';
import { createAiLoopProgressOptions, createStatusBarProgressOptions } from './aiLoopProgress';
import { createAiLoopPauseGate, type AiLoopPauseGate } from './aiLoopPause';
import type { AiLoopState } from './sidebarMessages';
import { isCardDefined } from './cardDefinition';
import {
  JEV_API_KEY_ENV,
  JevPendingDefinitions,
  formatRunSettingsActivityEntry,
  planDefinitionRunSettings,
  requestJevRunSettings,
  type DefinitionRunSettings,
} from './cardRunSettings';
import {
  createCliOutputFeed,
  formatCliRunExit,
  formatCliRunStart,
} from './agentCliFeedback';
import {
  agentCliModelSuggestions,
  readAgentCliModelCatalog,
  readAgentCliStageModels,
  readAgentCliStageThinkingLevels,
  readAgentCliThinkingLevelSuggestions,
  readAgentCliThinkingLevels,
  type AgentCliModelCatalog,
  type AgentCliStageModels,
  type AgentCliStageThinkingLevels,
  type AgentCliThinkingLevelDefaults,
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
import {
  BUNDLED_AGENT_CLI_MODELS,
  BUNDLED_AGENT_CLI_THINKING_LEVELS,
  describeAgentCliDiscovery,
  discoverAgentCliVocabularies,
  planAgentCliPopulate,
  type AgentCliPopulateMode,
} from './agentCliDiscovery';
import {
  addAgentCliSettingsEntry,
  agentCliSettingsEntries,
  agentCliSettingsEntryProblem,
  clearAgentCliSettingsProvider,
  makeAgentCliSettingsDefault,
  removeAgentCliSettingsEntry,
  summarizeAgentCliProvider,
  type AgentCliSettingsEdit,
  type AgentCliSettingsList,
} from './agentCliSettingsEditor';
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

/** Without a workspace no AI loop can run, so its state never changes. */
const noAiLoopStateChange: vscode.Event<void> = () => ({ dispose: () => undefined });

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

/**
 * Per-provider workspace default thinking levels. Validated in
 * `agentCliModels` for the same reason the model settings are: a malformed
 * setting degrades to "no default configured" instead of breaking a dispatch.
 */
function readAgentCliThinkingLevelDefaults(): AgentCliThinkingLevelDefaults {
  return readAgentCliThinkingLevels(
    vscode.workspace.getConfiguration('mwnn-kanban').get<unknown>('agentCliThinkingLevels', {}),
  );
}

/** Per-stage thinking-level rules, validated the same way. */
function readAgentCliStageThinkingLevelRules(): AgentCliStageThinkingLevels {
  return readAgentCliStageThinkingLevels(
    vscode.workspace
      .getConfiguration('mwnn-kanban')
      .get<unknown>('agentCliStageThinkingLevels', {}),
  );
}

/**
 * Settings the definition stage's run-settings recommendation reads. The
 * candidates are the same validated lists the card UI suggests, so Jev and the
 * defining agent can only pick names the workspace already lists.
 */
function readDefinitionRunSettingsConfig(): {
  readonly candidates: DefinitionRunSettings['candidates'];
  readonly overwriteExisting: boolean;
  readonly jevEnabled: boolean;
} {
  const config = vscode.workspace.getConfiguration('mwnn-kanban');
  return {
    candidates: {
      models: agentCliModelSuggestions(readAgentCliModels()),
      thinkingLevels: readAgentCliThinkingLevelSuggestions(config.get<unknown>('agentCliThinkingLevels', {})),
    },
    overwriteExisting: config.get<boolean>('defineOverwriteRunSettings', false),
    jevEnabled: config.get<boolean>('defineUseJev', true),
  };
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
  // Chat definitions waiting for their card to become defined before Jev picks
  // its run settings; drained by the store observer below (see cardRunSettings).
  const jevPendingDefinitions = new JevPendingDefinitions();
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
      // The file watcher's reloads land here, which makes this the completion
      // signal for fire-and-forget chat definitions. Each card fires once.
      for (const cardId of jevPendingDefinitions.takeReady(change.current)) {
        void applyJevRunSettingsAfterDefinition(cardId);
      }
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
    setCardBadges: (badges) => BoardPanel.setCardBadges(badges),
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
    thinkingLevels: readAgentCliThinkingLevelDefaults(),
    stageThinkingLevels: readAgentCliStageThinkingLevelRules(),
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

  /**
   * Decide, before the defining agent runs, who chooses the card's run
   * settings: Jev after the definition when it is enabled and configured,
   * otherwise the agent from the candidate lists. No network call.
   */
  const planDefinitionRunSettingsForCard = (): DefinitionRunSettings => {
    const { candidates, overwriteExisting, jevEnabled } = readDefinitionRunSettingsConfig();
    const apiKey = process.env[JEV_API_KEY_ENV];
    return {
      candidates,
      overwriteExisting,
      mode: planDefinitionRunSettings({ enabled: jevEnabled, ...(apiKey === undefined ? {} : { apiKey }) }),
    };
  };

  /**
   * Ask Jev how a freshly defined card should be run, judging the Description
   * and Acceptance criteria re-read from disk. The typed picks are written to
   * the card (never over an existing value unless the workspace opts in) and
   * the outcome is recorded in Activity, after the definition entries. A card
   * that is still undefined is skipped without calling Jev. Never throws: Jev
   * is an enhancement and a definition must not fail because of it.
   */
  const applyJevRunSettingsAfterDefinition = async (cardId: string): Promise<void> => {
    const { candidates, overwriteExisting, jevEnabled } = readDefinitionRunSettingsConfig();
    let card: BoardCard | undefined;
    try {
      card = findCardById(await store.reload(), cardId);
    } catch {
      return;
    }
    if (!card || !isCardDefined(card)) {
      return;
    }
    const apiKey = process.env[JEV_API_KEY_ENV];
    let recommendation = await requestJevRunSettings(card, candidates, {
      enabled: jevEnabled,
      overwriteExisting,
      ...(apiKey === undefined ? {} : { apiKey }),
    });
    try {
      if (recommendation.kind === 'jev') {
        for (const provider of AGENT_CLI_PROVIDER_IDS) {
          const model = recommendation.recommendation.models[provider];
          const level = recommendation.recommendation.thinkingLevels[provider];
          if (model !== undefined) {
            await store.setPreferredModel(cardId, provider, model);
          }
          if (level !== undefined) {
            await store.setThinkingLevel(cardId, provider, level);
          }
        }
      }
    } catch (error) {
      recommendation = {
        kind: 'fallback',
        reason: `Jev picks could not be saved (${error instanceof Error ? error.message : String(error)})`,
      };
    }
    try {
      await store.appendActivity(cardId, formatRunSettingsActivityEntry(recommendation));
      BoardPanel.postStateIfOpen();
    } catch {
      // The Activity note is best-effort; the definition already stands.
    }
  };

  /**
   * Hand a definition to chat. Chat hand-offs are fire-and-forget, so when Jev
   * owes the card run settings the card is registered with
   * `jevPendingDefinitions`; the board-store observer fires Jev once, the
   * first time a reload shows the card newly defined.
   */
  const handOffDefinitionToChat = async (
    card: BoardCard,
    runSettings: DefinitionRunSettings,
    handOff: () => Promise<boolean>,
  ): Promise<boolean> => {
    if (runSettings.mode.kind !== 'jev-after-definition') {
      return handOff();
    }
    // Registered before the hand-off so a fast agent cannot finish unseen.
    jevPendingDefinitions.add(card);
    let handedOff = false;
    try {
      handedOff = await handOff();
      return handedOff;
    } finally {
      if (!handedOff) {
        jevPendingDefinitions.delete(card.id);
      }
    }
  };

  /** A completed CLI definition gets its Jev run settings straight away. */
  const finishCliDefinition = async (
    cardId: string,
    runSettings: DefinitionRunSettings,
    completed: boolean,
  ): Promise<void> => {
    if (completed && runSettings.mode.kind === 'jev-after-definition') {
      await applyJevRunSettingsAfterDefinition(cardId);
    }
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

      const runSettings = planDefinitionRunSettingsForCard();
      const current = findCardById(store.getState(), card.id) ?? card;
      const cardFile = boardCapability.cardFilePath(card.id);

      if (choice.kind === 'cli') {
        const prompt = buildCardDefinitionPrompt(current, cardFile, runSettings);
        const completed = await runCardWithAgentCli(
          { provider: choice.provider, kind: 'definition', card, prompt },
          agentCliRunDeps(),
        );
        await finishCliDefinition(card.id, runSettings, completed);
        return completed;
      }

      // A person is watching the chat, so the agent may ask clarifying questions
      // before defining the card. CLI runs and the AI loop stay non-interactive.
      const prompt = buildCardDefinitionPrompt(current, cardFile, runSettings, { interactive: true });
      const handedOff = await handOffDefinitionToChat(current, runSettings, () => handOffPromptToChat(
        choice.target,
        withPreferredModelNote(prompt, cardPreferredModelFor(card, choice.target.provider)),
        `"${card.title}"`,
      ));
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
    // Materialize the board on disk first: an untouched workspace only has an
    // in-memory default board, and the agent we hand the prompt to needs a
    // real columns.json/cards dir with the same column ids we reference below.
    const state = await store.ensurePersisted();
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
  // The pause gate holds the run between actions without touching either.
  let activeLoop:
    | { cancelled: boolean; abortController: AbortController; pauseGate: AiLoopPauseGate }
    | undefined;
  // The host owns the loop state; the sidebar re-reads it on every change.
  const aiLoopStateEmitter = new vscode.EventEmitter<void>();
  context.subscriptions.push(aiLoopStateEmitter);
  const aiLoopState = (): AiLoopState =>
    !activeLoop ? 'idle' : activeLoop.pauseGate.isPaused() ? 'paused' : 'running';

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
    // Rebound to the live progress reporter once the loop's withProgress
    // starts; CLI handoffs stream their latest output line through it.
    let reportLoopProgress: (message: string) => void = () => {};
    const pauseGate = createAiLoopPauseGate(() => {
      reportLoopProgress(
        pauseGate.isPaused()
          ? 'Paused after the current card stage. Press Play to resume or Stop to end the run.'
          : 'Resuming',
      );
      aiLoopStateEmitter.fire();
    });
    const loop = { cancelled: false, abortController: new AbortController(), pauseGate };
    activeLoop = loop;
    aiLoopStateEmitter.fire();

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
        requestDefinition: (card) => {
          const runSettings = planDefinitionRunSettingsForCard();
          const current = findCardById(store.getState(), card.id) ?? card;
          return handOffDefinitionToChat(current, runSettings, () => runChatHandoff(
            'definition',
            current,
            (latest) => buildCardDefinitionPrompt(latest, cardFilePath(latest), runSettings),
            formatDefinitionHandoffEntry,
          ));
        },
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
        thinkingLevels: readAgentCliThinkingLevelDefaults(),
        stageThinkingLevels: readAgentCliStageThinkingLevelRules(),
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
        requestDefinition: async (card) => {
          const runSettings = planDefinitionRunSettingsForCard();
          const result = await runCliHandoff('definition', findCardById(store.getState(), card.id) ?? card, (current) =>
            buildCardDefinitionPrompt(current, cardFilePath(current), runSettings));
          await finishCliDefinition(card.id, runSettings, result.started);
          return result;
        },
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
            loop.pauseGate.release();
          });
          return runBoardLoop(
            store,
            gateways,
            {
              isCancelled: () => loop.cancelled,
              delay: waitForMilliseconds,
              waitWhilePaused: () => loop.pauseGate.waitWhilePaused(),
            },
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
      loop.pauseGate.release();
      activeLoop = undefined;
      aiLoopStateEmitter.fire();
    }
  };

  const stopBoardLoopCommand = (): void => {
    if (!activeLoop) {
      void vscode.window.showInformationMessage('The MWNN AI loop is not running.');
      return;
    }
    activeLoop.cancelled = true;
    activeLoop.abortController.abort();
    // Wakes a paused run so it sees the cancellation and ends.
    activeLoop.pauseGate.release();
  };

  // Lets the in-flight stage finish, then holds before the next action. The
  // active CLI process is never aborted and no card is moved.
  const pauseBoardLoopCommand = (): void => {
    if (!activeLoop) {
      void vscode.window.showInformationMessage('The MWNN AI loop is not running.');
      return;
    }
    if (!activeLoop.pauseGate.pause()) {
      void vscode.window.showInformationMessage('The MWNN AI loop is already paused.');
    }
  };

  // Resumes a paused run in place (same ledger, budget, and fallback state, no
  // target picker); otherwise starts a new run exactly like runBoardLoop.
  const playBoardLoopCommand = async (): Promise<void> => {
    if (activeLoop?.pauseGate.isPaused()) {
      activeLoop.pauseGate.resume();
      return;
    }
    await runBoardLoopCommand();
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
    // The webview renders from the state message, and some of that message's
    // fields come from settings rather than the store: the card UI's model and
    // thinking-level suggestions and whether Run with AI is offered. Re-push on
    // a change to any of them so an edited list reaches an already-open board
    // instead of waiting for a window reload or the next board edit.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('mwnn-kanban.agentCliModels') ||
        event.affectsConfiguration('mwnn-kanban.agentCliThinkingLevels') ||
        event.affectsConfiguration('mwnn-kanban.enableRunWithAI')
      ) {
        BoardPanel.postStateIfOpen();
      }
      if (event.affectsConfiguration('mwnn-kanban.enableRunWithAI')) {
        aiLoopStateEmitter.fire();
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
        {
          play: () => void playBoardLoopCommand(),
          pause: pauseBoardLoopCommand,
          stop: stopBoardLoopCommand,
          state: aiLoopState,
          runWithAiEnabled: readEnableRunWithAI,
          onDidChange: aiLoopStateEmitter.event,
        },
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
    vscode.commands.registerCommand('mwnn-kanban.pauseBoardLoop', () => {
      pauseBoardLoopCommand();
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
    vscode.commands.registerCommand('mwnn-kanban.populateAgentCliModels', async () => {
      await populateAgentCliModels();
    }),
    vscode.commands.registerCommand('mwnn-kanban.manageAgentCliModels', async () => {
      await manageAgentCliModels();
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
        {
          play: () => void showWorkspaceMessage(),
          pause: () => void showWorkspaceMessage(),
          stop: () => void showWorkspaceMessage(),
          // No board means no loop can ever run.
          state: () => 'idle',
          runWithAiEnabled: readEnableRunWithAI,
          onDidChange: noAiLoopStateChange,
        },
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
    vscode.commands.registerCommand('mwnn-kanban.pauseBoardLoop', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.stopBoardLoop', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.stopCardRun', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.importPlan', showWorkspaceMessage),
    // Settings are not board state, so this one works without a folder open
    // and simply offers only the user scope.
    vscode.commands.registerCommand('mwnn-kanban.populateAgentCliModels', async () => {
      await populateAgentCliModels();
    }),
    vscode.commands.registerCommand('mwnn-kanban.manageAgentCliModels', async () => {
      await manageAgentCliModels();
    }),
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

/**
 * Fill `agentCliModels` and `agentCliThinkingLevels` from what each installed
 * CLI reports (or the bundled lists), after the user has seen the result and
 * picked a scope and merge mode. Discovery, parsing, and merge rules live in
 * `agentCliDiscovery`; this only asks and writes. The configuration listener
 * re-pushes an open board's state after the write, so its pickers update.
 */
async function populateAgentCliModels(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const scopes: (vscode.QuickPickItem & { target: vscode.ConfigurationTarget })[] = [
    ...(workspaceFolder
      ? [{
          label: 'Workspace',
          description: 'Only this workspace',
          target: vscode.ConfigurationTarget.Workspace,
        }]
      : []),
    { label: 'User', description: 'Every workspace', target: vscode.ConfigurationTarget.Global },
  ];
  const scope = await vscode.window.showQuickPick(scopes, {
    title: 'Populate Agent CLI Models and Thinking Levels',
    placeHolder: 'Which settings should receive the discovered models and thinking levels?',
  });
  if (!scope) {
    return;
  }

  const cwd = workspaceFolder?.uri.fsPath ?? process.cwd();
  const discoveries = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'MWNN Kanban: asking each agent CLI for its models and thinking levels…',
    },
    () => discoverAgentCliVocabularies({ cwd, configuredPaths: readAgentCliPaths() }),
  );

  const config = vscode.workspace.getConfiguration('mwnn-kanban');
  const scopedValue = (key: string): unknown => {
    const inspected = config.inspect<unknown>(key);
    return scope.target === vscode.ConfigurationTarget.Workspace
      ? inspected?.workspaceValue
      : inspected?.globalValue;
  };
  const existingModels = scopedValue('agentCliModels');
  const existingLevels = scopedValue('agentCliThinkingLevels');
  const plans: Record<AgentCliPopulateMode, ReturnType<typeof planAgentCliPopulate>> = {
    merge: planAgentCliPopulate(existingModels, existingLevels, discoveries, 'merge'),
    replace: planAgentCliPopulate(existingModels, existingLevels, discoveries, 'replace'),
  };

  const detail = discoveries
    .map((discovery) =>
      describeAgentCliDiscovery(
        discovery,
        plans.merge.providers.find((plan) => plan.provider === discovery.provider),
      ),
    )
    .join('\n\n');
  const mergeLabel = 'Merge (keep my entries)';
  const replaceLabel = 'Replace';
  const choice = await vscode.window.showInformationMessage(
    `Write the discovered models and thinking levels to ${scope.label.toLowerCase()} settings?`,
    {
      modal: true,
      detail:
        `${detail}\n\nMerge keeps each list you already have, including its first entry (the default a run uses), ` +
        'and appends new names. Replace writes the discovered lists instead. For a CLI with nothing configured, ' +
        'the first discovered entry becomes its default. The defaults shown above are for Merge.',
    },
    mergeLabel,
    replaceLabel,
  );
  if (choice !== mergeLabel && choice !== replaceLabel) {
    return;
  }

  const plan = plans[choice === mergeLabel ? 'merge' : 'replace'];
  if (!plan.changed) {
    void vscode.window.showInformationMessage(
      'MWNN Kanban: agent CLI models and thinking levels are already up to date.',
    );
    return;
  }
  try {
    await config.update('agentCliModels', plan.models, scope.target);
    await config.update('agentCliThinkingLevels', plan.thinkingLevels, scope.target);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`MWNN Kanban: could not write the settings: ${message}`);
    return;
  }
  const fromCli = discoveries.filter(
    (discovery) => discovery.models.source === 'cli' || discovery.thinkingLevels.source === 'cli',
  ).length;
  void vscode.window.showInformationMessage(
    `MWNN Kanban: updated agent CLI models and thinking levels in ${scope.label.toLowerCase()} settings (${fromCli} of ${discoveries.length} CLIs listed their own).`,
  );
}

const MANAGE_AGENT_CLI_TITLE = 'Manage Agent CLI Models and Thinking Levels';

type ManageOverviewItem = vscode.QuickPickItem & {
  readonly action?: { readonly kind: 'provider'; readonly provider: AgentCliProviderId } | { readonly kind: 'settings' };
};

type ManageProviderItem = vscode.QuickPickItem & {
  readonly action?:
    | 'addModel'
    | 'defaultModel'
    | 'removeModel'
    | 'setLevel'
    | 'addLevel'
    | 'removeLevel'
    | 'clearLevel'
    | 'back';
};

/**
 * List and edit `agentCliModels` and `agentCliThinkingLevels` for one settings
 * scope with quick picks, so nobody has to hand-edit settings.json. The editing
 * rules live in `agentCliSettingsEditor`; this only asks and writes. Each edit
 * is written at once, and only to the chosen scope's own value (read through
 * `inspect()`), so a value from the other scope is never copied in. The
 * configuration listener re-pushes an open board's state after each write, so
 * its model and effort pickers update. Escape at any step writes nothing more.
 */
async function manageAgentCliModels(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const scopes: (vscode.QuickPickItem & { target: vscode.ConfigurationTarget })[] = [
    ...(workspaceFolder
      ? [{
          label: 'Workspace',
          description: 'Only this workspace',
          target: vscode.ConfigurationTarget.Workspace,
        }]
      : []),
    { label: 'User', description: 'Every workspace', target: vscode.ConfigurationTarget.Global },
  ];
  const scope = await vscode.window.showQuickPick(scopes, {
    title: MANAGE_AGENT_CLI_TITLE,
    placeHolder: 'Which settings do you want to list and edit?',
  });
  if (!scope) {
    return;
  }
  const scopeName = scope.label.toLowerCase();
  const settingKey = (list: AgentCliSettingsList): string =>
    list === 'models' ? 'agentCliModels' : 'agentCliThinkingLevels';
  const readScoped = (list: AgentCliSettingsList): unknown => {
    const inspected = vscode.workspace.getConfiguration('mwnn-kanban').inspect<unknown>(settingKey(list));
    return scope.target === vscode.ConfigurationTarget.Workspace
      ? inspected?.workspaceValue
      : inspected?.globalValue;
  };
  const apply = async (list: AgentCliSettingsList, edit: AgentCliSettingsEdit): Promise<void> => {
    if (!edit.ok) {
      void vscode.window.showWarningMessage(`MWNN Kanban: ${edit.reason}`);
      return;
    }
    try {
      await vscode.workspace
        .getConfiguration('mwnn-kanban')
        .update(settingKey(list), edit.value, scope.target);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`MWNN Kanban: could not write the settings: ${message}`);
      return;
    }
    vscode.window.setStatusBarMessage(`MWNN Kanban: updated ${scopeName} settings`, 3000);
  };

  for (;;) {
    const choice = await pickManageOverview(scopeName, readScoped);
    if (!choice) {
      return;
    }
    if (choice.kind === 'settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'mwnn-kanban.agentCli');
      return;
    }
    const keepGoing = await manageAgentCliProvider(choice.provider, scopeName, readScoped, apply);
    if (!keepGoing) {
      return;
    }
  }
}

/**
 * The overview: each provider's default model, other-model count, and level
 * from the chosen scope, then the effective stage overrides (read-only), then
 * an Open in Settings item. Picking a read-only entry just shows it again.
 */
async function pickManageOverview(
  scopeName: string,
  readScoped: (list: AgentCliSettingsList) => unknown,
): Promise<NonNullable<ManageOverviewItem['action']> | undefined> {
  for (;;) {
    const models = readScoped('models');
    const levels = readScoped('thinkingLevels');
    const effectiveModels = readAgentCliModels();
    const effectiveLevels = readAgentCliThinkingLevelDefaults();
    const items: ManageOverviewItem[] = [
      { label: `Agent CLIs (${scopeName} settings)`, kind: vscode.QuickPickItemKind.Separator },
      ...AGENT_CLI_PROVIDER_IDS.map((provider): ManageOverviewItem => {
        const summary = summarizeAgentCliProvider(models, levels, provider);
        const inherited = [
          summary.models.length === 0 && effectiveModels[provider]?.[0] !== undefined
            ? `model ${effectiveModels[provider]?.[0] ?? ''}`
            : undefined,
          summary.thinkingLevels.length === 0 && effectiveLevels[provider] !== undefined
            ? `thinking ${effectiveLevels[provider] ?? ''}`
            : undefined,
        ].filter((part): part is string => part !== undefined);
        return {
          label: AGENT_CLI_LABELS[provider],
          description: summary.description,
          detail:
            inherited.length > 0
              ? `${summary.detail} · Set in another scope: ${inherited.join(', ')}`
              : summary.detail,
          action: { kind: 'provider', provider },
        };
      }),
    ];

    const stageModels = readAgentCliStageModelRules();
    const stageLevels = readAgentCliStageThinkingLevelRules();
    const stages = [...new Set([...Object.keys(stageModels), ...Object.keys(stageLevels)])] as AgentCliHandoffKind[];
    if (stages.length > 0) {
      items.push({ label: 'Stage overrides (read-only)', kind: vscode.QuickPickItemKind.Separator });
      for (const stage of stages) {
        items.push({
          label: `$(lock) ${stage}`,
          description: [
            stageModels[stage] !== undefined ? `model: ${stageModels[stage] ?? ''}` : undefined,
            stageLevels[stage] !== undefined ? `thinking: ${stageLevels[stage] ?? ''}` : undefined,
          ]
            .filter((part): part is string => part !== undefined)
            .join(' · '),
          detail: 'From agentCliStageModels / agentCliStageThinkingLevels; edit these in Settings.',
        });
      }
    }
    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(gear) Open in Settings', action: { kind: 'settings' } },
    );

    const picked = await vscode.window.showQuickPick(items, {
      title: MANAGE_AGENT_CLI_TITLE,
      placeHolder: `Pick an agent CLI to edit its models and thinking level (${scopeName} settings)`,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) {
      return undefined;
    }
    if (picked.action) {
      return picked.action;
    }
  }
}

/**
 * One provider's edit menu. Returns false when the user pressed Escape (end
 * the command) and true for Back (return to the overview).
 */
async function manageAgentCliProvider(
  provider: AgentCliProviderId,
  scopeName: string,
  readScoped: (list: AgentCliSettingsList) => unknown,
  apply: (list: AgentCliSettingsList, edit: AgentCliSettingsEdit) => Promise<void>,
): Promise<boolean> {
  const label = AGENT_CLI_LABELS[provider];
  const title = `${MANAGE_AGENT_CLI_TITLE}: ${label}`;
  const levelNotApplied = provider === 'cursor' ? ' (not applied by this CLI)' : '';
  for (;;) {
    const modelsValue = readScoped('models');
    const levelsValue = readScoped('thinkingLevels');
    const models = agentCliSettingsEntries(modelsValue, provider);
    const levels = agentCliSettingsEntries(levelsValue, provider);
    const summary = summarizeAgentCliProvider(modelsValue, levelsValue, provider);
    const items: ManageProviderItem[] = [
      { label: 'Models', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(add) Add a model…', action: 'addModel' },
      ...(models.length > 1
        ? [{ label: '$(star) Make a model the default…', description: `now ${models[0] ?? ''}`, action: 'defaultModel' as const }]
        : []),
      ...(models.length > 0 ? [{ label: '$(trash) Remove a model…', action: 'removeModel' as const }] : []),
      { label: `Thinking level${levelNotApplied}`, kind: vscode.QuickPickItemKind.Separator },
      {
        label: '$(pulse) Set the thinking level used…',
        description: `now ${levels[0] ?? 'CLI default'}`,
        action: 'setLevel',
      },
      { label: '$(add) Add a suggested thinking level…', action: 'addLevel' },
      ...(levels.length > 0
        ? [
            { label: '$(trash) Remove a thinking level…', action: 'removeLevel' as const },
            { label: '$(clear-all) Clear the thinking level', description: 'use the CLI default', action: 'clearLevel' as const },
          ]
        : []),
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(arrow-left) Back to all agent CLIs', action: 'back' },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title,
      placeHolder: `${summary.description} (${scopeName} settings)`,
    });
    if (!picked?.action) {
      return false;
    }

    switch (picked.action) {
      case 'back':
        return true;
      case 'addModel': {
        const name = await pickOrEnterAgentCliName(title, 'model name', models, BUNDLED_AGENT_CLI_MODELS[provider], true);
        if (name !== undefined) {
          await apply('models', addAgentCliSettingsEntry(modelsValue, 'models', provider, name));
        }
        break;
      }
      case 'defaultModel': {
        const name = await pickAgentCliName(title, 'Which model should be the default?', models.slice(1));
        if (name !== undefined) {
          await apply('models', makeAgentCliSettingsDefault(modelsValue, 'models', provider, name));
        }
        break;
      }
      case 'removeModel': {
        const name = await pickAgentCliName(title, 'Which model should be removed?', models);
        if (name !== undefined) {
          await apply('models', removeAgentCliSettingsEntry(modelsValue, 'models', provider, name));
        }
        break;
      }
      case 'setLevel': {
        const candidates = [...new Set([...levels.slice(1), ...BUNDLED_AGENT_CLI_THINKING_LEVELS[provider]])].filter(
          (level) => level !== levels[0],
        );
        const name = await pickOrEnterAgentCliName(title, 'thinking level', levels, candidates, false);
        if (name !== undefined) {
          await apply('thinkingLevels', makeAgentCliSettingsDefault(levelsValue, 'thinkingLevels', provider, name));
        }
        break;
      }
      case 'addLevel': {
        const name = await pickOrEnterAgentCliName(
          title,
          'thinking level',
          levels,
          BUNDLED_AGENT_CLI_THINKING_LEVELS[provider],
          true,
        );
        if (name !== undefined) {
          await apply('thinkingLevels', addAgentCliSettingsEntry(levelsValue, 'thinkingLevels', provider, name));
        }
        break;
      }
      case 'removeLevel': {
        const name = await pickAgentCliName(title, 'Which thinking level should be removed?', levels);
        if (name !== undefined) {
          await apply('thinkingLevels', removeAgentCliSettingsEntry(levelsValue, 'thinkingLevels', provider, name));
        }
        break;
      }
      case 'clearLevel':
        await apply('thinkingLevels', clearAgentCliSettingsProvider(levelsValue, 'thinkingLevels', provider));
        break;
    }
  }
}

/** Pick one of `names`; undefined when cancelled. */
async function pickAgentCliName(
  title: string,
  placeHolder: string,
  names: readonly string[],
): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(
    names.map((name) => ({ label: name })),
    { title, placeHolder },
  );
  return picked?.label;
}

/**
 * Offer the bundled names not already listed, plus a free-form entry. With
 * `rejectExisting`, a name already in `existing` is refused, which is the
 * add rule; without it only blanks are refused, which is the "set the one
 * used" rule. Undefined when cancelled.
 */
async function pickOrEnterAgentCliName(
  title: string,
  noun: string,
  existing: readonly string[],
  suggestions: readonly string[],
  rejectExisting: boolean,
): Promise<string | undefined> {
  const enterLabel = `$(edit) Enter a ${noun}…`;
  const offered = rejectExisting ? suggestions.filter((name) => !existing.includes(name)) : suggestions;
  if (offered.length > 0) {
    const picked = await vscode.window.showQuickPick(
      [...offered.map((name) => ({ label: name })), { label: enterLabel }],
      { title, placeHolder: `Pick a ${noun}, or enter one as the CLI spells it` },
    );
    if (!picked) {
      return undefined;
    }
    if (picked.label !== enterLabel) {
      return picked.label;
    }
  }
  return vscode.window.showInputBox({
    title,
    prompt: `Enter a ${noun}, spelled exactly as the CLI accepts it.`,
    validateInput: (value) =>
      agentCliSettingsEntryProblem(rejectExisting ? existing : [], value, noun) ?? null,
  });
}
