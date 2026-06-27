/**
 * Shared types for MWNN Kanban.
 *
 * The board model and the extension-host ⇄ webview message protocol are both
 * declared here so the extension host and the webview type-check against the
 * same contract. The webview script (media/board.js) mirrors these shapes.
 */

export const BOARD_STATE_VERSION = 1 as const;

export interface Card {
  readonly id: string;
  title: string;
  readonly createdAt: number;
}

export interface Column {
  readonly id: string;
  title: string;
  cards: Card[];
}

export interface BoardState {
  readonly version: typeof BOARD_STATE_VERSION;
  columns: Column[];
}

/** Messages sent from the webview to the extension host. */
export type WebviewToHostMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'addCard'; readonly columnId: string; readonly title: string }
  | { readonly type: 'editCard'; readonly cardId: string; readonly title: string }
  | { readonly type: 'deleteCard'; readonly cardId: string }
  | { readonly type: 'moveCard'; readonly cardId: string; readonly toColumnId: string; readonly toIndex: number };

/** Messages sent from the extension host to the webview. */
export type HostToWebviewMessage = { readonly type: 'state'; readonly board: BoardState };

/** Runtime type guard for persisted/posted board state. */
export function isBoardState(value: unknown): value is BoardState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate['version'] !== BOARD_STATE_VERSION) {
    return false;
  }
  if (!Array.isArray(candidate['columns'])) {
    return false;
  }
  return candidate['columns'].every(isColumn);
}

function isColumn(value: unknown): value is Column {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['title'] === 'string' &&
    Array.isArray(candidate['cards']) &&
    candidate['cards'].every(isCard)
  );
}

function isCard(value: unknown): value is Card {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['title'] === 'string' &&
    typeof candidate['createdAt'] === 'number'
  );
}
