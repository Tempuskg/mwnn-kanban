/**
 * Owns the single live board panel without depending on the VS Code API.
 * Keeping the lifecycle decision here makes creation, reuse, disposal, and
 * restoration deterministic and unit-testable.
 */
export class BoardPanelLifecycle<TPanel> {
  private currentPanel: TPanel | undefined;

  constructor(private readonly revealPanel: (panel: TPanel) => void) {}

  get current(): TPanel | undefined {
    return this.currentPanel;
  }

  /** Reveal the live panel, or create and retain one when none exists. */
  show(createPanel: () => TPanel): TPanel {
    if (this.currentPanel) {
      this.revealPanel(this.currentPanel);
      return this.currentPanel;
    }

    const panel = createPanel();
    this.currentPanel = panel;
    return panel;
  }

  /**
   * Adopt a restored panel unless another panel is already live. A duplicate
   * restored by VS Code is discarded without constructing a second owner.
   */
  restore(adoptPanel: () => TPanel, disposeDuplicate: () => void): TPanel {
    if (this.currentPanel) {
      this.revealPanel(this.currentPanel);
      disposeDuplicate();
      return this.currentPanel;
    }

    const panel = adoptPanel();
    this.currentPanel = panel;
    return panel;
  }

  /** Clear the live panel only when the panel being closed still owns it. */
  close(panel: TPanel): boolean {
    if (this.currentPanel !== panel) {
      return false;
    }

    this.currentPanel = undefined;
    return true;
  }
}
