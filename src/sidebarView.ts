/**
 * The activity-bar sidebar view for MWNN Kanban. Showing this view (by clicking
 * the activity-bar icon) opens the full Kanban board panel in the editor area,
 * and the view itself offers a button whose label/visibility reflects the board
 * panel's current state: "Open Board" when closed, "Focus Board" when open but
 * unfocused, and hidden when the board is already open and focused.
 *
 * A Pro-only "Portfolio" button sits alongside the secondary buttons. It is
 * rendered only while a Pro license (or live trial) is active, and appears or
 * disappears live as a key is entered or cleared.
 *
 * Play, Pause, and Stop buttons drive the AI board loop. The extension host owns
 * the loop state (idle / running / paused) and pushes which buttons are usable;
 * the sidebar only posts commands back.
 */

import * as vscode from 'vscode';
import { boardButtonMode, boardButtonLabel, type BoardButtonMode, type BoardPanelStatus } from './boardButton';
import {
  portfolioButtonMode,
  PORTFOLIO_BUTTON_LABEL,
  PORTFOLIO_BUTTON_TOOLTIP,
  type PortfolioButtonMode,
  type ProLicenseStatus,
} from './portfolioButton';
import {
  createSidebarAiLoopStateMessage,
  routeSidebarMessage,
  type AiLoopControls,
  type AiLoopState,
} from './sidebarMessages';

/** The host-side AI loop hooks behind the sidebar's Play, Pause, and Stop buttons. */
export interface SidebarAiLoopHooks {
  readonly play: () => void;
  readonly pause: () => void;
  readonly stop: () => void;
  readonly state: () => AiLoopState;
  readonly runWithAiEnabled: () => boolean;
  /** Fires when the loop state or the Run With AI setting changes. */
  readonly onDidChange: vscode.Event<void>;
}

