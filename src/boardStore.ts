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
  editCard,
  moveCard,
  removeColumn,
  renameColumn,
  reorderColumns,
  setAssignee,
  setAcceptanceCriteria,
  setColumnConfig,
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
  deleteCard(cardId: string): Promise<BoardState>;
  moveCard(cardId: string, toColumnId: string, toIndex: number): Promise<BoardState>;
  setAssignee(cardId: string, assignee: Card['assignee']): Promise<BoardState>;
  setDescription(cardId: string, description: string): Promise<BoardState>;
  setAcceptanceCriteria(cardId: string, acceptanceCriteria: string): Promise<BoardState>;
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

  async function commit(next: BoardState): Promise<BoardState> {
    state = cloneBoard(next);
    await writeBoardState(deps, state);
    return cloneBoard(state);
  }

  async function reload(): Promise<BoardState> {
    const columnsPath = boardPath(deps.boardFolder, COLUMNS_FILE);
    if (!(await deps.fileSystem.exists(columnsPath))) {
      return cloneBoard(state);
    }

    try {
      state = await readBoardState(deps);
    } catch {
      return cloneBoard(state);
    }

    return cloneBoard(state);
  }

  return {
    getState: () => cloneBoard(state),
    reload,
    addColumn: (title) => commit(addColumn(state, title)),
    addCard: (columnId, title) => commit(addCard(state, columnId, title)),
    editCard: (cardId, title) => commit(editCard(state, cardId, title)),
    deleteCard: (cardId) => commit(deleteCard(state, cardId)),
    moveCard: (cardId, toColumnId, toIndex) => commit(moveCard(state, cardId, toColumnId, toIndex)),
    setAssignee: (cardId, assignee) => commit(setAssignee(state, cardId, assignee)),
    setDescription: (cardId, description) => commit(setDescription(state, cardId, description)),
    setAcceptanceCriteria: (cardId, acceptanceCriteria) => commit(setAcceptanceCriteria(state, cardId, acceptanceCriteria)),
    appendActivity: (cardId, entry) => commit(appendActivity(state, cardId, entry)),
    setColumnConfig: (columnId, config) => commit(setColumnConfig(state, columnId, config)),
    renameColumn: (columnId, title) => commit(renameColumn(state, columnId, title)),
    removeColumn: (columnId, targetColumnId) => commit(removeColumn(state, columnId, targetColumnId)),
    reorderColumns: (columnId, toIndex) => commit(reorderColumns(state, columnId, toIndex)),
    reset: () => commit(createInitialBoard(deps.defaultColumns, deps.defaultReadyReverseWip)),
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
  const nextCardIds = new Set<string>();
  for (const document of buildCardDocuments(state)) {
    nextCardIds.add(document.card.id);
    await deps.fileSystem.writeFile(
      boardPath(deps.boardFolder, CARDS_DIR, `${document.card.id}.md`),
      serializeCard(document),
    );
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

function buildCardDocuments(state: BoardState): CardDocument[] {
  const documents: CardDocument[] = [];
  for (const column of state.columns) {
    let previousPosition: number | undefined;
    for (const card of column.cards) {
      const position = previousPosition === undefined
        ? calculateCardPosition({})
        : calculateCardPosition({ previous: previousPosition });
      previousPosition = position;
      documents.push({
        columnId: column.id,
        position,
        card: cloneCard(card),
      });
    }
  }
  return documents;
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
  return [...documents].sort((left, right) => left.position - right.position);
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
    '- `cards/<card-id>.md` stores one card per markdown file with frontmatter for column, position, assignee, and timestamps.',
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
