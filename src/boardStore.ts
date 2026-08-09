/**
 * Board persistence. Stores the board as git-trackable files under `.mwnn/`
 * while keeping the in-memory store interface small and injectable for tests.
 */

import * as path from 'node:path/posix';
import {
  BOARD_FILE_VERSION,
  parseCard,
  parseColumns,
  serializeCard,
  serializeColumns,
  type CardDocument,
  type ColumnConfig,
  type ColumnsDocument,
} from './serialization';
import { BOARD_STATE_VERSION, type BoardState, type Card, type Column, type ColumnRole } from './types';
import {
  addCard,
  addColumn,
  appendActivity,
  calculateCardPosition,
  cloneBoard,
  defaultBoard,
  deleteCard,
  duplicateCard,
  editCard,
  enforceBlockedCardPlacement,
  moveCard,
  removeColumn,
  renameColumn,
  reorderColumns,
  setAssignee,
  setAcceptanceCriteria,
  setActivity,
  setColumnConfig,
  setDependencies,
  setDescription,
  type SetColumnConfig,
} from './utils';

const STORAGE_KEY = 'mwnn-kanban.board';
const COLUMNS_FILE = 'columns.json';
const CARDS_DIR = 'cards';
const BOARD_README_FILE = 'README.md';

/** Minimal subset of vscode.Memento needed for legacy migration. */
export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | void;
}

export interface FileSystemLike {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  readDirectory(path: string): Promise<readonly string[]>;
  createDirectory(path: string): Promise<void>;
}

export interface BoardStoreDeps {
  readonly fileSystem: FileSystemLike;
  readonly boardFolder: string;
  readonly defaultColumns: readonly string[];
  readonly defaultReadyReverseWip: number;
  readonly legacyMemento?: MementoLike;
}

export interface BoardStore {
  getState(): BoardState;
  reload(): Promise<BoardState>;
  addColumn(title: string): Promise<BoardState>;
  addCard(columnId: string, title: string): Promise<BoardState>;
  editCard(cardId: string, title: string): Promise<BoardState>;
  duplicateCard(cardId: string): Promise<BoardState>;
  deleteCard(cardId: string): Promise<BoardState>;
  moveCard(cardId: string, toColumnId: string, toIndex: number): Promise<BoardState>;
  setAssignee(cardId: string, assignee: Card['assignee']): Promise<BoardState>;
  setDependencies(cardId: string, dependsOn: readonly string[]): Promise<BoardState>;
  setDescription(cardId: string, description: string): Promise<BoardState>;
  setAcceptanceCriteria(cardId: string, acceptanceCriteria: string): Promise<BoardState>;
  setActivity(cardId: string, activity: string): Promise<BoardState>;
  appendActivity(cardId: string, entry: string): Promise<BoardState>;
  setColumnConfig(columnId: string, config: SetColumnConfig): Promise<BoardState>;
  renameColumn(columnId: string, title: string): Promise<BoardState>;
  removeColumn(columnId: string, targetColumnId?: string): Promise<BoardState>;
  reorderColumns(columnId: string, toIndex: number): Promise<BoardState>;
  reset(): Promise<BoardState>;
}

