import * as assert from 'node:assert/strict';
import * as path from 'node:path/posix';
import { suite, test } from 'node:test';
import {
  BOARD_FILE_VERSION,
  serializeCard,
  serializeColumns,
  type CardDocument,
} from '../../src/serialization';
import {
  createBoardStore,
  type BoardStoreChange,
  type FileSystemLike,
  type UnreadableCardFile,
} from '../../src/boardStore';
import type { BoardState, Card } from '../../src/types';

// Reproduces card-mwms8fqc-1: a tool outside VS Code (the Claude desktop app)
// rewrote card files whole, once with CRLF line endings, and overwrote two
// other cards with a bare Activity fragment. The watcher reload then threw on
// the fragments and kept the entire previous board, so the finished card's
// `STATUS: DONE` never reached the board or its open details view.

function memoryFileSystem(initial: Record<string, string>): FileSystemLike & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  const isDirectory = (target: string): boolean =>
    [...files.keys()].some((file) => file.startsWith(`${target}/`));
  return {
    files,
    exists: async (target) => files.has(target) || isDirectory(target),
    readFile: async (target) => {
      const content = files.get(target);
      if (content === undefined) {
        throw new Error(`Missing file: ${target}`);
      }
      return content;
    },
    writeFile: async (target, content) => {
      files.set(target, content);
    },
    deleteFile: async (target) => {
      files.delete(target);
    },
    readDirectory: async (target) =>
      [...files.keys()]
        .filter((file) => path.dirname(file) === target)
        .map((file) => path.basename(file)),
    createDirectory: async () => undefined,
  };
}

const columns = serializeColumns({
  version: BOARD_FILE_VERSION,
  columns: [
    { id: 'col-progress', title: 'In Progress', role: 'in-progress', wipLimit: null, reverseWip: null },
    { id: 'col-done', title: 'Done', role: 'done', wipLimit: null, reverseWip: null },
  ],
});

function cardFile(card: Card, position: number, columnId = 'col-progress'): string {
  const document: CardDocument = { columnId, position, card };
  return serializeCard(document);
}

const runningCard: Card = {
  id: 'card-run',
  title: 'Run the slice',
  createdAt: 1,
  description: 'Do the work.',
  acceptanceCriteria: '- [ ] Ship it',
  activity: '- 2026-11-18 Handed off',
};

const siblingCard: Card = { id: 'card-sibling', title: 'Sibling', createdAt: 2, description: 'Other work.' };

function findCard(state: BoardState, id: string): Card | undefined {
  return state.columns.flatMap((column) => column.cards).find((card) => card.id === id);
}

function finishedRewrite(lineEnding: '\n' | '\r\n'): string {
  const finished: Card = {
    ...runningCard,
    acceptanceCriteria: '- [x] Ship it',
    activity: `${runningCard.activity}\n- 2026-11-18 Claude: shipped\nSTATUS: DONE`,
  };
  return cardFile(finished, 1000).replace(/\n/g, lineEnding);
}

async function setUp(): Promise<{
  fileSystem: ReturnType<typeof memoryFileSystem>;
  store: Awaited<ReturnType<typeof createBoardStore>>;
  changes: BoardStoreChange[];
  unreadable: (readonly UnreadableCardFile[])[];
}> {
  const fileSystem = memoryFileSystem({
    '.mwnn/columns.json': columns,
    '.mwnn/README.md': 'board',
    '.mwnn/cards/card-run.md': cardFile(runningCard, 1000),
    '.mwnn/cards/card-sibling.md': cardFile(siblingCard, 2000),
  });
  const changes: BoardStoreChange[] = [];
  const unreadable: (readonly UnreadableCardFile[])[] = [];
  const store = await createBoardStore({
    fileSystem,
    boardFolder: '.mwnn',
    defaultColumns: ['Backlog', 'Ready', 'Done'],
    defaultReadyReverseWip: 3,
    onDidChange: (change) => changes.push(change),
    onDidChangeUnreadableCards: (files) => unreadable.push(files),
  });
  return { fileSystem, store, changes, unreadable };
}

