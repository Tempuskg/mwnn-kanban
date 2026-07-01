import * as vscode from 'vscode';
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
  listAvailableChatProviders,
  type ChatHandoffTarget,
  type ChatProviderCommands,
  type ChatProviderId,
} from './chatHandoff';
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

    const target = await pickChatProvider();
    if (!target) {
      return;
    }

    const boardFolder = readBoardFolder().replace(/\\/g, '/').replace(/\/+$/, '');
    const cardFilePath = `${boardFolder}/cards/${selection.card.id}.md`;
    const prompt = buildCardHandoffPrompt(selection.card, cardFilePath);
    const handedOff = await handOffPromptToChat(target, prompt, `"${selection.card.title}"`);
    if (!handedOff) {
      return;
    }

    // Record the dispatch ourselves: the hand-off is fire-and-forget, so we
    // cannot rely on the external agent to leave any trace in the activity log.
    await store.appendActivity(selection.card.id, formatHandoffEntry(CHAT_PROVIDER_LABELS[target.provider]));
    BoardPanel.postStateIfOpen();
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

    const target = await pickChatProvider();
    if (!target) {
      return;
    }

    const boardFolder = readBoardFolder().replace(/\\/g, '/').replace(/\/+$/, '');
    const cardFilePath = `${boardFolder}/cards/${card.id}.md`;
    const prompt = buildCardDefinitionPrompt(card, cardFilePath);
    const handedOff = await handOffPromptToChat(target, prompt, `"${card.title}"`);
    if (!handedOff) {
      return;
    }

    await store.appendActivity(card.id, formatDefinitionHandoffEntry(CHAT_PROVIDER_LABELS[target.provider]));
    BoardPanel.postStateIfOpen();
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
    if (source.kind === 'text' && source.text.trim().length === 0) {
      void vscode.window.showInformationMessage('The clipboard is empty. Copy a plan first, then import it.');
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
      new BoardSidebarViewProvider(context.extensionUri, openBoard, () => void importPlan()),
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
 * Install the bundled skills into every AI tool the workspace uses, plus the
 * `providerEnv` we are about to hand off to. Falls back to Copilot when the
 * workspace has no detectable AI tool. Skips files whose content is unchanged so
 * re-imports don't churn. Returns the paths written this run.
 */
async function ensureSkillsInstalled(
  extensionUri: vscode.Uri,
  fs: FileSystemLike,
  providerEnv: AiEnvironment,
): Promise<string[]> {
  const skills = await loadBundledSkills(extensionUri);

  const environments = await detectAiEnvironments(fs);
  environments.add(providerEnv);
  if (environments.size === 0) {
    environments.add('copilot');
  }

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
      ),
    ),
    vscode.commands.registerCommand('mwnn-kanban.openBoard', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.addColumn', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.renameColumn', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.deleteColumn', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.setColumnLimits', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.runCardWithAI', showWorkspaceMessage),
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
 * Choose the plan to import. The user either pastes from the clipboard (which
 * preserves a multi-line plan) or picks a markdown file from the workspace. For
 * a file we return its workspace-relative path so the agent reads the full
 * document itself; for the clipboard we return the text. Returns `undefined`
 * when the user cancels or no source is available.
 */
async function collectPlanSource(): Promise<PlanImportSource | undefined> {
  const fromClipboard = 'Paste from clipboard';
  const fromFile = 'Select a markdown file from the workspace';

  const source = await vscode.window.showQuickPick(
    [
      { label: fromClipboard, detail: 'Import the plan text currently on your clipboard' },
      { label: fromFile, detail: 'Pick a .md file in this workspace to import' },
    ],
    { placeHolder: 'Import plan from…' },
  );
  if (!source) {
    return undefined;
  }

  if (source.label === fromClipboard) {
    return { kind: 'text', text: await vscode.env.clipboard.readText() };
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

async function pickChatProvider(): Promise<ChatHandoffTarget | undefined> {
  const availableCommands = await vscode.commands.getCommands(true);
  const targets = listAvailableChatProviders(availableCommands, readChatProviderCommands());

  if (targets.length === 0) {
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
      detail: target.promptDelivery === 'clipboard'
        ? 'Opens the chat window with the card prompt on the clipboard to paste'
        : 'Sends the card prompt straight to the chat input',
      target,
    })),
    { placeHolder: 'Hand this card off to which AI chat?' },
  );
  return choice?.target;
}

/**
 * Deliver a prompt to the chosen AI chat provider. `subject` names what is being
 * handed off (e.g. a quoted card title, or "the plan") for the user-facing
 * confirmation. Returns whether the hand-off command ran.
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

    await vscode.env.clipboard.writeText(prompt);
    await vscode.commands.executeCommand(target.commandId);
    void vscode.window.showInformationMessage(
      `Opened ${providerLabel} for ${subject}. The prompt is on your clipboard — paste it to start.`,
    );
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showWarningMessage(`Could not hand off to ${providerLabel}: ${message}`);
    return false;
  }
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