export async function createBoardStore(deps: BoardStoreDeps): Promise<BoardStore> {
  let state = await loadOrInitializeState(deps);
  await ensureBoardReadme(deps);

  async function refreshFromDisk(): Promise<void> {
    const columnsPath = boardPath(deps.boardFolder, COLUMNS_FILE);
    if (!(await deps.fileSystem.exists(columnsPath))) {
      return;
    }

    try {
      state = await readBoardState(deps);
    } catch {
      // Keep the last known good state if the files are mid-write or invalid.
    }
  }

  // Serialise all commits so that rapid back-to-back messages (e.g. setAssignee
  // followed immediately by moveCard) never race: the second commit's
  // refreshFromDisk always reads the state the first commit already wrote.
  let commitQueue: Promise<unknown> = Promise.resolve();

  // Pull in any external edits (e.g. a hand-off agent appending to a card's
  // Activity section) before applying and writing, so a board mutation never
  // overwrites newer on-disk content with stale in-memory state.
  function commit(apply: (current: BoardState) => BoardState): Promise<BoardState> {
    const next = commitQueue.then(async () => {
      await refreshFromDisk();
      // Keep the "blocked cards can't sit past Ready" invariant after every change:
      // a mutation may have blocked a card that is already in a work column (e.g.
      // adding a dependency), so pull any such card back to Ready before writing.
      state = cloneBoard(enforceBlockedCardPlacement(apply(state)));
      await writeBoardState(deps, state);
      return cloneBoard(state);
    });
    // Swallow errors on the queue tail so a failed commit doesn't stall
    // subsequent ones; errors still propagate to the original caller via `next`.
    commitQueue = next.catch(() => undefined);
    return next;
  }

  // Route reloads through the same queue as commits. A reload triggered by the
  // file watcher (e.g. after a card write) must never run its refreshFromDisk
  // interleaved with an in-flight commit's apply/write, or it can re-read the
  // pre-change disk and clobber the committed state — for instance resurrecting
  // a card the user just deleted right after duplicating it.
  function reload(): Promise<BoardState> {
    const next = commitQueue.then(async () => {
      await refreshFromDisk();
      return cloneBoard(state);
    });
    commitQueue = next.catch(() => undefined);
    return next;
  }

  return {
    getState: () => cloneBoard(state),
    reload,
    addColumn: (title) => commit((current) => addColumn(current, title)),
    addCard: (columnId, title) => commit((current) => addCard(current, columnId, title)),
    editCard: (cardId, title) => commit((current) => editCard(current, cardId, title)),
    duplicateCard: (cardId) => commit((current) => duplicateCard(current, cardId)),
    deleteCard: (cardId) => commit((current) => deleteCard(current, cardId)),
    moveCard: (cardId, toColumnId, toIndex) => commit((current) => moveCard(current, cardId, toColumnId, toIndex)),
    setAssignee: (cardId, assignee) => commit((current) => setAssignee(current, cardId, assignee)),
    setDependencies: (cardId, dependsOn) => commit((current) => setDependencies(current, cardId, dependsOn)),
    setDescription: (cardId, description) => commit((current) => setDescription(current, cardId, description)),
    setAcceptanceCriteria: (cardId, acceptanceCriteria) =>
      commit((current) => setAcceptanceCriteria(current, cardId, acceptanceCriteria)),
    setActivity: (cardId, activity) => commit((current) => setActivity(current, cardId, activity)),
    appendActivity: (cardId, entry) => commit((current) => appendActivity(current, cardId, entry)),
    setColumnConfig: (columnId, config) => commit((current) => setColumnConfig(current, columnId, config)),
    renameColumn: (columnId, title) => commit((current) => renameColumn(current, columnId, title)),
    removeColumn: (columnId, targetColumnId) => commit((current) => removeColumn(current, columnId, targetColumnId)),
    reorderColumns: (columnId, toIndex) => commit((current) => reorderColumns(current, columnId, toIndex)),
    reset: () => commit(() => createInitialBoard(deps.defaultColumns, deps.defaultReadyReverseWip)),
  };
}

async function loadOrInitializeState(deps: BoardStoreDeps): Promise<BoardState> {
  const columnsPath = boardPath(deps.boardFolder, COLUMNS_FILE);
  if (await deps.fileSystem.exists(columnsPath)) {
    try {
      return await readBoardState(deps);
    } catch {
      const fallback = await migrateOrCreateDefaultState(deps);
      await writeBoardState(deps, fallback);
      return fallback;
    }
  }

  const initialized = await migrateOrCreateDefaultState(deps);
  await writeBoardState(deps, initialized);
  return initialized;
}

async function migrateOrCreateDefaultState(deps: BoardStoreDeps): Promise<BoardState> {
  const legacyState = deps.legacyMemento?.get<unknown>(STORAGE_KEY);
  if (isLegacyBoardState(legacyState)) {
    return migrateLegacyBoard(legacyState, deps.defaultReadyReverseWip);
  }

  return createInitialBoard(deps.defaultColumns, deps.defaultReadyReverseWip);
}

function createInitialBoard(defaultColumns: readonly string[], defaultReadyReverseWip: number): BoardState {
  return applyInitialColumnMetadata(defaultBoard(defaultColumns), defaultReadyReverseWip);
}

