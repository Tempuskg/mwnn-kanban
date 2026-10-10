/**
 * Registry of single-card agent-CLI runs in flight. Pure (no `vscode` import)
 * so the abort routing is unit-testable without an extension host.
 *
 * The Stop Card AI Run command aborts every registered run; the board's
 * per-card Stop button aborts only the runs registered for that card. AI loop
 * dispatches never register here, so neither path touches the loop.
 */

export interface CardCliRunHandle {
  readonly signal: AbortSignal;
  /** Remove the run from the registry once its task settles. */
  finish(): void;
}

export class CardCliRunRegistry {
  private readonly runs = new Map<AbortController, string | undefined>();

  /** Register a run, keyed by the card it works on when known. */
  start(cardId?: string): CardCliRunHandle {
    const controller = new AbortController();
    this.runs.set(controller, cardId);
    return {
      signal: controller.signal,
      finish: () => {
        this.runs.delete(controller);
      },
    };
  }

  get size(): number {
    return this.runs.size;
  }

  /** True while at least one registered run belongs to `cardId`. */
  hasCard(cardId: string): boolean {
    for (const owner of this.runs.values()) {
      if (owner === cardId) {
        return true;
      }
    }
    return false;
  }

  /** Abort only the runs registered for `cardId`; returns how many were aborted. */
  abortCard(cardId: string): number {
    let aborted = 0;
    for (const [controller, owner] of this.runs) {
      if (owner === cardId && !controller.signal.aborted) {
        controller.abort();
        aborted += 1;
      }
    }
    return aborted;
  }

  /** Abort every registered run; returns how many were aborted. */
  abortAll(): number {
    let aborted = 0;
    for (const controller of this.runs.keys()) {
      if (!controller.signal.aborted) {
        controller.abort();
        aborted += 1;
      }
    }
    return aborted;
  }
}
