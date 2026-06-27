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
    'Use exactly these three sections, in this order, and address the reader directly:',
    '',
    '**Status** — One line. State whether the card is Done or Not done, and why.',
    '**Next step** — The single most important thing the reader should do next. Be specific and actionable; if the card is Done, say "Nothing — ready to move on."',
    '**Watch out for** — Any risks or blockers, or "None" if there are none.',
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

export function buildCardHandoffPrompt(card: BoardCard, cardFilePath: string): string {
  return [
    'You are an AI coding agent picking up a Methodology With No Name (MWNN) Kanban card.',
    'Do the actual work this card describes in the current workspace — write code, create files, run commands as needed. Do not just describe the work.',
    '',
    `This card is stored as a markdown file at: ${cardFilePath}`,
    'When you finish, update that file: append a short summary of what you did under its "Activity" section.',
    'End your work by reporting the card status on its own line, exactly one of:',
    '  STATUS: DONE — the acceptance criteria are met.',
    '  STATUS: BLOCKED: <reason> — you cannot proceed and need a human.',
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

export function formatHandoffEntry(
  providerLabel: string,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - Handed off to ${providerLabel}`,
    `Dispatched this card to ${providerLabel}. The agent should append its completion note below.`,
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