async function readBoardState(deps: BoardStoreDeps): Promise<BoardState> {
  const columnsDocument = parseColumns(await deps.fileSystem.readFile(boardPath(deps.boardFolder, COLUMNS_FILE)));
  const cardDocuments = await readCardDocuments(deps);

  const cardsByColumn = new Map<string, CardDocument[]>();
  for (const document of cardDocuments) {
    const existing = cardsByColumn.get(document.columnId) ?? [];
    existing.push(document);
    cardsByColumn.set(document.columnId, existing);
  }

  const columns = columnsDocument.columns.map((config) => materializeColumn(config, cardsByColumn.get(config.id) ?? []));
  const knownColumnIds = new Set(columns.map((column) => column.id));
  for (const [columnId, documents] of cardsByColumn.entries()) {
    if (knownColumnIds.has(columnId)) {
      continue;
    }

    columns.push({
      id: columnId,
      title: columnId,
      role: 'custom',
      wipLimit: null,
      reverseWip: null,
      cards: sortCardDocuments(documents).map((document) => cloneCard(document.card)),
    });
  }

  return {
    version: BOARD_STATE_VERSION,
    columns,
  };
}

async function readCardDocuments(deps: BoardStoreDeps): Promise<CardDocument[]> {
  const cardsDirectory = boardPath(deps.boardFolder, CARDS_DIR);
  if (!(await deps.fileSystem.exists(cardsDirectory))) {
    return [];
  }

  const names = await deps.fileSystem.readDirectory(cardsDirectory);
  const documents: CardDocument[] = [];
  for (const name of names) {
    if (!name.endsWith('.md')) {
      continue;
    }

    const content = await deps.fileSystem.readFile(boardPath(deps.boardFolder, CARDS_DIR, name));
    documents.push(parseCard(content));
  }
  return documents;
}

async function writeBoardState(deps: BoardStoreDeps, state: BoardState): Promise<void> {
  await deps.fileSystem.createDirectory(boardPath(deps.boardFolder));
  await deps.fileSystem.createDirectory(boardPath(deps.boardFolder, CARDS_DIR));
  await ensureBoardReadme(deps);

  const columnsDocument: ColumnsDocument = {
    version: BOARD_FILE_VERSION,
    columns: state.columns.map((column) => toColumnConfig(column)),
  };
  await deps.fileSystem.writeFile(
    boardPath(deps.boardFolder, COLUMNS_FILE),
    serializeColumns(columnsDocument),
  );

  const existingCardNames = await deps.fileSystem.readDirectory(boardPath(deps.boardFolder, CARDS_DIR));
  const existingCardFiles = new Set(existingCardNames.filter((name) => name.endsWith('.md')));
  const existingDocuments = await readCardDocuments(deps);
  const nextCardIds = new Set<string>();
  for (const document of buildCardDocuments(state, existingDocuments)) {
    nextCardIds.add(document.card.id);
    const fileName = `${document.card.id}.md`;
    const cardPath = boardPath(deps.boardFolder, CARDS_DIR, fileName);
    const serialized = serializeCard(document);

    // Skip files whose content is identical so we don't rewrite (and trip the
    // file watcher on) cards an external editor or agent just touched.
    if (existingCardFiles.has(fileName) && (await deps.fileSystem.readFile(cardPath)) === serialized) {
      continue;
    }

    await deps.fileSystem.writeFile(cardPath, serialized);
  }

  for (const name of existingCardNames) {
    if (!name.endsWith('.md')) {
      continue;
    }

    const cardId = name.slice(0, -3);
    if (!nextCardIds.has(cardId)) {
      await deps.fileSystem.deleteFile(boardPath(deps.boardFolder, CARDS_DIR, name));
    }
  }
}

async function ensureBoardReadme(deps: BoardStoreDeps): Promise<void> {
  const readmePath = boardPath(deps.boardFolder, BOARD_README_FILE);
  if (await deps.fileSystem.exists(readmePath)) {
    return;
  }

  await deps.fileSystem.createDirectory(boardPath(deps.boardFolder));
  await deps.fileSystem.writeFile(readmePath, buildBoardReadme());
}

interface PositionEntry {
  readonly card: Card;
  existing?: CardDocument;
  position?: number;
}

const CARD_POSITION_STEP = 1000;

