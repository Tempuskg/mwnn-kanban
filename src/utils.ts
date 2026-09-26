/**
 * Pure board operations. No `vscode` or Node imports here so these stay
 * trivially unit-testable and reusable from either side of the protocol.
 */

import {
  AGENT_CLI_PROVIDER_IDS,
  BOARD_STATE_VERSION,
  isAgentCliProviderId,
  type AgentCliProviderId,
  type Assignee,
  type BoardState,
  type Card,
  type CardPreferredModels,
  type CardThinkingLevels,
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
  const preferredModels = clonePreferredModels(card.preferredModels);
  if (preferredModels !== undefined) {
    clone.preferredModels = preferredModels;
  }
  const thinkingLevels = cloneThinkingLevels(card.thinkingLevels);
  if (thinkingLevels !== undefined) {
    clone.thinkingLevels = thinkingLevels;
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

/**
 * Compared entry by entry over the fixed provider list rather than by key
 * count, so a map that gained or lost one provider is detected and the edit
 * actually publishes to the webview.
 */
function preferredModelsEqual(
  left: CardPreferredModels | undefined,
  right: CardPreferredModels | undefined,
): boolean {
  return AGENT_CLI_PROVIDER_IDS.every((provider) => left?.[provider] === right?.[provider]);
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
    preferredModelsEqual(left.preferredModels, right.preferredModels) &&
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
    const copiedModels = clonePreferredModels(original.preferredModels);
    if (copiedModels !== undefined) {
      copy.preferredModels = copiedModels;
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

/**
 * Control characters cannot reach a CLI as one literal argument - a newline in
 * particular is silently truncated by a cmd.exe shim - so a value containing
 * one is unusable. Checked by code point rather than by a regular expression so
 * this source file stays free of control characters itself.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Shared normalization for the card's preferred model, used by both the parser
 * and the board mutations so a value that survives an edit also survives a
 * reload. Returns undefined for anything that cannot be passed to a CLI as a
 * single argument.
 */
export function normalizePreferredModel(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || hasControlCharacter(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/**
 * Validate a whole per-provider model map: unknown provider keys and values
 * that are blank, whitespace-only, or otherwise unusable as a single spawn
 * argument are dropped rather than stored, and a map left with no entries
 * becomes undefined so the property is omitted entirely.
 *
 * Shared by the card-file parser, the board mutations, and the store so a value
 * that survives an edit also survives a reload.
 */
export function normalizeCardPreferredModels(
  value: CardPreferredModels | undefined,
): CardPreferredModels | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized: CardPreferredModels = {};
  let count = 0;
  for (const [provider, model] of Object.entries(value)) {
    // Only known providers are read, which is what makes an unknown key a no-op
    // rather than an error: a stale or misspelled key simply never matches.
    if (!isAgentCliProviderId(provider)) {
      continue;
    }
    const usable = normalizePreferredModel(typeof model === 'string' ? model : undefined);
    if (usable === undefined) {
      continue;
    }
    normalized[provider] = usable;
    count += 1;
  }
  return count > 0 ? normalized : undefined;
}

function clonePreferredModels(
  value: CardPreferredModels | undefined,
): CardPreferredModels | undefined {
  return normalizeCardPreferredModels(value);
}

/**
 * Shared normalization for a thinking level. The same rule the preferred model
 * gets, and deliberately the same function underneath: both are free-form
 * values that have to survive as a *single* spawn argument, so a blank,
 * whitespace-only, or control-character value is "not set" rather than an
 * error. Named separately so call sites read as what they normalize.
 */
export function normalizeThinkingLevel(value: string | undefined): string | undefined {
  return normalizePreferredModel(value);
}

/**
 * Validate a whole per-provider thinking-level map, exactly as
 * {@link normalizeCardPreferredModels} validates the model map: unknown
 * provider keys and unusable values are dropped rather than stored, and a map
 * left with no entries becomes undefined so the property is omitted entirely.
 */
export function normalizeCardThinkingLevels(
  value: CardThinkingLevels | undefined,
): CardThinkingLevels | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized: CardThinkingLevels = {};
  let count = 0;
  for (const [provider, level] of Object.entries(value)) {
    // Only known providers are read, which is what makes an unknown key a no-op
    // rather than an error: a stale or misspelled key simply never matches.
    if (!isAgentCliProviderId(provider)) {
      continue;
    }
    const usable = normalizeThinkingLevel(typeof level === 'string' ? level : undefined);
    if (usable === undefined) {
      continue;
    }
    normalized[provider] = usable;
    count += 1;
  }
  return count > 0 ? normalized : undefined;
}

function cloneThinkingLevels(
  value: CardThinkingLevels | undefined,
): CardThinkingLevels | undefined {
  return normalizeCardThinkingLevels(value);
}

/**
 * The model this card names for the provider a dispatch is actually running
 * on, or undefined when it names none for that CLI.
 *
 * Every dispatch path reads the card through here, so a provider the card says
 * nothing about falls through to the workspace layers and then to that CLI's
 * own default — and a provider the credit fallback swapped in picks up its own
 * entry instead of inheriting the exhausted CLI's model, which it would reject.
 */
export function cardPreferredModelFor(
  card: Pick<Card, 'preferredModels'>,
  provider: AgentCliProviderId,
): string | undefined {
  return normalizePreferredModel(card.preferredModels?.[provider]);
}

/**
 * Set (or clear) the AI model a card should be run with **on one provider**.
 * The value is free-form and passed straight through to that agent CLI, so it
 * is only normalized here: anything unusable as a single spawn argument clears
 * that provider's entry, a cleared entry is removed rather than written as an
 * empty value, and a card left with no entries loses the property entirely.
 *
 * Scoped to one provider so editing the model for one CLI never disturbs what
 * the card names for the other three.
 */
export function setPreferredModel(
  state: BoardState,
  cardId: string,
  provider: AgentCliProviderId,
  preferredModel: string | undefined,
): BoardState {
  const next = cloneBoard(state);
  const normalized = normalizePreferredModel(preferredModel);
  for (const column of next.columns) {
    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      // Rebuilt over the fixed provider list rather than mutated in place, so
      // the only entry this edit can touch is the one it names.
      const models: CardPreferredModels = {};
      for (const known of AGENT_CLI_PROVIDER_IDS) {
        const model = known === provider ? normalized : card.preferredModels?.[known];
        if (model !== undefined) {
          models[known] = model;
        }
      }
      const remaining = normalizeCardPreferredModels(models);
      if (remaining !== undefined) {
        card.preferredModels = remaining;
      } else {
        delete card.preferredModels;
      }
      card.updatedAt = Date.now();
      break;
    }
  }
  return next;
}

/**
 * The thinking level this card names for the provider a dispatch is actually
 * running on, or undefined when it names none for that CLI.
 *
 * The level's read path mirrors the model's exactly, so a provider the credit
 * fallback swapped in picks up its own level rather than inheriting one spelled
 * for the CLI whose allowance ran out.
 */
export function cardThinkingLevelFor(
  card: Pick<Card, 'thinkingLevels'>,
  provider: AgentCliProviderId,
): string | undefined {
  return normalizeThinkingLevel(card.thinkingLevels?.[provider]);
}

/**
 * Set (or clear) the thinking level a card should be run at **on one
 * provider**. Free-form and passed straight through to that agent CLI, so it is
 * only normalized here: anything unusable as a single spawn argument clears
 * that provider's entry, a cleared entry is removed rather than written as an
 * empty value, and a card left with no entries loses the property entirely.
 *
 * Scoped to one provider so editing the level for one CLI never disturbs what
 * the card names for the other three - and independent of the model, so
 * changing one never rewrites the other.
 */
export function setThinkingLevel(
  state: BoardState,
  cardId: string,
  provider: AgentCliProviderId,
  thinkingLevel: string | undefined,
): BoardState {
  const next = cloneBoard(state);
  const normalized = normalizeThinkingLevel(thinkingLevel);
  for (const column of next.columns) {
    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      // Rebuilt over the fixed provider list rather than mutated in place, so
      // the only entry this edit can touch is the one it names.
      const levels: CardThinkingLevels = {};
      for (const known of AGENT_CLI_PROVIDER_IDS) {
        const level = known === provider ? normalized : card.thinkingLevels?.[known];
        if (level !== undefined) {
          levels[known] = level;
        }
      }
      const remaining = normalizeCardThinkingLevels(levels);
      if (remaining !== undefined) {
        card.thinkingLevels = remaining;
      } else {
        delete card.thinkingLevels;
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
