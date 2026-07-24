export interface AiLoopProgressLocations<TLocation> {
  readonly Window: TLocation;
}

export interface AiLoopProgressOptions<TLocation> {
  readonly location: TLocation;
  readonly title: string;
}

/**
 * Keep AI-loop progress in VS Code's status bar. Notification progress appears
 * above the bottom-right workbench area and can cover the built-in chat composer.
 */
export function createAiLoopProgressOptions<TLocation>(
  locations: AiLoopProgressLocations<TLocation>,
): AiLoopProgressOptions<TLocation> {
  return {
    location: locations.Window,
    title: 'MWNN AI loop',
  };
}
