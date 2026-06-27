/**
 * Board persistence. Wraps a VS Code Memento (workspace state) behind a small
 * injectable interface so the store can be unit-tested without VS Code.
 */

import { isBoardState, type BoardState } from './types';
import { addCard, addColumn, cloneBoard, defaultBoard, deleteCard, editCard, moveCard } from './utils';

const STORAGE_KEY = 'mwnn-kanban.board';

/** Minimal subset of vscode.Memento needed for persistence. */
export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | void;
}

export interface BoardStoreDeps {
  readonly memento: MementoLike;
  readonly defaultColumns: readonly string[];
}

export interface BoardStore {
  getState(): BoardState;
  addColumn(title: string): Promise<BoardState>;
  addCard(columnId: string, title: string): Promise<BoardState>;
  editCard(cardId: string, title: string): Promise<BoardState>;
  deleteCard(cardId: string): Promise<BoardState>;
  moveCard(cardId: string, toColumnId: string, toIndex: number): Promise<BoardState>;
  reset(): Promise<BoardState>;
}

export function createBoardStore(deps: BoardStoreDeps): BoardStore {
  const stored = deps.memento.get<unknown>(STORAGE_KEY);
  let state: BoardState = isBoardState(stored) ? cloneBoard(stored) : defaultBoard(deps.defaultColumns);

  async function commit(next: BoardState): Promise<BoardState> {
    state = next;
    await deps.memento.update(STORAGE_KEY, state);
    return cloneBoard(state);
  }

  return {
    getState: () => cloneBoard(state),
    addColumn: (title) => commit(addColumn(state, title)),
    addCard: (columnId, title) => commit(addCard(state, columnId, title)),
    editCard: (cardId, title) => commit(editCard(state, cardId, title)),
    deleteCard: (cardId) => commit(deleteCard(state, cardId)),
    moveCard: (cardId, toColumnId, toIndex) => commit(moveCard(state, cardId, toColumnId, toIndex)),
    reset: () => commit(defaultBoard(deps.defaultColumns)),
  };
}
