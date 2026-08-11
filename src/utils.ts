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
const FALLBACK_COLUMN_TITLES = ['Backlog', 'Ready', 'In Progress', 'Verify', 'Done'] as const;

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
  if (normalized.includes('verify')) {
    return 'verify';
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
  if (card.dependsOn !== undefined) {
    clone.dependsOn = [...card.dependsOn];
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

function orderedArraysEqual<T>(
  left: readonly T[],
  right: readonly T[],
  valuesEqual: (leftValue: T, rightValue: T) => boolean,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => {
    const rightValue = right[index];
    return rightValue !== undefined && valuesEqual(value, rightValue);
  });
}

function assigneesEqual(left: Assignee | undefined, right: Assignee | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return left.kind === right.kind && left.name === right.name;
}

function dependenciesEqual(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return orderedArraysEqual(left, right, (leftId, rightId) => leftId === rightId);
}

function cardsEqual(left: Card, right: Card): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.description === right.description &&
    left.acceptanceCriteria === right.acceptanceCriteria &&
    left.activity === right.activity &&
    assigneesEqual(left.assignee, right.assignee) &&
    dependenciesEqual(left.dependsOn, right.dependsOn)
  );
}

function columnsEqual(left: Column, right: Column): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.role === right.role &&
    left.wipLimit === right.wipLimit &&
    left.reverseWip === right.reverseWip &&
    orderedArraysEqual(left.cards, right.cards, cardsEqual)
  );
}

/** Compare every persisted board field while preserving column, card, and dependency order. */
export function boardsEqual(left: BoardState, right: BoardState): boolean {
  return left === right || (left.version === right.version && orderedArraysEqual(left.columns, right.columns, columnsEqual));
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

/**
 * Duplicate a card into the same column, immediately after the original. The
 * copy is a brand-new, independent card: it gets its own id and fresh
 * timestamps, its title is suffixed with "(copy)", and it carries over the
 * editable content (description, acceptance criteria, assignee, dependencies).
 * Activity history is intentionally NOT copied so the duplicate starts fresh.
 * No-op if the card is not found.
 */
export function duplicateCard(state: BoardState, cardId: string): BoardState {
  const next = cloneBoard(state);
  for (const column of next.columns) {
    const index = column.cards.findIndex((candidate) => candidate.id === cardId);
    const original = index === -1 ? undefined : column.cards[index];
    if (!original) {
      continue;
    }

    const now = Date.now();
    const copy: Card = {
      id: makeId('card'),
      title: `${original.title} (copy)`,
      createdAt: now,
      updatedAt: now,
    };
    if (original.description !== undefined) {
      copy.description = original.description;
    }
    if (original.acceptanceCriteria !== undefined) {
      copy.acceptanceCriteria = original.acceptanceCriteria;
    }
    if (original.assignee !== undefined) {
      copy.assignee = cloneAssignee(original.assignee);
    }
    if (original.dependsOn !== undefined) {
      copy.dependsOn = [...original.dependsOn];
    }

    column.cards.splice(index + 1, 0, copy);
    break;
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

export function setAcceptanceCriteria(state: BoardState, cardId: string, acceptanceCriteria: string): BoardState {
  const next = cloneBoard(state);
  const normalized = normalizeDescription(acceptanceCriteria);
  for (const column of next.columns) {
    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      if (normalized) {
        card.acceptanceCriteria = normalized;
      } else {
        delete card.acceptanceCriteria;
      }
      card.updatedAt = Date.now();
      break;
    }
  }
  return next;
}

export function setActivity(state: BoardState, cardId: string, activity: string): BoardState {
  const next = cloneBoard(state);
  const normalized = normalizeActivity(activity);
  for (const column of next.columns) {
    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      if (normalized) {
        card.activity = normalized;
      } else {
        delete card.activity;
      }
      card.updatedAt = Date.now();
      break;
    }
  }
  return next;
}

export function appendActivity(state: BoardState, cardId: string, entry: string): BoardState {
  const next = cloneBoard(state);
  const normalized = entry.trim();
  if (normalized.length === 0) {
    return next;
  }

  for (const column of next.columns) {
    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      card.activity = card.activity ? `${card.activity}\n\n${normalized}` : normalized;
      card.updatedAt = Date.now();
      break;
    }
  }
  return next;
}

function normalizeActivity(activity: string): string | undefined {
  const normalized = activity
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*\n+|\n+\s*$/g, '')
    .trimEnd();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Replace a card's dependency list with a normalized set of card ids: the card
 * can never depend on itself, duplicate entries collapse to one, and only ids of
 * cards that still exist on the board are kept. An empty result clears the field.
 */
