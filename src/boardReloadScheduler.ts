/**
 * Debounced board reloads for the extension host. Pure (no `vscode` import) so
 * the reload path that external edits take is unit-testable.
 *
 * Two kinds of request feed it:
 * - `event`: a file watcher event under the board folder. The board is always
 *   reposted afterwards, matching the watcher's original behavior.
 * - `resync`: a safety net for a watcher that shut down or missed an event
 *   (window focus, the board becoming visible, a periodic poll while the board
 *   is open). The board is reposted only when the reload actually changed it,
 *   so an idle poll never rebuilds the webview.
 */

export type BoardReloadKind = 'event' | 'resync';

export interface BoardReloadTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface BoardReloadSchedulerDeps {
  /** Reload the store from disk; resolve `true` when the board changed. */
  reload(): Promise<boolean>;
  /** Push the current board to any open webview. */
  post(): void;
  /** Whether a periodic resync is worth running right now (e.g. board open). */
  isActive?(): boolean;
  onError?(error: unknown): void;
  debounceMs?: number;
  /** Period of the safety-net resync; 0 or omitted disables polling. */
  pollMs?: number;
  timers?: BoardReloadTimers;
}

export interface BoardReloadScheduler {
  schedule(kind: BoardReloadKind): void;
  dispose(): void;
}

export const BOARD_RELOAD_DEBOUNCE_MS = 75;
export const BOARD_RESYNC_POLL_MS = 10_000;

const defaultTimers: BoardReloadTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export function createBoardReloadScheduler(deps: BoardReloadSchedulerDeps): BoardReloadScheduler {
  const timers = deps.timers ?? defaultTimers;
  const debounceMs = deps.debounceMs ?? BOARD_RELOAD_DEBOUNCE_MS;

  let timer: unknown;
  let pendingForcePost = false;
  let inFlight = false;
  let disposed = false;

  const run = async (): Promise<void> => {
    const forcePost = pendingForcePost;
    pendingForcePost = false;
    inFlight = true;
    try {
      const changed = await deps.reload();
      if (!disposed && (changed || forcePost)) {
        deps.post();
      }
    } catch (error) {
      deps.onError?.(error);
    } finally {
      inFlight = false;
    }
  };

  const arm = (): void => {
    if (timer !== undefined) {
      timers.clearTimeout(timer);
    }
    timer = timers.setTimeout(() => {
      timer = undefined;
      if (disposed) {
        return;
      }
      if (inFlight) {
        // A reload is running; try again once it has had time to finish so an
        // edit that landed mid-reload is never lost.
        arm();
        return;
      }
      void run();
    }, debounceMs);
  };

  const schedule = (kind: BoardReloadKind): void => {
    if (disposed) {
      return;
    }
    if (kind === 'event') {
      pendingForcePost = true;
    }
    arm();
  };

  const poll =
    deps.pollMs !== undefined && deps.pollMs > 0
      ? timers.setInterval(() => {
          if (deps.isActive === undefined || deps.isActive()) {
            schedule('resync');
          }
        }, deps.pollMs)
      : undefined;

  return {
    schedule,
    dispose: () => {
      disposed = true;
      if (timer !== undefined) {
        timers.clearTimeout(timer);
        timer = undefined;
      }
      if (poll !== undefined) {
        timers.clearInterval(poll);
      }
    },
  };
}
