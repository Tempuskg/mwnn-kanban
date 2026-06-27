import * as vscode from 'vscode';
import { BoardPanel } from './boardPanel';
import { createBoardStore } from './boardStore';

function readDefaultColumns(): string[] {
  const config = vscode.workspace.getConfiguration('mwnn-kanban');
  return config.get<string[]>('defaultColumns', ['To Do', 'In Progress', 'Done']);
}

function confirmDeletion(): boolean {
  return vscode.workspace.getConfiguration('mwnn-kanban').get<boolean>('confirmCardDeletion', true);
}

export function activate(context: vscode.ExtensionContext): void {
  const store = createBoardStore({
    memento: context.workspaceState,
    defaultColumns: readDefaultColumns(),
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
