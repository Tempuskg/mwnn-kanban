import * as assert from 'node:assert/strict';
import * as path from 'node:path/posix';
import { suite, test } from 'node:test';
import {
  BOARD_FILE_VERSION,
  parseCard,
  parseColumns,
  serializeCard,
  serializeColumns,
  type CardDocument,
  type ColumnsDocument,
} from '../../src/serialization';
import {
  createBoardStore,
  type BoardStoreDeps,
  type FileSystemLike,
  type MementoLike,
} from '../../src/boardStore';

function fakeMemento(initial: Record<string, unknown> = {}): MementoLike {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    get<T>(key: string): T | undefined {
      return data.get(key) as T | undefined;
    },
    update(key: string, value: unknown): void {
      data.set(key, value);
    },
  };
}

function createFakeFileSystem(initialFiles: Record<string, string> = {}): FileSystemLike & { snapshot(): Map<string, string> } {
  const files = new Map<string, string>(Object.entries(initialFiles));
  const directories = new Set<string>(['.']);

  const ensureDirectory = (directory: string): void => {
    const normalized = normalizePath(directory);
    if (normalized === '.') {
      directories.add(normalized);
      return;
    }

    const parent = path.dirname(normalized);
    if (parent !== normalized) {
      ensureDirectory(parent);
    }
    directories.add(normalized);
  };

  for (const filePath of files.keys()) {
    ensureDirectory(path.dirname(normalizePath(filePath)));
  }

  return {
    async exists(targetPath: string): Promise<boolean> {
      const normalized = normalizePath(targetPath);
      return files.has(normalized) || directories.has(normalized);
    },
    async readFile(targetPath: string): Promise<string> {
      const normalized = normalizePath(targetPath);
      const file = files.get(normalized);
      if (file === undefined) {
        throw new Error(`Missing file: ${normalized}`);
      }
      return file;
    },
    async writeFile(targetPath: string, content: string): Promise<void> {
      const normalized = normalizePath(targetPath);
      ensureDirectory(path.dirname(normalized));
      files.set(normalized, content);
    },
    async deleteFile(targetPath: string): Promise<void> {
      files.delete(normalizePath(targetPath));
    },
    async readDirectory(targetPath: string): Promise<readonly string[]> {
      const normalized = normalizePath(targetPath);
      if (!directories.has(normalized)) {
        throw new Error(`Missing directory: ${normalized}`);
      }

      const entries = new Set<string>();
      for (const directory of directories) {
        if (directory === normalized || !directory.startsWith(`${normalized}/`)) {
          continue;
        }

        const remainder = directory.slice(normalized.length + 1);
        if (!remainder.includes('/')) {
          entries.add(remainder);
        }
      }

      for (const filePath of files.keys()) {
        if (!filePath.startsWith(`${normalized}/`)) {
          continue;
        }

        const remainder = filePath.slice(normalized.length + 1);
        if (!remainder.includes('/')) {
          entries.add(remainder);
        }
      }

      return [...entries];
    },
    async createDirectory(targetPath: string): Promise<void> {
      ensureDirectory(targetPath);
    },
    snapshot(): Map<string, string> {
      return new Map(files);
    },
  };
}

function normalizePath(targetPath: string): string {
  const normalized = path.normalize(targetPath);
  return normalized === '' ? '.' : normalized;
}

function createDeps(overrides: Partial<BoardStoreDeps> = {}): BoardStoreDeps {
  return {
    fileSystem: createFakeFileSystem(),
    boardFolder: '.mwnn',
    defaultColumns: ['Backlog', 'Ready', 'Done'],
    defaultReadyReverseWip: 3,
    ...overrides,
  };
}