export class BoardSidebarViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'mwnn-kanban.sidebar';

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly openBoard: () => void,
    private readonly importPlan: () => void,
    private readonly aiLoop: SidebarAiLoopHooks,
    private readonly openPortfolio: () => void,
    private readonly boardStatus: () => BoardPanelStatus,
    private readonly proLicenseStatus: () => ProLicenseStatus,
    private readonly onBoardStateChange: vscode.Event<void>,
    private readonly onProLicenseChange: (listener: () => void) => vscode.Disposable,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webviewView.webview.html = this.renderHtml(
      webviewView.webview,
      boardButtonMode(this.boardStatus()),
      portfolioButtonMode(this.proLicenseStatus()),
      createSidebarAiLoopStateMessage(this.aiLoop.state(), this.aiLoop.runWithAiEnabled()).controls,
    );

    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      routeSidebarMessage(message, {
        // Routes through the singleton openBoard() path in every button state,
        // so an existing panel is revealed rather than duplicated.
        openBoard: () => this.openBoard(),
        importPlan: () => this.importPlan(),
        playAiLoop: () => this.aiLoop.play(),
        pauseAiLoop: () => this.aiLoop.pause(),
        stopAiLoop: () => this.aiLoop.stop(),
        openPortfolio: () => this.openPortfolio(),
        // A hidden view's document is torn down and reloaded from the HTML
        // set at resolve time, so re-push everything once its script is back.
        sidebarReady: () => this.postAllState(),
      });
    });

    // Keep the button in sync as the board panel opens, closes, and gains or
    // loses focus, without needing the sidebar to reload.
    const stateSubscription = this.onBoardStateChange(() => this.postButtonState());
    // Entering or clearing a license key flips the Portfolio button in the
    // already-open sidebar; no window reload or view re-open needed.
    const licenseSubscription = this.onProLicenseChange(() => this.postPortfolioButtonState());
    const aiLoopSubscription = this.aiLoop.onDidChange(() => this.postAiLoopState());
    webviewView.onDidDispose(() => {
      stateSubscription.dispose();
      licenseSubscription.dispose();
      aiLoopSubscription.dispose();
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });

    // Revealing the view (e.g. clicking the activity-bar icon) opens the board.
    this.openBoard();
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.postAllState();
        this.openBoard();
      }
    });
  }

  private postAllState(): void {
    this.postButtonState();
    this.postPortfolioButtonState();
    this.postAiLoopState();
  }

  /** Push the host-owned AI loop state and button enablement into the sidebar. */
  private postAiLoopState(): void {
    void this.view?.webview.postMessage(
      createSidebarAiLoopStateMessage(this.aiLoop.state(), this.aiLoop.runWithAiEnabled()),
    );
  }

  /** Push the current button mode into the sidebar webview. */
  private postButtonState(): void {
    void this.view?.webview.postMessage({
      type: 'boardButton',
      mode: boardButtonMode(this.boardStatus()),
    } satisfies SidebarBoardButtonMessage);
  }

  /**
   * Push the current Portfolio button visibility into the sidebar webview. Only
   * the derived mode crosses the boundary — never the license key or payload.
   */
  private postPortfolioButtonState(): void {
    void this.view?.webview.postMessage({
      type: 'portfolioButton',
      mode: portfolioButtonMode(this.proLicenseStatus()),
    } satisfies SidebarPortfolioButtonMessage);
  }

  private renderHtml(
    webview: vscode.Webview,
    mode: BoardButtonMode,
    portfolioMode: PortfolioButtonMode,
    loopControls: AiLoopControls,
  ): string {
    const disabled = (usable: boolean): string => (usable ? '' : ' disabled');
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
    button:disabled { opacity: 0.5; cursor: default; }
    /* Hidden entirely so it leaves no empty control or leftover spacing. */
    button[hidden] { display: none; }
    button.secondary {
      margin-top: 8px;
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
    .loop-controls { display: flex; align-items: center; gap: 4px; margin-top: 8px; }
    .loop-controls .loop-label { flex: 0 0 auto; margin-right: 4px; font-size: 12px; white-space: nowrap; }
    .loop-controls button.secondary { margin-top: 0; flex: 1; min-width: 0; padding: 6px 4px; line-height: 1; }
    /* Drop the gap above "Import plan" when it is the only visible button. */
    button#open[hidden] + button.secondary { margin-top: 0; }
  </style>
  <title>MWNN Kanban</title>
</head>
<body>
  <p>The MWNN Kanban board opens in the editor area.</p>
  <button id="open" type="button"${mode === 'hidden' ? ' hidden' : ''}>${boardButtonLabel(mode)}</button>
  <button id="import" type="button" class="secondary" title="Hand a written plan to AI to import as Backlog cards">Import plan</button>
  <div class="loop-controls" role="group" aria-label="AI loop controls" title="Automatically triage and run AI-assigned and unassigned cards, parking finished work in Verify for human sign-off">
    <span class="loop-label" aria-hidden="true">AI Loop</span>
    <button id="loop-play" type="button" class="secondary" title="Play: start the AI loop" aria-label="Play: start the AI loop"${disabled(loopControls.play)}>&#9654;</button>
    <button id="loop-pause" type="button" class="secondary" title="Pause: let the current card stage finish, then hold the AI loop" aria-label="Pause the AI loop after the current card stage"${disabled(loopControls.pause)}>&#10074;&#10074;</button>
    <button id="loop-stop" type="button" class="secondary" title="Stop: cancel the AI loop and end its active run" aria-label="Stop the AI loop"${disabled(loopControls.stop)}>&#9632;</button>
  </div>
  <button id="portfolio" type="button" class="secondary" title="${PORTFOLIO_BUTTON_TOOLTIP}"${portfolioMode === 'hidden' ? ' hidden' : ''}>${PORTFOLIO_BUTTON_LABEL}</button>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const openButton = document.getElementById('open');
    openButton.addEventListener('click', () => {
      vscode.postMessage({ type: 'openBoard' });
    });
    document.getElementById('import').addEventListener('click', () => {
      vscode.postMessage({ type: 'importPlan' });
    });
    const playButton = document.getElementById('loop-play');
    const pauseButton = document.getElementById('loop-pause');
    const stopButton = document.getElementById('loop-stop');
    playButton.addEventListener('click', () => {
      vscode.postMessage({ type: 'playAiLoop' });
    });
    pauseButton.addEventListener('click', () => {
      vscode.postMessage({ type: 'pauseAiLoop' });
    });
    stopButton.addEventListener('click', () => {
      vscode.postMessage({ type: 'stopAiLoop' });
    });

    function applyAiLoopState(message) {
      const controls = message.controls;
      if (!controls || typeof controls !== 'object') {
        return;
      }
      playButton.disabled = controls.play !== true;
      pauseButton.disabled = controls.pause !== true;
      stopButton.disabled = controls.stop !== true;
      const playLabel = !message.enabled
        ? 'Play: enable "MWNN Kanban: Run With AI" in settings to use the AI loop'
        : message.state === 'paused'
          ? 'Play: resume the paused AI loop'
          : 'Play: start the AI loop';
      playButton.title = playLabel;
      playButton.setAttribute('aria-label', playLabel);
    }
    const portfolioButton = document.getElementById('portfolio');
    portfolioButton.addEventListener('click', () => {
      vscode.postMessage({ type: 'openPortfolio' });
    });

    function applyButtonMode(mode) {
      if (mode === 'hidden') {
        openButton.hidden = true;
        return;
      }
      openButton.hidden = false;
      openButton.textContent = mode === 'focus' ? 'Focus Board' : 'Open Board';
    }

    window.addEventListener('message', (event) => {
      // Accept host messages only from this webview's exact origin.
      if (event.origin === 'null' || event.origin !== window.location.origin) {
        return;
      }

      const message = event.data;
      if (message && message.type === 'boardButton') {
        applyButtonMode(message.mode);
      } else if (message && message.type === 'portfolioButton') {
        portfolioButton.hidden = message.mode === 'hidden';
      } else if (message && message.type === 'aiLoopState') {
        applyAiLoopState(message);
      }
    });

    vscode.postMessage({ type: 'sidebarReady' });
  </script>
</body>
</html>`;
  }
}

/** Host → sidebar-webview message carrying the board button presentation. */
interface SidebarBoardButtonMessage {
  readonly type: 'boardButton';
  readonly mode: BoardButtonMode;
}

/** Host → sidebar-webview message carrying the Portfolio button presentation. */
interface SidebarPortfolioButtonMessage {
  readonly type: 'portfolioButton';
  readonly mode: PortfolioButtonMode;
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