function buildCardDocuments(state: BoardState, existingDocuments: readonly CardDocument[] = []): CardDocument[] {
  const existingById = new Map<string, CardDocument>();
  for (const document of existingDocuments) {
    if (!existingById.has(document.card.id)) {
      existingById.set(document.card.id, document);
    }
  }

  const documents: CardDocument[] = [];
  for (const column of state.columns) {
    const entries: PositionEntry[] = column.cards.map((card) => {
      const existing = existingById.get(card.id);
      const entry: PositionEntry = { card };
      if (existing !== undefined) {
        entry.existing = existing;
      }
      return entry;
    });

    preserveExistingPositions(entries, column.id);
    assignUnplacedPositions(entries);

    for (const entry of entries) {
      const position = entry.position;
      if (position === undefined || !Number.isFinite(position)) {
        throw new Error(`Unable to assign a finite position to card ${entry.card.id}.`);
      }
      documents.push({
        columnId: column.id,
        position,
        card: cloneCard(entry.card),
      });
    }
  }
  return documents;
}

/**
 * Preserve the largest ordered subset of existing cards. This keeps a normal
 * insertion local to the new card while still giving a deterministic repair
 * path when an existing board contains duplicate or out-of-order positions.
 */
function preserveExistingPositions(entries: PositionEntry[], columnId: string): void {
  const lengths = entries.map(() => 0);
  const predecessors = entries.map(() => -1);
  let bestEnd = -1;
  let bestLength = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const existing = entry?.existing;
    if (!entry || !existing || existing.columnId !== columnId || !Number.isFinite(existing.position)) {
      continue;
    }

    lengths[index] = 1;
    for (let previous = 0; previous < index; previous += 1) {
      const previousEntry = entries[previous];
      const previousExisting = previousEntry?.existing;
      const previousLength = lengths[previous] ?? 0;
      const currentLength = lengths[index] ?? 0;
      if (
        previousLength > 0 &&
        previousExisting !== undefined &&
        previousExisting.columnId === columnId &&
        previousExisting.position < existing.position &&
        previousLength + 1 > currentLength
      ) {
        lengths[index] = previousLength + 1;
        predecessors[index] = previous;
      }
    }

    // Keep the first equally long sequence so repairs are stable across runs.
    const currentLength = lengths[index] ?? 0;
    if (currentLength > bestLength) {
      bestLength = currentLength;
      bestEnd = index;
    }
  }

  let index = bestEnd;
  while (index !== -1) {
    const entry = entries[index];
    const existing = entry?.existing;
    if (!entry || !existing) {
      break;
    }
    entry.position = existing.position;
    index = predecessors[index] ?? -1;
  }
}

function assignUnplacedPositions(entries: PositionEntry[]): void {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.position !== undefined) {
      continue;
    }

    let previousIndex = findPreviousPositionIndex(entries, index);
    let nextIndex = findNextPositionIndex(entries, index);
    let candidate = calculatePositionBetween(entries, previousIndex, nextIndex);

    if (!isUsablePosition(candidate, entries, previousIndex, nextIndex)) {
      const rebalancedWholeColumn = rebalanceForGap(entries, index, previousIndex, nextIndex);
      if (rebalancedWholeColumn) {
        continue;
      }

      previousIndex = findPreviousPositionIndex(entries, index);
      nextIndex = findNextPositionIndex(entries, index);
      candidate = calculatePositionBetween(entries, previousIndex, nextIndex);
    }

    if (!isUsablePosition(candidate, entries, previousIndex, nextIndex)) {
      rebalanceWholeColumn(entries);
      continue;
    }

    entry.position = candidate;
  }
}

function findPreviousPositionIndex(entries: readonly PositionEntry[], index: number): number | undefined {
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    if (entries[previous]?.position !== undefined) {
      return previous;
    }
  }
  return undefined;
}

function findNextPositionIndex(entries: readonly PositionEntry[], index: number): number | undefined {
  for (let next = index + 1; next < entries.length; next += 1) {
    if (entries[next]?.position !== undefined) {
      return next;
    }
  }
  return undefined;
}

function calculatePositionBetween(
  entries: readonly PositionEntry[],
  previousIndex: number | undefined,
  nextIndex: number | undefined,
): number {
  const previous = previousIndex === undefined ? undefined : entries[previousIndex]?.position;
  const next = nextIndex === undefined ? undefined : entries[nextIndex]?.position;

  if (previous === undefined && next === undefined) {
    return calculateCardPosition({});
  }
  if (previous === undefined) {
    return calculateCardPosition({ next: next as number });
  }
  if (next === undefined) {
    return calculateCardPosition({ previous });
  }
  return calculateCardPosition({ previous, next });
}

