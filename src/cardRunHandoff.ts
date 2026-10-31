import type { ChatHandoffAttempt, ChatHandoffKind, ChatHandoffLease } from './chatHandoff';

/** Shown when another kind of hand-off (such as an AI loop dispatch) holds the card. */
export const CARD_HANDOFF_BUSY_MESSAGE =
  'A handoff for this card is already in progress. Please wait for it to finish.';

/** Shown while an agent CLI process runs for the card; Stop is the only way out. */
export const CARD_RUN_IN_PROGRESS_MESSAGE =
  'An AI run is already in progress for this card. Use the card\'s Stop action to end it, or wait for it to finish.';

export interface CardRunHandoffDeps {
  /** The per-card duplicate-dispatch guard, registered as a restartable `card` holder. */
  readonly runExclusive: <T>(
    cardId: string,
    action: (lease: ChatHandoffLease) => Promise<T>,
  ) => Promise<ChatHandoffAttempt<T>>;
  /** Abandons a pending `card` holder and runs the action under a fresh lock. */
  readonly restartExclusive: <T>(
    cardId: string,
    action: (lease: ChatHandoffLease) => Promise<T>,
  ) => Promise<ChatHandoffAttempt<T>>;
  readonly holder: (cardId: string) => ChatHandoffKind | undefined;
  /** Whether the holder reported an agent CLI process running for the card. */
  readonly processRunning: (cardId: string) => boolean;
  /** Offers to restart the stuck attempt; false when the user waits or dismisses. */
  readonly confirmRestart: () => Promise<boolean>;
  readonly showInformation: (message: string) => void;
}

/**
 * Run a per-card Run with AI / Fill in with AI attempt under the card's lock.
 * When an earlier attempt still holds the lock with no agent CLI process
 * running (a chat command or confirmation that never settled), the user is
 * offered a restart instead of a dead-end message. A running CLI process, and
 * any hand-off that is not a card run (the AI loop), is never restartable.
 * Returns whether the attempt ran and reported success.
 */
export async function runRestartableCardHandoff(
  cardId: string,
  deps: CardRunHandoffDeps,
  action: (lease: ChatHandoffLease) => Promise<boolean>,
): Promise<boolean> {
  const attempt = await deps.runExclusive(cardId, action);
  if (attempt.started) {
    return attempt.value;
  }

  if (deps.processRunning(cardId)) {
    deps.showInformation(CARD_RUN_IN_PROGRESS_MESSAGE);
    return false;
  }
  if (deps.holder(cardId) !== 'card') {
    deps.showInformation(CARD_HANDOFF_BUSY_MESSAGE);
    return false;
  }
  if (!(await deps.confirmRestart())) {
    return false;
  }

  // The prompt can stay open for a while; the earlier attempt may have started
  // a process, finished, or been replaced by another hand-off in the meantime.
  if (deps.processRunning(cardId)) {
    deps.showInformation(CARD_RUN_IN_PROGRESS_MESSAGE);
    return false;
  }
  const current = deps.holder(cardId);
  if (current !== undefined && current !== 'card') {
    deps.showInformation(CARD_HANDOFF_BUSY_MESSAGE);
    return false;
  }
  const restarted = await deps.restartExclusive(cardId, action);
  if (!restarted.started) {
    deps.showInformation(CARD_RUN_IN_PROGRESS_MESSAGE);
    return false;
  }
  return restarted.value;
}
