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

function cardDocuments(snapshot: Map<string, string>): CardDocument[] {
  return [...snapshot.entries()]
    .filter(([filePath]) => filePath.startsWith('.mwnn/cards/') && filePath.endsWith('.md'))
    .map(([, content]) => parseCard(content));
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
    assert.match(fileSystem.snapshot().get('.mwnn/README.md') ?? '', /source of truth/i);
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

  test('duplicateCard persists an independent copy that survives a reload', async () => {
    const fileSystem = createFakeFileSystem();
    const store = await createBoardStore(createDeps({ fileSystem, defaultColumns: ['To Do'] }));
    const columnId = store.getState().columns[0]!.id;

    await store.addCard(columnId, 'Original');
    const cardId = store.getState().columns[0]!.cards[0]!.id;
    await store.setDescription(cardId, 'Some description');
    await store.appendActivity(cardId, 'Original-only activity');

    await store.duplicateCard(cardId);

    const cards = store.getState().columns[0]!.cards;
    assert.equal(cards.length, 2);
    const copy = cards[1]!;
    assert.notEqual(copy.id, cardId);
    assert.equal(copy.title, 'Original (copy)');
    assert.equal(copy.description, 'Some description');
    assert.equal(copy.activity, undefined);

    // A second markdown file is written for the copy.
    const cardFiles = [...fileSystem.snapshot().keys()].filter((filePath) => filePath.startsWith('.mwnn/cards/'));
    assert.equal(cardFiles.length, 2);

    // The copy survives a board reload from disk.
    const reloaded = await createBoardStore(createDeps({ fileSystem, defaultColumns: ['To Do'] }));
    const reloadedCards = reloaded.getState().columns[0]!.cards;
    assert.deepEqual(
      reloadedCards.map((card) => card.title),
      ['Original', 'Original (copy)'],
    );
  });

  test('a watcher reload cannot resurrect a card deleted by an in-flight commit', async () => {
    // Duplicating a card writes a new file, which makes the file watcher
    // schedule a reload. If the user then deletes that copy, the reload must not
    // run interleaved with the delete commit and re-read the pre-delete disk —
    // doing so would clobber the committed state and bring the card back, so it
    // looks like the duplicate "can't be deleted". Hold the delete commit open
    // (mid-write) while a reload runs to force exactly that window.
    const base = createFakeFileSystem();
    let pendingWriteGate: (() => void) | undefined;
    let armWriteGate = false;
    let onGateHit: (() => void) | undefined;
    const fileSystem: FileSystemLike & { snapshot(): Map<string, string> } = {
      ...base,
      async writeFile(targetPath: string, content: string): Promise<void> {
        if (armWriteGate) {
          armWriteGate = false;
          await new Promise<void>((resolve) => {
            pendingWriteGate = resolve;
            onGateHit?.();
          });
        }
        return base.writeFile(targetPath, content);
      },
    };

    const store = await createBoardStore(createDeps({ fileSystem, defaultColumns: ['To Do'] }));
    const columnId = store.getState().columns[0]!.id;
    await store.addCard(columnId, 'Original');
    const cardId = store.getState().columns[0]!.cards[0]!.id;
    await store.duplicateCard(cardId);
    const copyId = store.getState().columns[0]!.cards[1]!.id;

    // Start the delete and suspend it at its first write (after it has already
    // computed the without-the-copy state, but before it removes the copy file).
    const gateHit = new Promise<void>((resolve) => {
      onGateHit = resolve;
    });
    armWriteGate = true;
    const deletePromise = store.deleteCard(copyId);
    await gateHit;

    // While the delete is suspended, a watcher-driven reload runs.
    const reloadPromise = store.reload();

    // Let the delete finish, then settle everything.
    pendingWriteGate?.();
    await Promise.all([deletePromise, reloadPromise]);

    const cards = store.getState().columns[0]!.cards;
    assert.deepEqual(
      cards.map((card) => card.id),
      [cardId],
      'the deleted copy must stay deleted in memory',
    );
    const files = [...fileSystem.snapshot().keys()].filter((filePath) => filePath.startsWith('.mwnn/cards/'));
    assert.equal(files.length, 1, 'the deleted copy must stay deleted on disk');
  });

  test('appendActivity persists markdown activity updates', async () => {
    const fileSystem = createFakeFileSystem();
    const store = await createBoardStore(createDeps({ fileSystem, defaultColumns: ['Ready'] }));
    const columnId = store.getState().columns[0]!.id;

    await store.addCard(columnId, 'Task');
    const cardId = store.getState().columns[0]!.cards[0]!.id;

    await store.appendActivity(cardId, 'First note');
    await store.appendActivity(cardId, 'Second note');

    const snapshot = fileSystem.snapshot();
    const cardFile = [...snapshot.keys()].find((filePath) => filePath.startsWith('.mwnn/cards/'));
    assert.ok(cardFile, 'expected a card markdown file to be written');

    const parsedCard = parseCard(snapshot.get(cardFile!) ?? '');
    assert.equal(parsedCard.card.activity, 'First note\n\nSecond note');
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

  test('preserves existing positions when appending a card', async () => {
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
      '.mwnn/cards/card-a.md': serializeCard(firstCard),
      '.mwnn/cards/card-b.md': serializeCard(secondCard),
    });
    const before = fileSystem.snapshot();
    const store = await createBoardStore(createDeps({ fileSystem }));

    await store.addCard('col-ready', 'C');

    const after = fileSystem.snapshot();
    assert.equal(after.get('.mwnn/cards/card-a.md'), before.get('.mwnn/cards/card-a.md'));
    assert.equal(after.get('.mwnn/cards/card-b.md'), before.get('.mwnn/cards/card-b.md'));
    const positions = cardDocuments(after).map((document) => [document.card.title, document.position]);
    assert.deepEqual(positions.sort((left, right) => String(left[0]).localeCompare(String(right[0]))), [
      ['A', 1000],
      ['B', 2000],
      ['C', 3000],
    ]);
  });

  test('preserves sparse, fractional, and negative positions from an existing board', async () => {
    const columnsDocument: ColumnsDocument = {
      version: BOARD_FILE_VERSION,
      columns: [{ id: 'col-ready', title: 'Ready', role: 'ready', wipLimit: null, reverseWip: 3 }],
    };
    const cards = [
      { columnId: 'col-ready', position: -500.5, card: { id: 'card-a', title: 'A', createdAt: 1 } },
      { columnId: 'col-ready', position: 42.25, card: { id: 'card-b', title: 'B', createdAt: 2 } },
      { columnId: 'col-ready', position: 9000, card: { id: 'card-c', title: 'C', createdAt: 3 } },
    ] satisfies CardDocument[];
    const fileSystem = createFakeFileSystem({
      '.mwnn/columns.json': serializeColumns(columnsDocument),
      ...Object.fromEntries(cards.map((card) => [`.mwnn/cards/${card.card.id}.md`, serializeCard(card)])),
    });
    const before = fileSystem.snapshot();
    const store = await createBoardStore(createDeps({ fileSystem }));

    await store.addCard('col-ready', 'D');

    const after = fileSystem.snapshot();
    for (const card of cards) {
      const filePath = `.mwnn/cards/${card.card.id}.md`;
      assert.equal(after.get(filePath), before.get(filePath));
    }
    assert.equal(cardDocuments(after).find((document) => document.card.title === 'D')?.position, 10000);
  });

  test('assigns only a duplicated card the midpoint position', async () => {
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
      '.mwnn/cards/card-a.md': serializeCard(firstCard),
      '.mwnn/cards/card-b.md': serializeCard(secondCard),
    });
    const before = fileSystem.snapshot();
    const store = await createBoardStore(createDeps({ fileSystem }));

    await store.duplicateCard('card-a');

    const after = fileSystem.snapshot();
    assert.equal(after.get('.mwnn/cards/card-a.md'), before.get('.mwnn/cards/card-a.md'));
    assert.equal(after.get('.mwnn/cards/card-b.md'), before.get('.mwnn/cards/card-b.md'));
    const duplicate = cardDocuments(after).find((document) => document.card.title === 'A (copy)');
    assert.ok(duplicate);
    assert.equal(duplicate.position, 1500);
    const reloaded = await createBoardStore(createDeps({ fileSystem }));
    assert.deepEqual(reloaded.getState().columns[0]!.cards.map((card) => card.title), ['A', 'A (copy)', 'B']);
  });

  test('updates only the moved card position during a same-column reorder', async () => {
    const columnsDocument: ColumnsDocument = {
      version: BOARD_FILE_VERSION,
      columns: [{ id: 'col-ready', title: 'Ready', role: 'ready', wipLimit: null, reverseWip: 3 }],
    };
    const cards = [
      { columnId: 'col-ready', position: 1000, card: { id: 'card-a', title: 'A', createdAt: 1 } },
      { columnId: 'col-ready', position: 2000, card: { id: 'card-b', title: 'B', createdAt: 2 } },
      { columnId: 'col-ready', position: 3000, card: { id: 'card-c', title: 'C', createdAt: 3 } },
    ] satisfies CardDocument[];
    const fileSystem = createFakeFileSystem({
      '.mwnn/columns.json': serializeColumns(columnsDocument),
      ...Object.fromEntries(cards.map((card) => [`.mwnn/cards/${card.card.id}.md`, serializeCard(card)])),
    });
    const before = fileSystem.snapshot();
    const store = await createBoardStore(createDeps({ fileSystem }));

    await store.moveCard('card-a', 'col-ready', 3);

    const after = fileSystem.snapshot();
    assert.equal(after.get('.mwnn/cards/card-b.md'), before.get('.mwnn/cards/card-b.md'));
    assert.equal(after.get('.mwnn/cards/card-c.md'), before.get('.mwnn/cards/card-c.md'));
    assert.equal(parseCard(after.get('.mwnn/cards/card-a.md') ?? '').position, 4000);
    const reloaded = await createBoardStore(createDeps({ fileSystem }));
    assert.deepEqual(reloaded.getState().columns[0]!.cards.map((card) => card.title), ['B', 'C', 'A']);
  });

  test('repairs duplicate existing positions deterministically when the next card is added', async () => {
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
      position: 1000,
      card: { id: 'card-b', title: 'B', createdAt: 2 },
    };
    const fileSystem = createFakeFileSystem({
      '.mwnn/columns.json': serializeColumns(columnsDocument),
      '.mwnn/cards/card-b.md': serializeCard(secondCard),
      '.mwnn/cards/card-a.md': serializeCard(firstCard),
    });
    const before = fileSystem.snapshot();
    const store = await createBoardStore(createDeps({ fileSystem }));

    await store.addCard('col-ready', 'C');

    const after = fileSystem.snapshot();
    assert.equal(after.get('.mwnn/cards/card-a.md'), before.get('.mwnn/cards/card-a.md'));
    assert.equal(parseCard(after.get('.mwnn/cards/card-b.md') ?? '').position, 2000);
    assert.equal(cardDocuments(after).find((document) => document.card.title === 'C')?.position, 3000);
    const reloaded = await createBoardStore(createDeps({ fileSystem }));
    assert.deepEqual(reloaded.getState().columns[0]!.cards.map((card) => card.title), ['A', 'B', 'C']);
  });

  test('keeps repeated same-gap insertions unique after numeric midpoint precision is exhausted', async () => {
    const columnsDocument: ColumnsDocument = {
      version: BOARD_FILE_VERSION,
      columns: [{ id: 'col-ready', title: 'Ready', role: 'ready', wipLimit: null, reverseWip: 3 }],
    };
    const firstCard: CardDocument = {
      columnId: 'col-ready',
      position: 0,
      card: { id: 'card-a', title: 'A', createdAt: 1 },
    };
    const secondCard: CardDocument = {
      columnId: 'col-ready',
      position: 1,
      card: { id: 'card-b', title: 'B', createdAt: 2 },
    };
    const fileSystem = createFakeFileSystem({
      '.mwnn/columns.json': serializeColumns(columnsDocument),
      '.mwnn/cards/card-a.md': serializeCard(firstCard),
      '.mwnn/cards/card-b.md': serializeCard(secondCard),
    });
    const store = await createBoardStore(createDeps({ fileSystem }));

    for (let index = 0; index < 60; index += 1) {
      await store.duplicateCard('card-a');
    }

    const documents = cardDocuments(fileSystem.snapshot());
    const positions = documents.map((document) => document.position);
    assert.equal(new Set(positions).size, positions.length);
    assert.deepEqual(
      store.getState().columns[0]!.cards.map((card) => card.id),
      [...documents].sort((left, right) => left.position - right.position).map((document) => document.card.id),
    );
  });

  test('writes the board readme when loading an existing board that predates it', async () => {
    const columnsDocument: ColumnsDocument = {
      version: BOARD_FILE_VERSION,
      columns: [{ id: 'col-ready', title: 'Ready', role: 'ready', wipLimit: null, reverseWip: 3 }],
    };

    const fileSystem = createFakeFileSystem({
      '.mwnn/columns.json': serializeColumns(columnsDocument),
    });

    await createBoardStore(createDeps({ fileSystem }));

    assert.match(fileSystem.snapshot().get('.mwnn/README.md') ?? '', /cards\/<card-id>\.md/);
  });

  test('reload picks up external card edits from disk', async () => {
    const fileSystem = createFakeFileSystem();
    const store = await createBoardStore(createDeps({ fileSystem, defaultColumns: ['Ready'] }));
    const columnId = store.getState().columns[0]!.id;

    await store.addCard(columnId, 'Original');

    const cardFile = [...fileSystem.snapshot().keys()].find((filePath) => filePath.startsWith('.mwnn/cards/'));
    assert.ok(cardFile, 'expected a card markdown file to be written');

    const parsed = parseCard(fileSystem.snapshot().get(cardFile!) ?? '');
    parsed.card.title = 'Externally edited';
    await fileSystem.writeFile(cardFile!, serializeCard(parsed));

    await store.reload();
    assert.equal(store.getState().columns[0]!.cards[0]!.title, 'Externally edited');
  });

  test('a board mutation preserves an external activity edit instead of clobbering it', async () => {
    const fileSystem = createFakeFileSystem();
    const store = await createBoardStore(createDeps({ fileSystem, defaultColumns: ['Ready', 'Done'] }));
    const readyId = store.getState().columns[0]!.id;
    const doneId = store.getState().columns[1]!.id;

    await store.addCard(readyId, 'Card');
    const cardId = store.getState().columns[0]!.cards[0]!.id;

    // A hand-off agent appends to the card's Activity section directly on disk,
    // while the in-memory store still has no activity for that card.
    const cardFile = [...fileSystem.snapshot().keys()].find((filePath) => filePath.startsWith('.mwnn/cards/'));
    assert.ok(cardFile, 'expected a card markdown file to be written');
    const parsed = parseCard(fileSystem.snapshot().get(cardFile!) ?? '');
    parsed.card.activity = 'Agent: did the work';
    await fileSystem.writeFile(cardFile!, serializeCard(parsed));

    // Moving the card (a board mutation) must not overwrite the agent's edit.
    await store.moveCard(cardId, doneId, 0);

    const movedCard = store.getState().columns[1]!.cards[0]!;
    assert.equal(movedCard.id, cardId);
    assert.equal(movedCard.activity, 'Agent: did the work');
    assert.equal(parseCard(fileSystem.snapshot().get(cardFile!) ?? '').card.activity, 'Agent: did the work');
  });

  test('reload keeps the current state when an external edit leaves invalid columns json', async () => {
    const fileSystem = createFakeFileSystem();
    const store = await createBoardStore(createDeps({ fileSystem, defaultColumns: ['Ready'] }));

    await fileSystem.writeFile('.mwnn/columns.json', '{ not-valid-json');

    const reloaded = await store.reload();
    assert.deepEqual(
      reloaded.columns.map((column) => column.title),
      ['Ready'],
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

  test('migration infers the verify role for a Verify column', async () => {
    const fileSystem = createFakeFileSystem();
    const legacyMemento = fakeMemento({
      'mwnn-kanban.board': {
        version: 1,
        columns: [
          { id: 'col-backlog', title: 'Backlog', cards: [] },
          { id: 'col-ready', title: 'Ready', cards: [] },
          { id: 'col-impl', title: 'Implement', cards: [] },
          { id: 'col-verify', title: 'Verify', cards: [] },
          { id: 'col-done', title: 'Done', cards: [] },
        ],
      },
    });

    const store = await createBoardStore(createDeps({ fileSystem, legacyMemento }));

    assert.deepEqual(
      store.getState().columns.map((column) => column.role),
      ['backlog', 'ready', 'in-progress', 'verify', 'done'],
    );
  });

  test('an existing Verify column loads with the verify role and round-trips to disk', async () => {
    const columnsDocument: ColumnsDocument = {
      version: BOARD_FILE_VERSION,
      columns: [
        { id: 'col-impl', title: 'Implement', role: 'in-progress', wipLimit: 1, reverseWip: null },
        { id: 'col-verify', title: 'Verify', role: 'verify', wipLimit: null, reverseWip: null },
        { id: 'col-done', title: 'Done', role: 'done', wipLimit: null, reverseWip: null },
      ],
    };
    const fileSystem = createFakeFileSystem({
      '.mwnn/columns.json': serializeColumns(columnsDocument),
    });

    const store = await createBoardStore(createDeps({ fileSystem }));
    assert.equal(store.getState().columns[1]!.role, 'verify');

    // Force a write back to disk and confirm the role survives serialization.
    await store.addCard('col-verify', 'Task');
    assert.match(fileSystem.snapshot().get('.mwnn/columns.json') ?? '', /"role": "verify"/);
    assert.deepEqual(
      parseColumns(fileSystem.snapshot().get('.mwnn/columns.json') ?? '').columns.map((c) => c.role),
      ['in-progress', 'verify', 'done'],
    );
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