export function setDependencies(state: BoardState, cardId: string, dependsOn: readonly string[]): BoardState {
  const next = cloneBoard(state);
  const validIds = collectCardIds(next);

  for (const column of next.columns) {
    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (!card) {
      continue;
    }

    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const id of dependsOn) {
      if (id === cardId || !validIds.has(id) || seen.has(id)) {
        continue;
      }
      seen.add(id);
      normalized.push(id);
    }

    if (normalized.length > 0) {
      card.dependsOn = normalized;
    } else {
      delete card.dependsOn;
    }
    card.updatedAt = Date.now();
    break;
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

  // Drop the deleted card from every other card's dependency list so the board
  // never carries a dangling reference to a card that no longer exists.
  for (const column of next.columns) {
    for (const card of column.cards) {
      if (!card.dependsOn?.includes(cardId)) {
        continue;
      }
      const remaining = card.dependsOn.filter((id) => id !== cardId);
      if (remaining.length > 0) {
        card.dependsOn = remaining;
      } else {
        delete card.dependsOn;
      }
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

export function readyState(state: BoardState, column: Column): ReadyState {
  const defined = column.cards.filter(
    (card) => normalizeDescription(card.description ?? '') !== undefined && !isCardBlocked(state, card.id),
  ).length;
  const min = column.reverseWip ?? null;
  return {
    defined,
    min,
    under: min !== null && defined < min,
  };
}

function collectCardIds(state: BoardState): Set<string> {
  const ids = new Set<string>();
  for (const column of state.columns) {
    for (const card of column.cards) {
      ids.add(card.id);
    }
  }
  return ids;
}

/**
 * The ids of a card's dependencies that are not yet complete. A dependency is
 * complete once its card sits in a column with the `done` role; references to
 * cards that no longer exist are ignored so they never read as "blocking".
 */
export function blockingDependencies(state: BoardState, cardId: string): string[] {
  let target: Card | undefined;
  const doneIds = new Set<string>();
  const existingIds = new Set<string>();
  for (const column of state.columns) {
    const done = column.role === 'done';
    for (const card of column.cards) {
      existingIds.add(card.id);
      if (done) {
        doneIds.add(card.id);
      }
      if (card.id === cardId) {
        target = card;
      }
    }
  }

  if (!target?.dependsOn?.length) {
    return [];
  }
  return target.dependsOn.filter((id) => existingIds.has(id) && !doneIds.has(id));
}

/** True when a card has at least one dependency that is not yet in a done column. */
export function isCardBlocked(state: BoardState, cardId: string): boolean {
  return blockingDependencies(state, cardId).length > 0;
}

/**
 * Whether moving a card into the target column is allowed. A blocked card (one
 * with unfinished dependencies) may not advance past the Ready column — it can
 * still sit in Backlog/Ready or be pulled back, and reordering within its own
 * column is always fine. Unblocked cards may move anywhere.
 */
export function canMoveCardToColumn(state: BoardState, cardId: string, toColumnId: string): boolean {
  if (!isCardBlocked(state, cardId)) {
    return true;
  }

  const sourceColumn = state.columns.find((column) => column.cards.some((card) => card.id === cardId));
  if (sourceColumn?.id === toColumnId) {
    return true;
  }

  const targetIndex = state.columns.findIndex((column) => column.id === toColumnId);
  if (targetIndex === -1) {
    return true;
  }

  const readyIndex = state.columns.findIndex((column) => column.role === 'ready');
  if (readyIndex === -1) {
    // No Ready column to anchor against: fall back to role, allowing only the
    // pre-work columns and disallowing in-progress/done/custom work columns.
    const role = state.columns[targetIndex]?.role;
    return role === 'backlog' || role === 'ready';
  }
  return targetIndex <= readyIndex;
}

/**
 * Pull any blocked card that sits past the Ready column back to the end of the
 * Ready column. A card can become blocked while already in a work column (e.g.
 * a dependency was added, or a finished dependency was reopened); this keeps the
 * "blocked cards can't advance past Ready" rule true after every mutation.
 * Returns a board with any such cards relocated; a no-op otherwise.
 */
export function enforceBlockedCardPlacement(state: BoardState): BoardState {
  const readyIndex = state.columns.findIndex((column) => column.role === 'ready');
  if (readyIndex === -1) {
    return cloneBoard(state);
  }

  let next = cloneBoard(state);
  const stranded: string[] = [];
  next.columns.forEach((column, index) => {
    if (index <= readyIndex) {
      return;
    }
    for (const card of column.cards) {
      if (isCardBlocked(next, card.id)) {
        stranded.push(card.id);
      }
    }
  });

  for (const cardId of stranded) {
    const readyColumn = next.columns[readyIndex];
    if (readyColumn) {
      next = moveCard(next, cardId, readyColumn.id, readyColumn.cards.length);
    }
  }
  return next;
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
