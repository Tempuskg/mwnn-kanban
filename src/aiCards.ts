import type { BoardState } from './types';

type BoardColumn = BoardState['columns'][number];
type BoardCard = BoardColumn['cards'][number];

export interface AiCardSelection {
  readonly card: BoardCard;
  readonly nextColumn?: BoardColumn;
}

export interface AiModelDescriptor {
  readonly name: string;
  readonly vendor: string;
  readonly family: string;
}

export function listAiCardSelections(state: BoardState): AiCardSelection[] {
  return state.columns.flatMap((column, columnIndex) =>
    column.cards
      .filter((card) => card.assignee?.kind === 'ai')
      .map((card) => {
        const nextColumn = state.columns[columnIndex + 1];
        return nextColumn ? { card, nextColumn } : { card };
      }),
  );
}

export function findAiCardSelection(state: BoardState, cardId: string): AiCardSelection | undefined {
  return listAiCardSelections(state).find((selection) => selection.card.id === cardId);
}

export function buildCardPrompt(card: BoardCard): string {
  return [
    'You are assisting with a Methodology With No Name Kanban card inside VS Code.',
    'Respond with concise markdown that can be appended directly to the card Activity section.',
    'Include the next actions, any notable risks or blockers, and a brief completion note if the slice appears done.',
    '',
    `Title: ${card.title}`,
    '',
    'Description:',
    card.description?.trim() || 'No description provided.',
    '',
    'Acceptance criteria:',
    card.acceptanceCriteria?.trim() || 'No acceptance criteria provided.',
  ].join('\n');
}

export function formatActivityEntry(
  model: AiModelDescriptor,
  responseText: string,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - Run with AI (${model.name})`,
    `Model: ${model.vendor}/${model.family}`,
    '',
    responseText.trim(),
  ].join('\n');
}

export function summarizeCardDescription(description: string | undefined): string {
  if (!description) {
    return 'No description yet';
  }

  const singleLine = description.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= 80) {
    return singleLine;
  }
  return `${singleLine.slice(0, 77)}...`;
}
