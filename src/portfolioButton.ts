/**
 * Pure logic for the sidebar's Pro "Portfolio" button. No `vscode` import here
 * so the licence gating and the command routing are unit-testable in isolation
 * from the webview and the extension host.
 */

/** The command the Pro package registers for its Portfolio dashboard. */
export const OPEN_PORTFOLIO_COMMAND = 'mwnn-kanban-pro.openPortfolio';

/** The sidebar button's label. */
export const PORTFOLIO_BUTTON_LABEL = 'Portfolio';

/** The sidebar button's tooltip, describing what the dashboard offers. */
export const PORTFOLIO_BUTTON_TOOLTIP =
  'Open the Pro Portfolio dashboard: cross-project status, allocation, and time';

/** Shown when the Pro package is missing so the command was never registered. */
export const PORTFOLIO_UNAVAILABLE_MESSAGE =
  'The MWNN Kanban Pro Portfolio dashboard is unavailable. Install the Pro package and activate your license to use it.';

/**
 * The licence signal the button is gated on. Deliberately just a boolean: no
 * key, no validation payload, and nothing else crosses into the webview.
 */
export interface ProLicenseStatus {
  /** Whether a valid Pro licence key or a live trial is active. */
  readonly licensed: boolean;
}

/**
 * The two presentations of the sidebar's Portfolio button:
 * - `visible`: a Pro licence (or live trial) is active — the button is shown.
 * - `hidden`: no valid licence — the button is absent, with no upsell in its
 *   place, exactly as the sidebar looked before Pro existed.
 */
export type PortfolioButtonMode = 'visible' | 'hidden';

/** Map the Pro licence status onto the button presentation to render. */
export function portfolioButtonMode(status: ProLicenseStatus): PortfolioButtonMode {
  return status.licensed ? 'visible' : 'hidden';
}

/** Dependencies for {@link openProPortfolio}, injected so it can be tested. */
export interface OpenProPortfolioDeps {
  readonly executeCommand: (command: string, ...args: unknown[]) => PromiseLike<unknown>;
  readonly showInformationMessage: (message: string) => PromiseLike<unknown>;
}

/**
 * Run the Pro Portfolio command. When the Pro module is not loaded the command
 * is not registered and `executeCommand` rejects; surface that as a plain
 * message rather than an unhandled rejection or a silent no-op.
 */
export async function openProPortfolio(deps: OpenProPortfolioDeps): Promise<void> {
  try {
    await deps.executeCommand(OPEN_PORTFOLIO_COMMAND);
  } catch {
    await deps.showInformationMessage(PORTFOLIO_UNAVAILABLE_MESSAGE);
  }
}
