/**
 * Pure board operations. No `vscode` or Node imports here so these stay
 * trivially unit-testable and reusable from either side of the protocol.
 */

import { BOARD_STATE_VERSION, type BoardState, type Card, type Column } from './types';

let idCounter = 0;
const FALLBACK_COLUMN_TITLES = ['To Do', 'In Progress', 'Done'] as const;

/** Generate a process-unique id. Deterministic within a run, good enough for board entities. */
export function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function normalizeTitle(title: string): string | undefined {
  const normalized = title.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeColumnTitles(columnTitles: readonly string[]): string[] {
  const normalized = columnTitles
    .map((title) => normalizeTitle(title))
    .filter((title): title is string => title !== undefined);

  return normalized.length > 0 ? normalized : [...FALLBACK_COLUMN_TITLES];
}

/** Build a fresh board from a list of column titles. */
export function defaultBoard(columnTitles: readonly string[]): BoardState {
  const titles = normalizeColumnTitles(columnTitles);
  return {
    version: BOARD_STATE_VERSION,
    columns: titles.map((title) => ({ id: makeId('col'), title, cards: [] })),
  };
}

function cloneCard(card: Card): Card {
  return { id: card.id, title: card.title, createdAt: card.createdAt };
}

function cloneColumn(column: Column): Column {
  return { id: column.id, title: column.title, cards: column.cards.map(cloneCard) };
}

/** Return a deep copy so callers never mutate the stored state in place. */
export function cloneBoard(state: BoardState): BoardState {
  return { version: state.version, columns: state.columns.map(cloneColumn) };
}

export function addColumn(state: BoardState, title: string): BoardState {
  const normalized = normalizeTitle(title);
  if (!normalized) {
    return cloneBoard(state);
  }

  const next = cloneBoard(state);
  next.columns.push({ id: makeId('col'), title: normalized, cards: [] });
  return next;
}

export function addCard(state: BoardState, columnId: string, title: string): BoardState {
  const normalized = normalizeTitle(title);
  if (!normalized) {
    return cloneBoard(state);
  }

  const next = cloneBoard(state);
  const column = next.columns.find((c) => c.id === columnId);
  if (column) {
    column.cards.push({ id: makeId('card'), title: normalized, createdAt: Date.now() });
  }
  return next;
}

export function editCard(state: BoardState, cardId: string, title: string): BoardState {
  const normalized = normalizeTitle(title);
  if (!normalized) {
    return cloneBoard(state);
  }

  const next = cloneBoard(state);
  for (const column of next.columns) {
    const card = column.cards.find((c) => c.id === cardId);
    if (card) {
      card.title = normalized;
      break;
    }
  }
  return next;
}

export function deleteCard(state: BoardState, cardId: string): BoardState {
  const next = cloneBoard(state);
  for (const column of next.columns) {
    const index = column.cards.findIndex((c) => c.id === cardId);
    if (index !== -1) {
      column.cards.splice(index, 1);
      break;
    }
  }
  return next;
}

/** Move a card to another column at a given index. No-op if the card is not found. */
export function moveCard(state: BoardState, cardId: string, toColumnId: string, toIndex: number): BoardState {
  const next = cloneBoard(state);
  let sourceColumn: Column | undefined;
  let sourceIndex = -1;

  for (const column of next.columns) {
    const index = column.cards.findIndex((c) => c.id === cardId);
    if (index !== -1) {
      sourceColumn = column;
      sourceIndex = index;
      break;
    }
  }

  if (!sourceColumn) {
    return next;
  }

  const target = next.columns.find((c) => c.id === toColumnId);
  if (!target) {
    return next;
  }

  const [moved] = sourceColumn.cards.splice(sourceIndex, 1);
  if (!moved) {
    return next;
  }

  const clamped = Math.max(0, Math.min(toIndex, target.cards.length));
  target.cards.splice(clamped, 0, moved);
  return next;
}
