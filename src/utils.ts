/**
 * Pure board operations. No `vscode` or Node imports here so these stay
 * trivially unit-testable and reusable from either side of the protocol.
 */

import {
  BOARD_STATE_VERSION,
  type Assignee,
  type BoardState,
  type Card,
  type Column,
  type ColumnRole,
} from './types';

let idCounter = 0;
const FALLBACK_COLUMN_TITLES = ['To Do', 'In Progress', 'Done'] as const;

export interface SetColumnConfig {
  readonly title?: string;
  readonly role?: ColumnRole;
  readonly wipLimit?: number | null;
  readonly reverseWip?: number | null;
}

export interface WipState {
  readonly count: number;
  readonly limit: number | null;
  readonly over: boolean;
}

export interface ReadyState {
  readonly defined: number;
  readonly min: number | null;
  readonly under: boolean;
}

export interface PositionBounds {
  readonly previous?: number;
  readonly next?: number;
}

/** Generate a process-unique id. Deterministic within a run, good enough for board entities. */
export function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function normalizeTitle(title: string): string | undefined {
  const normalized = title.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeDescription(description: string): string | undefined {
  const normalized = description.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeColumnTitles(columnTitles: readonly string[]): string[] {
  const normalized = columnTitles
    .map((title) => normalizeTitle(title))
    .filter((title): title is string => title !== undefined);

  return normalized.length > 0 ? normalized : [...FALLBACK_COLUMN_TITLES];
}

function normalizeAssignee(assignee: Assignee | undefined): Assignee | undefined {
  if (!assignee) {
    return undefined;
  }

  const name = assignee.name?.trim();
  return name ? { kind: assignee.kind, name } : { kind: assignee.kind };
}

function normalizeLimit(limit: number | null | undefined): number | null | undefined {
  if (limit === undefined) {
    return undefined;
  }
  if (limit === null) {
    return null;
  }
  return Number.isInteger(limit) && limit >= 0 ? limit : null;
}

function inferColumnRole(title: string, index: number, total: number): ColumnRole {
  const normalized = title.trim().toLowerCase();
  if (normalized.includes('ready')) {
    return 'ready';
  }
  if (normalized.includes('progress') || normalized.includes('doing')) {
    return 'in-progress';
  }
  if (normalized.includes('done')) {
    return 'done';
  }
  if (normalized.includes('backlog') || normalized === 'todo' || normalized.includes('to do')) {
    return 'backlog';
  }
  if (index === 0) {
    return 'backlog';
  }
  if (index === total - 1) {
    return 'done';
  }
  return 'custom';
}

function createColumn(title: string, role: ColumnRole): Column {
  return { id: makeId('col'), title, cards: [], role, wipLimit: null, reverseWip: null };
}

/** Build a fresh board from a list of column titles. */
export function defaultBoard(columnTitles: readonly string[]): BoardState {
  const titles = normalizeColumnTitles(columnTitles);
  return {
    version: BOARD_STATE_VERSION,
    columns: titles.map((title, index) => createColumn(title, inferColumnRole(title, index, titles.length))),
  };
}

function cloneAssignee(assignee: Assignee): Assignee {
  return assignee.name ? { kind: assignee.kind, name: assignee.name } : { kind: assignee.kind };
}

function cloneCard(card: Card): Card {
  const clone: Card = { id: card.id, title: card.title, createdAt: card.createdAt };
  if (card.updatedAt !== undefined) {
    clone.updatedAt = card.updatedAt;
  }
  if (card.description !== undefined) {
    clone.description = card.description;
  }
  if (card.acceptanceCriteria !== undefined) {
    clone.acceptanceCriteria = card.acceptanceCriteria;
  }
  if (card.activity !== undefined) {
    clone.activity = card.activity;
  }
  if (card.assignee !== undefined) {
    clone.assignee = cloneAssignee(card.assignee);
  }
  return clone;
}

function cloneColumn(column: Column): Column {
  const clone: Column = { id: column.id, title: column.title, cards: column.cards.map(cloneCard) };
  if (column.role !== undefined) {
    clone.role = column.role;
  }
  if (column.wipLimit !== undefined) {
    clone.wipLimit = column.wipLimit;
  }
  if (column.reverseWip !== undefined) {
    clone.reverseWip = column.reverseWip;
  }
  return clone;
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
  next.columns.push(createColumn(normalized, 'custom'));
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
    const now = Date.now();
    column.cards.push({ id: makeId('card'), title: normalized, createdAt: now, updatedAt: now });
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
      card.updatedAt = Date.now();
      break;
    }
  }
  return next;
}