suite('board reload after an external whole-file rewrite', () => {
  for (const [label, lineEnding] of [['LF', '\n'], ['CRLF', '\r\n']] as const) {
    test(`picks up checked criteria and STATUS: DONE from a ${label} rewrite`, async () => {
      const { fileSystem, store, changes } = await setUp();
      fileSystem.files.set('.mwnn/cards/card-run.md', finishedRewrite(lineEnding));

      const reloaded = await store.reload();

      const card = findCard(reloaded, 'card-run');
      assert.equal(card?.acceptanceCriteria, '- [x] Ship it');
      assert.match(card?.activity ?? '', /STATUS: DONE$/);
      assert.equal(changes.length, 1);
      assert.equal(changes[0]!.reason, 'reload');
    });
  }

  test('a sibling overwritten with a fragment no longer freezes the rest of the board', async () => {
    const { fileSystem, store, unreadable } = await setUp();
    const fragment = '\n\n### 2026-11-18 - Hold released\n- The person answered "Yes".\n';
    fileSystem.files.set('.mwnn/cards/card-sibling.md', fragment);
    fileSystem.files.set('.mwnn/cards/card-run.md', finishedRewrite('\r\n'));

    const reloaded = await store.reload();

    assert.match(findCard(reloaded, 'card-run')?.activity ?? '', /STATUS: DONE$/);
    // The unreadable card keeps its last good version in its old place.
    assert.equal(findCard(reloaded, 'card-sibling')?.title, 'Sibling');
    assert.deepEqual(
      reloaded.columns[0]!.cards.map((card) => card.id),
      ['card-run', 'card-sibling'],
    );
    assert.equal(unreadable.length, 1);
    assert.deepEqual(unreadable[0]!.map((file) => file.fileName), ['card-sibling.md']);
    assert.match(unreadable[0]![0]!.reason, /frontmatter/i);

    // A repeat reload with the same problem does not re-notify.
    await store.reload();
    assert.equal(unreadable.length, 1);
  });

  test('board writes stay strict and never delete an unreadable card file', async () => {
    const { fileSystem, store } = await setUp();
    const fragment = '### just an activity fragment\n';
    fileSystem.files.set('.mwnn/cards/card-sibling.md', fragment);

    await assert.rejects(() => store.editCard('card-run', 'Renamed'), /frontmatter/i);

    assert.equal(fileSystem.files.get('.mwnn/cards/card-sibling.md'), fragment);
    assert.equal(fileSystem.files.get('.mwnn/cards/card-run.md'), cardFile(runningCard, 1000));
  });

  test('a card file that never parsed is left out, and fixing it clears the warning', async () => {
    const { fileSystem, store, unreadable } = await setUp();
    fileSystem.files.set('.mwnn/cards/card-new.md', 'title: no frontmatter');

    const skipped = await store.reload();
    assert.equal(findCard(skipped, 'card-new'), undefined);
    assert.deepEqual(unreadable.at(-1)!.map((file) => file.fileName), ['card-new.md']);

    fileSystem.files.set('.mwnn/cards/card-new.md', cardFile({ id: 'card-new', title: 'New', createdAt: 3 }, 3000));
    const fixed = await store.reload();

    assert.equal(findCard(fixed, 'card-new')?.title, 'New');
    assert.deepEqual(unreadable.at(-1), []);
  });

  // Found in the Development Host smoke test: with a fragment card already on
  // disk, activation failed with "Card markdown is missing frontmatter", so
  // reopening VS Code left the board dead instead of recovering it.
  test('starting with a fragment card on disk still loads the board and recovers once it is fixed', async () => {
    const fileSystem = memoryFileSystem({
      '.mwnn/columns.json': columns,
      '.mwnn/README.md': 'board',
      '.mwnn/cards/card-run.md': finishedRewrite('\r\n'),
      '.mwnn/cards/card-sibling.md': '- fragment appended by an outside tool\r\nSTATUS: DONE\r\n',
    });
    const unreadable: (readonly UnreadableCardFile[])[] = [];
    const store = await createBoardStore({
      fileSystem,
      boardFolder: '.mwnn',
      defaultColumns: ['Backlog', 'Ready', 'Done'],
      defaultReadyReverseWip: 3,
      onDidChangeUnreadableCards: (files) => unreadable.push(files),
    });

    assert.match(findCard(store.getState(), 'card-run')?.activity ?? '', /STATUS: DONE$/);
    assert.equal(findCard(store.getState(), 'card-sibling'), undefined);
    assert.deepEqual(unreadable.at(-1)!.map((file) => file.fileName), ['card-sibling.md']);
    assert.equal(fileSystem.files.get('.mwnn/columns.json'), columns);

    fileSystem.files.set('.mwnn/cards/card-sibling.md', cardFile(siblingCard, 2000));
    const fixed = await store.reload();

    assert.equal(findCard(fixed, 'card-sibling')?.title, 'Sibling');
    assert.deepEqual(unreadable.at(-1), []);
  });
});
