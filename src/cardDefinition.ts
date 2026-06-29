/**
 * The single source of truth for whether a card is "defined" — i.e. ready to
 * start. A card counts as defined only when it has BOTH a non-empty Description
 * and non-empty Acceptance criteria (after trimming whitespace); a Description
 * alone gives no testable completion signal.
 *
 * The Ready reverse-WIP "Defined x/y" count, the drag-to-Ready definition offer,
 * and the in-detail "Fill in with AI" affordance all key off this check. The
 * webview (media/board.js) cannot import this module, so it mirrors `isCardDefined`
 * the same way it mirrors the rest of the shared contract in src/types.ts.
 */

import type { Card } from './types';

type DefinableCard = Pick<Card, 'description' | 'acceptanceCriteria'>;

/** A card field counts as filled only when it has non-whitespace content. */
function hasContent(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** True when the card has both a Description and Acceptance criteria. */
export function isCardDefined(card: DefinableCard): boolean {
  return hasContent(card.description) && hasContent(card.acceptanceCriteria);
}

/** Inverse of {@link isCardDefined}: the card still needs definition work. */
export function cardNeedsDefinition(card: DefinableCard): boolean {
  return !isCardDefined(card);
}
