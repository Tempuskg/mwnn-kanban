export interface AiLoopProgressLocations<TLocation> {
  readonly Window: TLocation;
}

export interface AiLoopProgressOptions<TLocation> {
  readonly location: TLocation;
  readonly title: string;
}

/**
 * Keep agent-run progress in VS Code's status bar. Notification progress
 * appears above the bottom-right workbench area, can cover the built-in chat
 * composer, and cannot be collapsed while the run streams status updates.
 */
export function createStatusBarProgressOptions<TLocation>(
  locations: AiLoopProgressLocations<TLocation>,
  title: string,
): AiLoopProgressOptions<TLocation> {
  return {
    location: locations.Window,
    title,
  };
}

export function createAiLoopProgressOptions<TLocation>(
  locations: AiLoopProgressLocations<TLocation>,
): AiLoopProgressOptions<TLocation> {
  return createStatusBarProgressOptions(locations, 'MWNN AI loop');
}
