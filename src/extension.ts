import * as vscode from 'vscode';
import { BoardPanel } from './boardPanel';
import { createBoardStore, type FileSystemLike } from './boardStore';

function readDefaultColumns(): string[] {
  const config = vscode.workspace.getConfiguration('mwnn-kanban');
  return config.get<string[]>('defaultColumns', ['To Do', 'In Progress', 'Done']);
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

  const openBoard = (): BoardPanel =>
    BoardPanel.show({ store, extensionUri: context.extensionUri, confirmDeletion });

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
    vscode.commands.registerCommand('mwnn-kanban.resetBoard', showWorkspaceMessage),
  );
}
