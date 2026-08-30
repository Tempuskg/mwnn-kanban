/**
 * Pure routing for sidebar-webview → extension-host messages. No `vscode`
 * import here, so the mapping from each button's message to the action it runs
 * is unit-testable without an extension host.
 */

/** Every message the sidebar webview can send to the extension host. */
export const SIDEBAR_COMMANDS = ['openBoard', 'importPlan', 'runAiLoop', 'openPortfolio'] as const;

export type SidebarCommand = (typeof SIDEBAR_COMMANDS)[number];

/** The host-side action behind each sidebar button. */
export type SidebarActions = {
  readonly [Command in SidebarCommand]: () => void;
};

function sidebarCommandOf(message: unknown): SidebarCommand | undefined {
  if (typeof message !== 'object' || message === null) {
    return undefined;
  }

  const { type } = message as { readonly type?: unknown };
  return SIDEBAR_COMMANDS.find((command) => command === type);
}

/**
 * Run the action for a sidebar message and report which command it was.
 * Unrecognized messages are ignored and report `undefined`.
 */
export function routeSidebarMessage(
  message: unknown,
  actions: SidebarActions,
): SidebarCommand | undefined {
  const command = sidebarCommandOf(message);
  if (command === undefined) {
    return undefined;
  }

  actions[command]();
  return command;
}
