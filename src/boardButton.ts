/**
 * Pure logic for the sidebar's board button. No `vscode` import here so the
 * button's state machine is unit-testable in isolation from the webview and the
 * extension host.
 */

/** The open/focused status of the {@link BoardPanel} singleton. */
export interface BoardPanelStatus {
  /** Whether a board panel exists (the BoardPanel singleton is live). */
  readonly open: boolean;
  /** Whether that panel is the active/focused panel. */
  readonly focused: boolean;
}

/**
 * The three presentations of the sidebar's board button:
 * - `open`: no board panel — label "Open Board", clicking opens the board.
 * - `focus`: a board panel exists but isn't focused — label "Focus Board",
 *   clicking reveals the existing panel.
 * - `hidden`: the board panel is open and focused — nothing useful to open or
 *   focus, so the button is hidden.
 */
export type BoardButtonMode = 'open' | 'focus' | 'hidden';

/** Map the board panel status onto the button presentation to render. */
export function boardButtonMode(status: BoardPanelStatus): BoardButtonMode {
  if (!status.open) {
    return 'open';
  }
  return status.focused ? 'hidden' : 'focus';
}

/** The button label for a mode (unused when hidden). */
export function boardButtonLabel(mode: BoardButtonMode): string {
  return mode === 'focus' ? 'Focus Board' : 'Open Board';
}
