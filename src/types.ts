/**
 * Shared types for MWNN Kanban.
 *
 * The board model and the extension-host ⇄ webview message protocol are both
 * declared here so the extension host and the webview type-check against the
 * same contract. The webview script (media/board.js) mirrors these shapes.
 */

export const BOARD_STATE_VERSION = 2 as const;

export type AssigneeKind = 'human' | 'ai';
export type ColumnRole = 'backlog' | 'ready' | 'in-progress' | 'done' | 'custom';

export interface Assignee {
  readonly kind: AssigneeKind;
  readonly name?: string;
}

export interface Card {
  readonly id: string;
  title: string;
  readonly createdAt: number;
  updatedAt?: number;
  description?: string;
  acceptanceCriteria?: string;
  activity?: string;
  assignee?: Assignee;
}

export interface Column {
  readonly id: string;
  title: string;
  cards: Card[];
  role?: ColumnRole;
  wipLimit?: number | null;
  reverseWip?: number | null;
}

export interface BoardState {
  readonly version: typeof BOARD_STATE_VERSION;
  columns: Column[];
}

/** Messages sent from the webview to the extension host. */
export type WebviewToHostMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'addCard'; readonly columnId: string; readonly title: string }
  | { readonly type: 'addColumn'; readonly title: string }
  | { readonly type: 'editCard'; readonly cardId: string; readonly title: string }
  | { readonly type: 'renameColumn'; readonly columnId: string; readonly title: string }
  | {
      readonly type: 'setColumnLimits';
      readonly columnId: string;
      readonly wipLimit: number | null;
      readonly reverseWip: number | null;
    }
  | { readonly type: 'deleteColumn'; readonly columnId: string; readonly targetColumnId?: string }
  | { readonly type: 'reorderColumn'; readonly columnId: string; readonly toIndex: number }
  | { readonly type: 'setDescription'; readonly cardId: string; readonly description: string }
  | { readonly type: 'setAcceptanceCriteria'; readonly cardId: string; readonly acceptanceCriteria: string }
  | { readonly type: 'setAssignee'; readonly cardId: string; readonly assignee?: Assignee }
  | { readonly type: 'runCardWithAI'; readonly cardId: string }
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
    case 'addColumn':
      return typeof value['title'] === 'string';
    case 'editCard':
      return typeof value['cardId'] === 'string' && typeof value['title'] === 'string';
    case 'renameColumn':
      return typeof value['columnId'] === 'string' && typeof value['title'] === 'string';
    case 'setColumnLimits':
      return (
        typeof value['columnId'] === 'string' &&
        isOptionalLimit(value['wipLimit']) &&
        value['wipLimit'] !== undefined &&
        isOptionalLimit(value['reverseWip']) &&
        value['reverseWip'] !== undefined
      );
    case 'deleteColumn':
      return (
        typeof value['columnId'] === 'string' &&
        (value['targetColumnId'] === undefined || typeof value['targetColumnId'] === 'string')
      );
    case 'reorderColumn':
      return typeof value['columnId'] === 'string' && Number.isInteger(value['toIndex']);
    case 'setDescription':
      return typeof value['cardId'] === 'string' && typeof value['description'] === 'string';
    case 'setAcceptanceCriteria':
      return typeof value['cardId'] === 'string' && typeof value['acceptanceCriteria'] === 'string';
    case 'setAssignee':
      return (
        typeof value['cardId'] === 'string' &&
        (value['assignee'] === undefined || isAssignee(value['assignee']))
      );
    case 'runCardWithAI':
      return typeof value['cardId'] === 'string';
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

export function isAssignee(value: unknown): value is Assignee {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isAssigneeKind(value['kind']) &&
    (value['name'] === undefined || typeof value['name'] === 'string')
  );
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
    candidate['cards'].every(isCard) &&
    (candidate['role'] === undefined || isColumnRole(candidate['role'])) &&
    isOptionalLimit(candidate['wipLimit']) &&
    isOptionalLimit(candidate['reverseWip'])
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
    typeof candidate['createdAt'] === 'number' &&
    (candidate['updatedAt'] === undefined || typeof candidate['updatedAt'] === 'number') &&
    (candidate['description'] === undefined || typeof candidate['description'] === 'string') &&
    (candidate['acceptanceCriteria'] === undefined || typeof candidate['acceptanceCriteria'] === 'string') &&
    (candidate['activity'] === undefined || typeof candidate['activity'] === 'string') &&
    (candidate['assignee'] === undefined || isAssignee(candidate['assignee']))
  );
}

function isAssigneeKind(value: unknown): value is AssigneeKind {
  return value === 'human' || value === 'ai';
}

function isColumnRole(value: unknown): value is ColumnRole {
  return (
    value === 'backlog' ||
    value === 'ready' ||
    value === 'in-progress' ||
    value === 'done' ||
    value === 'custom'
  );
}

function isOptionalLimit(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
