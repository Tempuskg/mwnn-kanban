/**
 * The AI loop's pause gate. Pure (no `vscode` import) so the hold/resume/stop
 * semantics are unit-testable without an extension host.
 *
 * Pausing never interrupts work: the loop consults the gate only between
 * actions, so an in-flight stage (and its CLI process) always runs to its own
 * end. The next action then waits on the gate until the run is resumed or
 * stopped, inside the same run, so the run's session, dispatch ledger, and
 * credit-fallback state carry straight on after a resume.
 */

export interface AiLoopPauseGate {
  /** True between `pause()` and the next `resume()` or `release()`. */
  isPaused(): boolean;
  /** Hold the loop before its next action. False when already paused or released. */
  pause(): boolean;
  /** Let a paused loop carry on. False when it was not paused. */
  resume(): boolean;
  /**
   * End the gate for good, waking any waiter: used when the run is stopped,
   * so a paused loop sees its cancellation instead of waiting forever.
   */
  release(): void;
  /** Resolves immediately unless paused; otherwise on resume or release. */
  waitWhilePaused(): Promise<void>;
}

export function createAiLoopPauseGate(onChange: () => void = () => undefined): AiLoopPauseGate {
  let paused = false;
  let released = false;
  let waiters: (() => void)[] = [];

  const wake = (): void => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) {
      resolve();
    }
  };

  return {
    isPaused: () => paused,
    pause: () => {
      if (paused || released) {
        return false;
      }
      paused = true;
      onChange();
      return true;
    },
    resume: () => {
      if (!paused) {
        return false;
      }
      paused = false;
      wake();
      onChange();
      return true;
    },
    release: () => {
      released = true;
      const wasPaused = paused;
      paused = false;
      wake();
      if (wasPaused) {
        onChange();
      }
    },
    waitWhilePaused: () =>
      paused ? new Promise<void>((resolve) => waiters.push(resolve)) : Promise.resolve(),
  };
}