function isUsablePosition(
  candidate: number,
  entries: readonly PositionEntry[],
  previousIndex: number | undefined,
  nextIndex: number | undefined,
): boolean {
  if (!Number.isFinite(candidate)) {
    return false;
  }

  const previous = previousIndex === undefined ? undefined : entries[previousIndex]?.position;
  const next = nextIndex === undefined ? undefined : entries[nextIndex]?.position;
  if (previous !== undefined && candidate <= previous) {
    return false;
  }
  if (next !== undefined && candidate >= next) {
    return false;
  }

  return !entries.some((entry) => entry.position === candidate);
}

/**
 * Shift the smaller side of an exhausted interval to create room for the
 * pending cards. A full-column rebalance is reserved for numeric overflow or
 * an interval that cannot be repaired locally.
 */
function rebalanceForGap(
  entries: PositionEntry[],
  index: number,
  previousIndex: number | undefined,
  nextIndex: number | undefined,
): boolean {
  const previous = previousIndex === undefined ? undefined : entries[previousIndex]?.position;
  const next = nextIndex === undefined ? undefined : entries[nextIndex]?.position;
  if (previous === undefined || next === undefined || previousIndex === undefined || nextIndex === undefined) {
    rebalanceWholeColumn(entries);
    return true;
  }

  const requiredGap = CARD_POSITION_STEP * (nextIndex - index + 1);
  const leftAffected = previousIndex + 1;
  const rightAffected = entries.length - nextIndex;

  if (rightAffected <= leftAffected) {
    const targetNext = previous + requiredGap;
    const delta = targetNext - next;
    if (!Number.isFinite(delta) || delta <= 0) {
      rebalanceWholeColumn(entries);
      return true;
    }
    shiftDefinedPositions(entries, nextIndex, entries.length - 1, delta);
    return false;
  }

  const targetPrevious = next - requiredGap;
  const delta = targetPrevious - previous;
  if (!Number.isFinite(delta) || delta >= 0) {
    rebalanceWholeColumn(entries);
    return true;
  }
  shiftDefinedPositions(entries, 0, previousIndex, delta);
  return false;
}

function shiftDefinedPositions(entries: PositionEntry[], start: number, end: number, delta: number): void {
  for (let index = start; index <= end; index += 1) {
    const entry = entries[index];
    if (!entry || entry.position === undefined) {
      continue;
    }
    entry.position += delta;
  }
}

function rebalanceWholeColumn(entries: PositionEntry[]): void {
  let position = CARD_POSITION_STEP;
  for (const entry of entries) {
    entry.position = position;
    position += CARD_POSITION_STEP;
  }
}

function materializeColumn(config: ColumnConfig, documents: readonly CardDocument[]): Column {
  const column: Column = {
    id: config.id,
    title: config.title,
    cards: sortCardDocuments(documents).map((document) => cloneCard(document.card)),
  };
  if (config.role !== undefined) {
    column.role = config.role;
  }
  if (config.wipLimit !== undefined) {
    column.wipLimit = config.wipLimit;
  }
  if (config.reverseWip !== undefined) {
    column.reverseWip = config.reverseWip;
  }
  return column;
}

function toColumnConfig(column: Column): ColumnConfig {
  const config: ColumnConfig = {
    id: column.id,
    title: column.title,
  };
  if (column.role !== undefined) {
    config.role = column.role;
  }
  if (column.wipLimit !== undefined) {
    config.wipLimit = column.wipLimit;
  }
  if (column.reverseWip !== undefined) {
    config.reverseWip = column.reverseWip;
  }
  return config;
}

function sortCardDocuments(documents: readonly CardDocument[]): CardDocument[] {
  return [...documents].sort((left, right) => {
    const positionOrder = left.position - right.position;
    return positionOrder !== 0 ? positionOrder : left.card.id.localeCompare(right.card.id);
  });
}

function boardPath(boardFolder: string, ...segments: string[]): string {
  return path.join(boardFolder, ...segments);
}

