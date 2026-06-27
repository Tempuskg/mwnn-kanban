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
  if (!isRecord(value)) {
    return false;
  }
  const candidate = value;
  if (candidate['version'] !== BOARD_STATE_VERSION) {
    return false;
  }
  if (!Array.isArray(candidate['columns'])) {
    return false;
  }
  return candidate['columns'].every(isColumn);
}

/** Runtime type guard for messages arriving from the webview. */
export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  if (!isRecord(value) || typeof value['type'] !== 'string') {
    return false;
  }

  switch (value['type']) {
    case 'ready':
      return true;
    case 'addCard':
      return typeof value['columnId'] === 'string' && typeof value['title'] === 'string';
    case 'editCard':
      return typeof value['cardId'] === 'string' && typeof value['title'] === 'string';
    case 'deleteCard':
      return typeof value['cardId'] === 'string';
    case 'moveCard':
      return (
        typeof value['cardId'] === 'string' &&
        typeof value['toColumnId'] === 'string' &&
        Number.isInteger(value['toIndex'])
      );
    default:
      return false;
  }
}

function isColumn(value: unknown): value is Column {
  if (!isRecord(value)) {
    return false;
  }
  const candidate = value;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['title'] === 'string' &&
    Array.isArray(candidate['cards']) &&
    candidate['cards'].every(isCard)
  );
}

function isCard(value: unknown): value is Card {
  if (!isRecord(value)) {
    return false;
  }
  const candidate = value;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['title'] === 'string' &&
    typeof candidate['createdAt'] === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
