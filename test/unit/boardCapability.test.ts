import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import type * as vscode from 'vscode';
import {
  BOARD_CAPABILITY_VERSION,
  createBoardCapability,
  createBoardChangeEvent,
  type BoardChangeEvent,
} from '../../src/pro';
import type { BoardStoreChange } from '../../src/boardStore';
import { addCard, defaultBoard } from '../../src/utils';

const onDidChangeBoard = (() => ({ dispose: () => undefined })) as vscode.Event<BoardChangeEvent>;

suite('Board capability', () => {
  test('exposes the captured board and forwards disk reads with a board-folder default', async () => {
    const board = defaultBoard(['Ready']);
    const reads: Array<readonly [string, string]> = [];
    const capability = createBoardCapability({
      store: { getState: () => board },
      workspaceRoot: 'C:\\work\\primary',
      boardFolder: 'planning/board',
      onDidChangeBoard,
      readBoardAt: async (rootFsPath, boardFolder) => {
        reads.push([rootFsPath, boardFolder]);
        return board;
      },
      showBoard: () => undefined,
      revealCard: () => false,
    });

    assert.equal(capability.version, BOARD_CAPABILITY_VERSION);
    assert.equal(capability.workspaceRoot, 'C:\\work\\primary');
    assert.equal(capability.boardFolder, 'planning/board');
    assert.equal(capability.onDidChangeBoard, onDidChangeBoard);
    assert.equal(await capability.getBoard(), board);
    assert.equal(await capability.readBoardAt('C:\\work\\other'), board);
    assert.equal(await capability.readBoardAt('C:\\work\\third', '.tasks'), board);
    assert.deepEqual(reads, [
      ['C:\\work\\other', 'planning/board'],
      ['C:\\work\\third', '.tasks'],
    ]);
  });

  test('uses one normalized relative card path and reveals only known cards', async () => {
    const emptyBoard = defaultBoard(['Ready']);
    const board = addCard(emptyBoard, emptyBoard.columns[0]!.id, 'Known card');
    const cardId = board.columns[0]!.cards[0]!.id;
    const calls: string[] = [];
    const capability = createBoardCapability({
      store: { getState: () => board },
      workspaceRoot: 'C:\\work\\primary',
      boardFolder: 'planning\\team-board///',
      onDidChangeBoard,
      readBoardAt: async () => undefined,
      showBoard: () => {
        calls.push('show');
      },
      revealCard: (revealedCardId) => {
        calls.push(`reveal:${revealedCardId}`);
        return true;
      },
    });

    assert.equal(capability.cardFilePath(cardId), `planning/team-board/cards/${cardId}.md`);
    assert.equal(await capability.revealCard('missing'), false);
    assert.deepEqual(calls, []);
    assert.equal(await capability.revealCard(cardId), true);
    assert.deepEqual(calls, ['show', `reveal:${cardId}`]);
  });

  test('adds primary-board metadata to board-store changes without changing their reason', () => {
    const previous = defaultBoard(['Ready']);
    const current = addCard(previous, previous.columns[0]!.id, 'Task');
    const change: BoardStoreChange = { previous, current, reason: 'reload' };

    assert.deepEqual(
      createBoardChangeEvent(change, 'C:\\work\\primary', '.mwnn', 1234),
      {
        previous,
        current,
        reason: 'reload',
        workspaceRoot: 'C:\\work\\primary',
        boardFolder: '.mwnn',
        at: 1234,
      },
    );
  });
});
