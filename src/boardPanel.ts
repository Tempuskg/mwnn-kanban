/**
 * The Kanban board webview panel. Owns the webview lifecycle and the bridge
 * between the board store (extension host) and the board UI (media/board.js).
 */

import * as vscode from 'vscode';
import type { BoardStore } from './boardStore';
import { cardNeedsDefinition } from './cardDefinition';
import { canMoveCardToColumn } from './utils';
import { isWebviewToHostMessage, type HostToWebviewMessage, type WebviewToHostMessage } from './types';

const VIEW_TYPE = 'mwnn-kanban.board';

export interface BoardPanelDeps {
  readonly store: BoardStore;
  readonly extensionUri: vscode.Uri;
  readonly confirmDeletion: () => boolean;
  readonly runCardWithAI: (cardId?: string) => Promise<void>;
  readonly fillCardDefinition: (cardId: string) => Promise<void>;
}

export class BoardPanel {
  /** The webview panel view type, used for creation and serializer registration. */
  static readonly viewType = VIEW_TYPE;

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

  /**
   * Adopt a panel VS Code recreated when restoring a previous session (via the
   * registered WebviewPanelSerializer). Routes through the same singleton path
   * as {@link show} so a restored panel is indistinguishable from a freshly
   * opened one: live store state, file-watcher updates, and every message
   * handler all work the same. VS Code restores the panel to its prior editor
   * column on its own.
   */
  static restore(panel: vscode.WebviewPanel, deps: BoardPanelDeps): BoardPanel {
    // VS Code does not persist webview options across a reload/restart, so
    // re-apply the ones the board needs before wiring the panel up.
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(deps.extensionUri, 'media')],
    };

    if (BoardPanel.current) {
      // A board panel already exists; never run two. Reveal the live one and
      // discard the duplicate VS Code handed us.
      BoardPanel.current.panel.reveal(BoardPanel.current.panel.viewColumn);
      panel.dispose();
      return BoardPanel.current;
    }

    BoardPanel.current = new BoardPanel(panel, deps);
    return BoardPanel.current;
  }

  static postStateIfOpen(): void {
    BoardPanel.current?.postState();
  }

  /** Push the current store state into the webview. */
  postState(): void {
    const enableRunWithAI = vscode.workspace
      .getConfiguration('mwnn-kanban')
      .get<boolean>('enableRunWithAI', true);
    const message: HostToWebviewMessage = {
      type: 'state',
      board: this.deps.store.getState(),
      enableRunWithAI,
    };
    void this.panel.webview.postMessage(message);
  }

  private async handleMessage(message: WebviewToHostMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.postState();
        return;
      case 'requestAddCard': {
        const column = this.deps.store.getState().columns.find((candidate) => candidate.id === message.columnId);
        if (!column) {
          return;
        }

        const title = await vscode.window.showInputBox({
          prompt: `Add a card to ${column.title}`,
          placeHolder: 'Card title',
        });
        const normalizedTitle = title?.trim();
        if (!normalizedTitle) {
          return;
        }

        await this.deps.store.addCard(message.columnId, normalizedTitle);
        break;
      }
      case 'requestAddColumn': {
        const title = await vscode.window.showInputBox({
          prompt: 'New column title',
        });
        const normalizedTitle = title?.trim();
        if (!normalizedTitle) {
          return;
        }

        await this.deps.store.addColumn(normalizedTitle);
        break;
      }
      case 'addCard':
        await this.deps.store.addCard(message.columnId, message.title);
        break;
      case 'addColumn':
        await this.deps.store.addColumn(message.title);
        break;
      case 'editCard':
        await this.deps.store.editCard(message.cardId, message.title);
        break;
      case 'duplicateCard': {
        const before = new Set(collectCardIds(this.deps.store.getState()));
        await this.deps.store.duplicateCard(message.cardId);
        this.postState();
        // Surface the brand-new copy by opening its details. The duplicate is
        // the only card id that did not exist before this commit.
        const newCardId = collectCardIds(this.deps.store.getState()).find((id) => !before.has(id));
        if (newCardId) {
          void this.panel.webview.postMessage({ type: 'openCard', cardId: newCardId } satisfies HostToWebviewMessage);
        }
        return;
      }
      case 'renameColumn':
        await this.deps.store.renameColumn(message.columnId, message.title);
        break;
      case 'setColumnLimits':
        await this.deps.store.setColumnConfig(message.columnId, {
          wipLimit: message.wipLimit,
          reverseWip: message.reverseWip,
        });
        break;
      case 'deleteColumn': {
        const state = this.deps.store.getState();
        if (state.columns.length <= 1) {
          void vscode.window.showInformationMessage('The board must keep at least one column.');
          return;
        }

        const column = state.columns.find((candidate) => candidate.id === message.columnId);
        if (!column) {
          return;
        }
        if (column.cards.length > 0 && !message.targetColumnId) {
          void vscode.window.showInformationMessage('Choose a destination column for the existing cards before deleting this column.');
          return;
        }

        const choice = await vscode.window.showWarningMessage(
          `Delete column "${column.title}"?`,
          { modal: true },
          'Delete',
        );
        if (choice !== 'Delete') {
          return;
        }

        await this.deps.store.removeColumn(message.columnId, message.targetColumnId);
        break;
      }
      case 'reorderColumn':
        await this.deps.store.reorderColumns(message.columnId, message.toIndex);
        break;
      case 'setDescription':
        await this.deps.store.setDescription(message.cardId, message.description);
        break;
      case 'setAcceptanceCriteria':
        await this.deps.store.setAcceptanceCriteria(message.cardId, message.acceptanceCriteria);
        break;
      case 'setAssignee':
        await this.deps.store.setAssignee(message.cardId, message.assignee);
        break;
      case 'setDependencies':
        await this.deps.store.setDependencies(message.cardId, message.dependsOn);
        break;
      case 'runCardWithAI':
        await this.deps.runCardWithAI(message.cardId);
        break;
      case 'fillCardDefinition':
        await this.deps.fillCardDefinition(message.cardId);
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
      case 'moveCard': {
        const state = this.deps.store.getState();
        if (!canMoveCardToColumn(state, message.cardId, message.toColumnId)) {
          const card = state.columns
            .flatMap((column) => column.cards)
            .find((candidate) => candidate.id === message.cardId);
          void vscode.window.showInformationMessage(
            `"${card?.title ?? 'This card'}" is blocked by unfinished dependencies and can't move past Ready.`,
          );
          this.postState();
          return;
        }

        await this.deps.store.moveCard(message.cardId, message.toColumnId, message.toIndex);
        this.postState();
        await this.maybeOfferDefinition(message.cardId, message.toColumnId);
        return;
      }
    }
    this.postState();
  }

  /**
   * When a card lands in a Ready column without a full definition (missing
   * Description or Acceptance criteria), offer to let the AI fill both in.
   * Accepting opens the card details and hands the card off for definition.
   */
  private async maybeOfferDefinition(cardId: string, toColumnId: string): Promise<void> {
    const column = this.deps.store.getState().columns.find((candidate) => candidate.id === toColumnId);
    if (!column || column.role !== 'ready') {
      return;
    }

    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (!card || !cardNeedsDefinition(card)) {
      return;
    }

    const choice = await vscode.window.showInformationMessage(
      `"${card.title}" needs a definition before it's ready. Have AI fill in the Description and Acceptance criteria?`,
      'Fill with AI',
      'Not now',
    );
    if (choice !== 'Fill with AI') {
      return;
    }

    void this.panel.webview.postMessage({ type: 'openCard', cardId } satisfies HostToWebviewMessage);
    await this.deps.fillCardDefinition(cardId);
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

function collectCardIds(state: { columns: readonly { cards: readonly { id: string }[] }[] }): string[] {
  return state.columns.flatMap((column) => column.cards.map((card) => card.id));
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