function buildBoardReadme(): string {
  return [
    '# MWNN Kanban board files',
    '',
    'This folder is the source of truth for the MWNN Kanban board in this workspace.',
    '',
    '## Files',
    '',
    '- `columns.json` stores the ordered column layout, roles, and WIP or reverse-WIP limits.',
    '- `cards/<card-id>.md` stores one card per markdown file with frontmatter for column, position, assignee, dependencies (`dependsOn`), and timestamps.',
    '- `README.md` documents the contract for humans and AI agents editing the board directly.',
    '',
    '## Card workflow',
    '',
    '1. Find work in `cards/*.md`, usually filtering for `assignee: { kind: ai, ... }` when an AI agent is involved.',
    '2. Add or update the `## Activity` section to claim work and report progress.',
    '3. Update the `## Description` and `## Acceptance criteria` sections as the slice becomes better defined or completes.',
    '4. Move a card by editing its `column` and `position` frontmatter values.',
    '5. Respect column `wipLimit` values and the Ready column `reverseWip` minimum from `columns.json`.',
    '',
    'The extension watches this folder and reloads the board after external edits.',
    '',
  ].join('\n');
}

function cloneCard(card: Card): Card {
  const clone: Card = {
    id: card.id,
    title: card.title,
    createdAt: card.createdAt,
  };
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
    clone.assignee = card.assignee.name
      ? { kind: card.assignee.kind, name: card.assignee.name }
      : { kind: card.assignee.kind };
  }
  if (card.dependsOn !== undefined) {
    clone.dependsOn = [...card.dependsOn];
  }
  return clone;
}

function applyInitialColumnMetadata(state: BoardState, defaultReadyReverseWip: number): BoardState {
  const next = cloneBoard(state);
  const readyIndex = findReadyIndex(next.columns);

  next.columns = next.columns.map((column, index) => {
    const role = column.role ?? inferMigrationRole(next.columns, index, readyIndex);
    const configured: Column = {
      id: column.id,
      title: column.title,
      cards: column.cards.map(cloneCard),
      role,
      wipLimit: column.wipLimit ?? null,
      reverseWip: column.reverseWip ?? null,
    };

    if (configured.role === 'ready' && configured.reverseWip === null) {
      configured.reverseWip = defaultReadyReverseWip;
    }

    return configured;
  });

  return next;
}

interface LegacyCardV1 {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
}

interface LegacyColumnV1 {
  readonly id: string;
  readonly title: string;
  readonly cards: LegacyCardV1[];
}

interface LegacyBoardStateV1 {
  readonly version: 1;
  readonly columns: LegacyColumnV1[];
}

function isLegacyBoardState(value: unknown): value is LegacyBoardStateV1 {
  if (!isRecord(value) || value['version'] !== 1 || !Array.isArray(value['columns'])) {
    return false;
  }

  return value['columns'].every((column) => {
    if (!isRecord(column) || typeof column['id'] !== 'string' || typeof column['title'] !== 'string') {
      return false;
    }

    return (
      Array.isArray(column['cards']) &&
      column['cards'].every(
        (card) =>
          isRecord(card) &&
          typeof card['id'] === 'string' &&
          typeof card['title'] === 'string' &&
          typeof card['createdAt'] === 'number',
      )
    );
  });
}

function migrateLegacyBoard(legacy: LegacyBoardStateV1, defaultReadyReverseWip: number): BoardState {
  const readyIndex = findReadyIndex(legacy.columns);
  return {
    version: BOARD_STATE_VERSION,
    columns: legacy.columns.map((column, index) => {
      const role = inferMigrationRole(legacy.columns, index, readyIndex);
      return {
        id: column.id,
        title: column.title,
        role,
        wipLimit: null,
        reverseWip: role === 'ready' ? defaultReadyReverseWip : null,
        cards: column.cards.map((card) => ({
          id: card.id,
          title: card.title,
          createdAt: card.createdAt,
          updatedAt: card.createdAt,
        })),
      };
    }),
  };
}

function findReadyIndex(columns: readonly { title: string }[]): number | undefined {
  const namedReadyIndex = columns.findIndex((column) => /ready/i.test(column.title));
  if (namedReadyIndex !== -1) {
    return namedReadyIndex;
  }
  if (columns.length >= 3) {
    return 1;
  }
  return undefined;
}

function inferMigrationRole(
  columns: readonly { title: string }[],
  index: number,
  readyIndex: number | undefined,
): ColumnRole {
  const normalized = columns[index]?.title.trim().toLowerCase() ?? '';
  if (normalized.includes('backlog') || normalized === 'todo' || normalized.includes('to do')) {
    return 'backlog';
  }
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
  if (index === 0) {
    return 'backlog';
  }
  if (index === readyIndex) {
    return 'ready';
  }
  if (index === columns.length - 1) {
    return 'done';
  }
  return 'in-progress';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
