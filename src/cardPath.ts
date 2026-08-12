import * as path from 'node:path';

export interface CardPathCopyResult {
  readonly ok: boolean;
  readonly path: string;
  readonly message: string;
}

/** Build the absolute, platform-native path for a card's backing file. */
export function buildCardPath(workspaceFolder: string, boardFolder: string, cardId: string): string {
  return path.resolve(workspaceFolder, boardFolder, 'cards', `${cardId}.md`);
}

/** Copy a card path and return user-facing feedback for either outcome. */
export async function copyCardPathToClipboard(
  workspaceFolder: string,
  boardFolder: string,
  cardId: string,
  writeText: (value: string) => PromiseLike<void> | void,
): Promise<CardPathCopyResult> {
  const cardPath = buildCardPath(workspaceFolder, boardFolder, cardId);
  try {
    await writeText(cardPath);
    return {
      ok: true,
      path: cardPath,
      message: `Copied ${cardPath} to the clipboard.`,
    };
  } catch (error) {
    const reason = error instanceof Error && error.message.trim().length > 0
      ? ` ${error.message.trim()}`
      : '';
    return {
      ok: false,
      path: cardPath,
      message: `Could not copy card path ${cardPath}.${reason}`,
    };
  }
}
