/**
 * Pure routing for sidebar-webview → extension-host messages. No `vscode`
 * import here, so the mapping from each button's message to the action it runs
 * is unit-testable without an extension host.
 *
 * Also the shared contract for the host → sidebar AI loop controls message: the
 * host owns the loop state and derives which buttons are usable, so the sidebar
 * script only applies what it is sent and posts commands back.
 */

/** Every message the sidebar webview can send to the extension host. */
export const SIDEBAR_COMMANDS = [
  'openBoard',
  'importPlan',
  'playAiLoop',
  'pauseAiLoop',
  'stopAiLoop',
  'openPortfolio',
  // Posted once the sidebar script loads (first show and every re-show after
  // the view was hidden), so the host can push the current presentation.
  'sidebarReady',
] as const;

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

/** The AI loop's lifecycle as the extension host tracks it. */
export type AiLoopState = 'idle' | 'running' | 'paused';

/** Which AI loop buttons the sidebar should leave usable. */
export interface AiLoopControls {
  readonly play: boolean;
  readonly pause: boolean;
  readonly stop: boolean;
}

/**
 * idle → Play only; running → Pause and Stop; paused → Play (resume) and Stop.
 * With Run With AI disabled, nothing is usable.
 */
export function aiLoopControls(state: AiLoopState, runWithAiEnabled: boolean): AiLoopControls {
  if (!runWithAiEnabled) {
    return { play: false, pause: false, stop: false };
  }
  return {
    play: state !== 'running',
    pause: state === 'running',
    stop: state !== 'idle',
  };
}

/** Host → sidebar-webview message carrying the AI loop controls presentation. */
export interface SidebarAiLoopStateMessage {
  readonly type: 'aiLoopState';
  readonly state: AiLoopState;
  readonly enabled: boolean;
  readonly controls: AiLoopControls;
}

export function createSidebarAiLoopStateMessage(
  state: AiLoopState,
  runWithAiEnabled: boolean,
): SidebarAiLoopStateMessage {
  return {
    type: 'aiLoopState',
    state,
    enabled: runWithAiEnabled,
    controls: aiLoopControls(state, runWithAiEnabled),
  };
}