suite('board store', () => {
  test('initializes from default columns and writes the board files when storage is empty', async () => {
    const fileSystem = createFakeFileSystem();
    const store = await createBoardStore(createDeps({ fileSystem, defaultColumns: ['A', 'Ready', 'Done'] }));

    assert.deepEqual(
      store.getState().columns.map((column) => column.title),
      ['A', 'Ready', 'Done'],
    );

    const columnsDocument = parseColumns(fileSystem.snapshot().get('.mwnn/columns.json') ?? '');
    assert.equal(columnsDocument.version, BOARD_FILE_VERSION);
    assert.equal(columnsDocument.columns[1]!.reverseWip, 3);
  });

  test('persists added cards as markdown files and reloads them from disk', async () => {
    const fileSystem = createFakeFileSystem();
    const store = await createBoardStore(createDeps({ fileSystem, defaultColumns: ['To Do'] }));
    const columnId = store.getState().columns[0]!.id;

    await store.addCard(columnId, 'Task');

    const snapshot = fileSystem.snapshot();
    const cardFile = [...snapshot.keys()].find((filePath) => filePath.startsWith('.mwnn/cards/'));
    assert.ok(cardFile, 'expected a card markdown file to be written');

    const reloaded = await createBoardStore(createDeps({ fileSystem, defaultColumns: ['To Do'] }));
    assert.equal(reloaded.getState().columns[0]!.cards[0]!.title, 'Task');

    const parsedCard = parseCard(snapshot.get(cardFile!) ?? '');
    assert.equal(parsedCard.columnId, columnId);
  });

  test('loads existing file-backed cards in their persisted order', async () => {
    const columnsDocument: ColumnsDocument = {
      version: BOARD_FILE_VERSION,
      columns: [{ id: 'col-ready', title: 'Ready', role: 'ready', wipLimit: null, reverseWip: 3 }],
    };
    const firstCard: CardDocument = {
      columnId: 'col-ready',
      position: 1000,
      card: { id: 'card-a', title: 'A', createdAt: 1 },
    };
    const secondCard: CardDocument = {
      columnId: 'col-ready',
      position: 2000,
      card: { id: 'card-b', title: 'B', createdAt: 2 },
    };

    const fileSystem = createFakeFileSystem({
      '.mwnn/columns.json': serializeColumns(columnsDocument),
      '.mwnn/cards/card-b.md': serializeCard(secondCard),
      '.mwnn/cards/card-a.md': serializeCard(firstCard),
    });

    const store = await createBoardStore(createDeps({ fileSystem }));
    assert.deepEqual(
      store.getState().columns[0]!.cards.map((card) => card.title),
      ['A', 'B'],
    );
  });

  test('migrates a legacy memento board into the file-backed format', async () => {
    const fileSystem = createFakeFileSystem();
    const legacyMemento = fakeMemento({
      'mwnn-kanban.board': {
        version: 1,
        columns: [
          {
            id: 'col-backlog',
            title: 'Backlog',
            cards: [{ id: 'card-a', title: 'Legacy task', createdAt: 10 }],
          },
          {
            id: 'col-done',
            title: 'Done',
            cards: [],
          },
        ],
      },
    });

    const store = await createBoardStore(createDeps({ fileSystem, legacyMemento }));

    assert.equal(store.getState().columns[0]!.cards[0]!.title, 'Legacy task');
    const snapshot = fileSystem.snapshot();
    assert.ok(snapshot.has('.mwnn/columns.json'));
    assert.ok([...snapshot.keys()].some((filePath) => filePath.endsWith('card-a.md')));
  });

  test('falls back to default columns when the legacy memento is malformed', async () => {
    const fileSystem = createFakeFileSystem();
    const store = await createBoardStore(
      createDeps({
        fileSystem,
        legacyMemento: fakeMemento({
          'mwnn-kanban.board': { version: 1, columns: [{ bad: true }] },
        }),
        defaultColumns: ['Backlog', 'Done'],
      }),
    );

    assert.deepEqual(
      store.getState().columns.map((column) => column.title),
      ['Backlog', 'Done'],
    );
  });

  test('getState returns a copy that cannot mutate stored state', async () => {
    const store = await createBoardStore(createDeps({ defaultColumns: ['To Do'] }));
    const snapshot = store.getState();
    snapshot.columns[0]!.title = 'Hacked';
    assert.equal(store.getState().columns[0]!.title, 'To Do');
  });

  test('reset restores the default board and deletes card files', async () => {
    const fileSystem = createFakeFileSystem();
    const store = await createBoardStore(createDeps({ fileSystem, defaultColumns: ['To Do'] }));

    await store.addCard(store.getState().columns[0]!.id, 'Task');
    await store.reset();

    assert.equal(store.getState().columns[0]!.cards.length, 0);
    assert.equal(
      [...fileSystem.snapshot().keys()].filter((filePath) => filePath.startsWith('.mwnn/cards/')).length,
      0,
    );
  });
});
