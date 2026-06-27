import * as vscode from 'vscode';
import { BoardPanel } from './boardPanel';
import { createBoardStore, type FileSystemLike } from './boardStore';
import type { BoardState } from './types';

type BoardStore = Awaited<ReturnType<typeof createBoardStore>>;
type BoardColumn = BoardState['columns'][number];
type BoardCard = BoardColumn['cards'][number];

function readDefaultColumns(): string[] {
  const config = vscode.workspace.getConfiguration('mwnn-kanban');
  return config.get<string[]>('defaultColumns', ['Backlog', 'Ready', 'In Progress', 'Done']);
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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot) {
    registerUnavailableCommands(context);
    return;
  }

  const store = await createBoardStore({
    fileSystem: createWorkspaceFileSystem(workspaceRoot),
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

    const model = await pickLanguageModel(context);
    if (!model) {
      return;
    }

    let responseText: string;
    try {
      responseText = await runCardWithAI(model, selection.card);
    } catch (error: unknown) {
      void vscode.window.showWarningMessage(describeLanguageModelError(error));
      return;
    }

    if (responseText.trim().length === 0) {
      void vscode.window.showInformationMessage(`"${selection.card.title}" returned no AI output to append.`);
      return;
    }

    await store.appendActivity(selection.card.id, formatActivityEntry(model, responseText));

    const moveLabel = selection.nextColumn ? `Move to ${selection.nextColumn.title}` : undefined;
    const choice = await vscode.window.showInformationMessage(
      `Added AI output to "${selection.card.title}".`,
      ...(moveLabel ? [moveLabel] : []),
    );
    if (moveLabel && choice === moveLabel && selection.nextColumn) {
      await store.moveCard(selection.card.id, selection.nextColumn.id, selection.nextColumn.cards.length);
    }

    openBoard().postState();
  };

  const openBoard = (): BoardPanel =>
    BoardPanel.show({ store, extensionUri: context.extensionUri, confirmDeletion, runCardWithAI: runCardWithAISelection });

  context.subscriptions.push(registerBoardWatcher(workspaceRoot, readBoardFolder(), store));
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

function registerUnavailableCommands(context: vscode.ExtensionContext): void {
  const showWorkspaceMessage = (): Thenable<string | undefined> =>
    vscode.window.showInformationMessage('Open a workspace folder to use MWNN Kanban.');

  context.subscriptions.push(
    vscode.commands.registerCommand('mwnn-kanban.openBoard', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.addColumn', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.renameColumn', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.deleteColumn', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.setColumnLimits', showWorkspaceMessage),
    vscode.commands.registerCommand('mwnn-kanban.runCardWithAI', showWorkspaceMessage),
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
  const items = state.columns.flatMap((column, columnIndex) =>
    column.cards
      .filter((card) => card.assignee?.kind === 'ai')
      .map((card) => ({
        label: card.title,
        description: `${column.title} • ${(card.assignee?.name ?? 'AI').trim()}`,
        detail: summarizeCardDescription(card.description),
        card,
        nextColumn: state.columns[columnIndex + 1],
      })),
  );

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

function findAiCardSelection(
  state: BoardState,
  cardId: string,
): { readonly card: BoardCard; readonly nextColumn?: BoardColumn } | undefined {
  for (let columnIndex = 0; columnIndex < state.columns.length; columnIndex += 1) {
    const column = state.columns[columnIndex];
    if (!column) {
      continue;
    }

    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (!card || card.assignee?.kind !== 'ai') {
      continue;
    }

    const nextColumn = state.columns[columnIndex + 1];
    return nextColumn ? { card, nextColumn } : { card };
  }

  return undefined;
}

async function pickLanguageModel(
  context: vscode.ExtensionContext,
): Promise<vscode.LanguageModelChat | undefined> {
  if (vscode.lm === undefined) {
    void vscode.window.showInformationMessage('This VS Code build does not expose language model APIs.');
    return undefined;
  }

  let models: readonly vscode.LanguageModelChat[];
  try {
    models = await vscode.lm.selectChatModels();
  } catch (error: unknown) {
    void vscode.window.showWarningMessage(describeLanguageModelError(error));
    return undefined;
  }

  const availableModels = models.filter((model) => context.languageModelAccessInformation.canSendRequest(model) !== false);
  if (availableModels.length === 0) {
    void vscode.window.showInformationMessage('No accessible chat models are currently available for MWNN Kanban.');
    return undefined;
  }
  if (availableModels.length === 1) {
    return availableModels[0];
  }

  const choice = await vscode.window.showQuickPick(
    availableModels.map((model) => ({
      label: model.name,
      description: `${model.vendor} • ${model.family}`,
      detail: `Version ${model.version}`,
      model,
    })),
    { placeHolder: 'Choose an AI model for this card' },
  );
  return choice?.model;
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

async function runCardWithAI(model: vscode.LanguageModelChat, card: BoardCard): Promise<string> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Running "${card.title}" with ${model.name}`,
      cancellable: false,
    },
    async () => {
      const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User(buildCardPrompt(card))],
        {
          justification: 'Run an MWNN Kanban card with AI and append the response to the card activity log.',
        },
      );

      let output = '';
      for await (const chunk of response.text) {
        output += chunk;
      }
      return output.trim();
    },
  );
}

function buildCardPrompt(card: BoardCard): string {
  return [
    'You are assisting with a Methodology With No Name Kanban card inside VS Code.',
    'Respond with concise markdown that can be appended directly to the card Activity section.',
    'Include the next actions, any notable risks or blockers, and a brief completion note if the slice appears done.',
    '',
    `Title: ${card.title}`,
    '',
    'Description:',
    card.description?.trim() || 'No description provided.',
    '',
    'Acceptance criteria:',
    card.acceptanceCriteria?.trim() || 'No acceptance criteria provided.',
  ].join('\n');
}

function formatActivityEntry(model: vscode.LanguageModelChat, responseText: string): string {
  return [
    `### ${new Date().toISOString()} - Run with AI (${model.name})`,
    `Model: ${model.vendor}/${model.family}`,
    '',
    responseText.trim(),
  ].join('\n');
}

function summarizeCardDescription(description: string | undefined): string {
  if (!description) {
    return 'No description yet';
  }

  const singleLine = description.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= 80) {
    return singleLine;
  }
  return `${singleLine.slice(0, 77)}...`;
}

function describeLanguageModelError(error: unknown): string {
  if (error instanceof vscode.LanguageModelError) {
    switch (error.code) {
      case 'NoPermissions':
        return 'MWNN Kanban does not have permission to use the selected language model yet.';
      case 'Blocked':
        return 'The selected language model is temporarily unavailable or quota-limited.';
      case 'NotFound':
        return 'The selected language model is no longer available.';
      default:
        return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'The language model request could not be completed.';
}
