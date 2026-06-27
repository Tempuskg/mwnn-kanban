/**
 * The Kanban board webview panel. Owns the webview lifecycle and the bridge
 * between the board store (extension host) and the board UI (media/board.js).
 */

import * as vscode from 'vscode';
import type { BoardStore } from './boardStore';
import { isWebviewToHostMessage, type HostToWebviewMessage, type WebviewToHostMessage } from './types';

const VIEW_TYPE = 'mwnn-kanban.board';

export interface BoardPanelDeps {
  readonly store: BoardStore;
  readonly extensionUri: vscode.Uri;
  readonly confirmDeletion: () => boolean;
}

export class BoardPanel {
  private static current: BoardPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly deps: BoardPanelDeps,
  ) {
    this.panel.webview.html = this.renderHtml(this.panel.webview);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        if (!isWebviewToHostMessage(message)) {
          return;
        }

        void this.handleMessage(message);
      },
      null,
      this.disposables,
    );
  }

  static show(deps: BoardPanelDeps): BoardPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (BoardPanel.current) {
      BoardPanel.current.panel.reveal(column);
      return BoardPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'MWNN Kanban', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'media')],
    });
    BoardPanel.current = new BoardPanel(panel, deps);
    return BoardPanel.current;
  }

  /** Push the current store state into the webview. */
  postState(): void {
    const message: HostToWebviewMessage = { type: 'state', board: this.deps.store.getState() };
    void this.panel.webview.postMessage(message);
  }

  private async handleMessage(message: WebviewToHostMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.postState();
        return;
      case 'addCard':
        await this.deps.store.addCard(message.columnId, message.title);
        break;
      case 'editCard':
        await this.deps.store.editCard(message.cardId, message.title);
        break;
      case 'deleteCard': {
        if (this.deps.confirmDeletion()) {
          const choice = await vscode.window.showWarningMessage('Delete this card?', { modal: true }, 'Delete');
          if (choice !== 'Delete') {
            return;
          }
        }
        await this.deps.store.deleteCard(message.cardId);
        break;
      }
      case 'moveCard':
        await this.deps.store.moveCard(message.cardId, message.toColumnId, message.toIndex);
        break;
    }
    this.postState();
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.deps.extensionUri, 'media', 'board.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.deps.extensionUri, 'media', 'board.css'),
    );
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>MWNN Kanban</title>
</head>
<body>
  <div id="board"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    BoardPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
