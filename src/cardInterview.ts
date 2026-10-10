import {
  buildCardInterviewPrompt,
  describeInterviewIneligibility,
  findInterviewCardSelection,
  formatInterviewStartEntry,
} from './aiCards';
import { CHAT_PROVIDER_LABELS, type ChatHandoffAttempt, type ChatHandoffTarget } from './chatHandoff';
import type { BoardState } from './types';

/** Result of asking the user which interactive chat should host the interview. */
export type InterviewProviderPick =
  | { readonly kind: 'picked'; readonly target: ChatHandoffTarget }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unavailable'; readonly message: string };

export type CardInterviewOutcome =
  | 'started'
  | 'busy'
  | 'ineligible'
  | 'cancelled'
  | 'unavailable'
  | 'failed';

export interface CardInterviewDeps {
  /** Rereads the board from disk so eligibility reflects the saved card. */
  readonly reloadState: () => Promise<BoardState>;
  /** The per-card duplicate-dispatch guard shared with other chat hand-offs. */
  readonly runExclusive: <T>(cardId: string, action: () => Promise<T>) => Promise<ChatHandoffAttempt<T>>;
  /** Offers interactive chat providers only: an interview needs replies. */
  readonly pickProvider: () => Promise<InterviewProviderPick>;
  /** Delivers the prompt; reports its own failure and returns false. */
  readonly handOff: (target: ChatHandoffTarget, prompt: string, subject: string) => Promise<boolean>;
  readonly appendActivity: (cardId: string, entry: string) => Promise<unknown>;
  readonly cardFilePath: (cardId: string) => string;
  readonly workspaceRoot: string;
  readonly showInformation: (message: string) => void;
  readonly showWarning: (message: string) => void;
  readonly refreshBoard: () => void;
  readonly now?: () => Date;
}

/**
 * Start or resume an AI-guided interview for a Human card in an interactive
 * chat. The card keeps its Human assignee, column and acceptance checklist:
 * only a start note is appended, and only after the prompt was delivered.
 * Interviews never go through the agent CLI or the AI loop, whose completion
 * handling could reassign the card or check its criteria.
 */
export async function startCardInterview(cardId: string, deps: CardInterviewDeps): Promise<CardInterviewOutcome> {
  const attempt = await deps.runExclusive(cardId, async (): Promise<CardInterviewOutcome> => {
    const before = findInterviewCardSelection(await deps.reloadState(), cardId);
    if (!before.eligible) {
      deps.showInformation(describeInterviewIneligibility(before.reason));
      return 'ineligible';
    }

    const pick = await deps.pickProvider();
    if (pick.kind === 'unavailable') {
      deps.showWarning(pick.message);
      return 'unavailable';
    }
    if (pick.kind === 'cancelled') {
      deps.showInformation('Interview not started: no chat was chosen. The card is unchanged.');
      return 'cancelled';
    }

    // The picker can stay open for a while; reread so a card moved to Done or
    // edited meanwhile is never launched from stale state.
    const current = findInterviewCardSelection(await deps.reloadState(), cardId);
    if (!current.eligible) {
      deps.showInformation(describeInterviewIneligibility(current.reason));
      return 'ineligible';
    }

    const prompt = buildCardInterviewPrompt(current.card, deps.cardFilePath(cardId), deps.workspaceRoot);
    const delivered = await deps.handOff(pick.target, prompt, `the interview for "${current.card.title}"`);
    if (!delivered) {
      return 'failed';
    }

    await deps.appendActivity(
      cardId,
      formatInterviewStartEntry(CHAT_PROVIDER_LABELS[pick.target.provider], deps.now?.() ?? new Date()),
    );
    deps.refreshBoard();
    return 'started';
  });

  if (!attempt.started) {
    deps.showInformation('An interview or hand-off for this card is already starting. Please wait for it to finish.');
    return 'busy';
  }
  return attempt.value;
}
