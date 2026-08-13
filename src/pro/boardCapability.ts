import type * as vscode from 'vscode';
import type { BoardStore, BoardStoreChange } from '../boardStore';
import type { BoardState } from '../types';
import {
  BOARD_CAPABILITY_VERSION,
  type BoardCapabilityV1,
  type BoardChangeEvent,
} from './contracts';

export interface CreateBoardCapabilityOptions {
  readonly store: Pick<BoardStore, 'getState'>;
  readonly workspaceRoot: string | undefined;
  readonly boardFolder: string;
  readonly onDidChangeBoard: vscode.Event<BoardChangeEvent>;
  readonly readBoardAt: (rootFsPath: string, boardFolder: string) => Promise<BoardState | undefined>;
  readonly showBoard: () => void;
  readonly revealCard: (cardId: string) => boolean;
}

export function createBoardChangeEvent(
  change: BoardStoreChange,
  workspaceRoot: string,
  boardFolder: string,
  at = Date.now(),
): BoardChangeEvent {
  return {
    previous: change.previous,
    current: change.current,
    reason: change.reason,
    workspaceRoot,
    boardFolder,
    at,
  };
}

export function createBoardCapability(options: CreateBoardCapabilityOptions): BoardCapabilityV1 {
  const normalizedBoardFolder = options.boardFolder.replace(/\\/g, '/').replace(/\/+$/, '');

  return {
    version: BOARD_CAPABILITY_VERSION,
    workspaceRoot: options.workspaceRoot,
    boardFolder: options.boardFolder,
    getBoard: async () => options.store.getState(),
    onDidChangeBoard: options.onDidChangeBoard,
    readBoardAt: (rootFsPath, boardFolder = options.boardFolder) =>
      options.readBoardAt(rootFsPath, boardFolder),
    revealCard: async (cardId) => {
      const hasCard = options.store
        .getState()
        .columns.some((column) => column.cards.some((card) => card.id === cardId));
      if (!hasCard) {
        return false;
      }

      options.showBoard();
      return options.revealCard(cardId);
    },
    cardFilePath: (cardId) => `${normalizedBoardFolder}/cards/${cardId}.md`,
  };
}