export function setAssignee(state: BoardState, cardId: string, assignee: Assignee | undefined): BoardState {
  const next = cloneBoard(state);
  const normalized = normalizeAssignee(assignee);
  for (const column of next.columns) {
    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      if (normalized) {
        card.assignee = normalized;
      } else {
        delete card.assignee;
      }
      card.updatedAt = Date.now();
      break;
    }
  }
  return next;
}

export function setDescription(state: BoardState, cardId: string, description: string): BoardState {
  const next = cloneBoard(state);
  const normalized = normalizeDescription(description);
  for (const column of next.columns) {
    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      if (normalized) {
        card.description = normalized;
      } else {
        delete card.description;
      }
      card.updatedAt = Date.now();
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

  moved.updatedAt = Date.now();
  const clamped = Math.max(0, Math.min(toIndex, target.cards.length));
  target.cards.splice(clamped, 0, moved);
  return next;
}

export function setColumnConfig(state: BoardState, columnId: string, config: SetColumnConfig): BoardState {
  const next = cloneBoard(state);
  const column = next.columns.find((candidate) => candidate.id === columnId);
  if (!column) {
    return next;
  }

  if (config.title !== undefined) {
    const normalizedTitle = normalizeTitle(config.title);
    if (normalizedTitle) {
      column.title = normalizedTitle;
    }
  }
  if (config.role !== undefined) {
    column.role = config.role;
  }
  if (config.wipLimit !== undefined) {
    column.wipLimit = normalizeLimit(config.wipLimit) ?? null;
  }
  if (config.reverseWip !== undefined) {
    column.reverseWip = normalizeLimit(config.reverseWip) ?? null;
  }

  return next;
}

export function renameColumn(state: BoardState, columnId: string, title: string): BoardState {
  return setColumnConfig(state, columnId, { title });
}

export function removeColumn(state: BoardState, columnId: string, targetColumnId?: string): BoardState {
  const next = cloneBoard(state);
  const sourceIndex = next.columns.findIndex((column) => column.id === columnId);
  if (sourceIndex === -1 || next.columns.length === 1) {
    return next;
  }

  const source = next.columns[sourceIndex];
  if (!source) {
    return next;
  }

  if (source.cards.length > 0) {
    if (!targetColumnId || targetColumnId === columnId) {
      return next;
    }

    const target = next.columns.find((column) => column.id === targetColumnId);
    if (!target) {
      return next;
    }

    target.cards.push(...source.cards.map(cloneCard));
  }

  next.columns.splice(sourceIndex, 1);
  return next;
}

export function reorderColumns(state: BoardState, columnId: string, toIndex: number): BoardState {
  const next = cloneBoard(state);
  const fromIndex = next.columns.findIndex((column) => column.id === columnId);
  if (fromIndex === -1) {
    return next;
  }

  const [column] = next.columns.splice(fromIndex, 1);
  if (!column) {
    return next;
  }

  const clamped = Math.max(0, Math.min(toIndex, next.columns.length));
  next.columns.splice(clamped, 0, column);
  return next;
}

export function wipState(column: Column): WipState {
  const count = column.cards.length;
  const limit = column.wipLimit ?? null;
  return {
    count,
    limit,
    over: limit !== null && count > limit,
  };
}

export function readyState(column: Column): ReadyState {
  const defined = column.cards.filter((card) => normalizeDescription(card.description ?? '') !== undefined).length;
  const min = column.reverseWip ?? null;
  return {
    defined,
    min,
    under: min !== null && defined < min,
  };
}

export function calculateCardPosition(bounds: PositionBounds): number {
  const step = 1000;
  const { previous, next } = bounds;

  if (previous === undefined && next === undefined) {
    return step;
  }
  if (previous === undefined) {
    return (next ?? step) - step;
  }
  if (next === undefined) {
    return previous + step;
  }
  return previous + (next - previous) / 2;
}
