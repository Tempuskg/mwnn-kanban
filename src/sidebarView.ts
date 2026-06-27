/**
 * The activity-bar sidebar view for MWNN Kanban. Showing this view (by clicking
 * the activity-bar icon) opens the full Kanban board panel in the editor area,
 * and the view itself offers a button to (re)open the board on demand.
 */

import * as vscode from 'vscode';

export class BoardSidebarViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'mwnn-kanban.sidebar';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly openBoard: () => void,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      if (isOpenBoardMessage(message)) {
        this.openBoard();
      }
    });

    // Revealing the view (e.g. clicking the activity-bar icon) opens the board.
    this.openBoard();
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.openBoard();
      }
    });
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style nonce="${nonce}">
    body { padding: 12px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
    p { margin: 0 0 12px; opacity: 0.85; font-size: 12px; line-height: 1.5; }
    button {
      width: 100%;
      padding: 6px 12px;
      border: none;
      border-radius: 2px;
      cursor: pointer;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font-family: inherit;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
  <title>MWNN Kanban</title>
</head>
<body>
  <p>The MWNN Kanban board opens in the editor area.</p>
  <button id="open" type="button">Open Board</button>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('open').addEventListener('click', () => {
      vscode.postMessage({ type: 'openBoard' });
    });
  </script>
</body>
</html>`;
  }
}

function isOpenBoardMessage(message: unknown): message is { type: 'openBoard' } {
  return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'openBoard';
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
