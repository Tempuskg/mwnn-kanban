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
    'Keep the card\'s "## Acceptance criteria" checklist current while you work: change each verified `- [ ]` item to `- [x]`, and leave any unmet item unchecked.',
    'When you finish, update that file: append a short summary of what you did under its "Activity" section. Also append the exact terminal marker `STATUS: DONE` or `STATUS: BLOCKED: <reason>` on its own line in that Activity entry; the AI loop cannot read your chat response after this hand-off.',
    'End your work by reporting the card status on its own line, exactly one of:',
    '  STATUS: DONE — every acceptance criterion is met and checked.',
    '  STATUS: BLOCKED: <reason> — you cannot proceed and need a human; leave unmet criteria unchecked.',
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

export function buildCardVerificationPrompt(card: BoardCard, cardFilePath: string): string {
  return [
    'You are an AI coding agent verifying a finished Methodology With No Name (MWNN) Kanban card.',
    'Verify every acceptance criterion against the actual current workspace state: read the relevant files and run the build and tests needed to confirm the work.',
    'Do not implement, change, or fix the work. Do not edit source or test files; only update the card file as instructed below.',
    '',
    `This card is stored as a markdown file at: ${cardFilePath}`,
    'Keep the card\'s "## Acceptance criteria" checklist honest: uncheck any acceptance criterion that is not actually met by changing its `- [x]` to `- [ ]`. Leave criteria checked only when the workspace evidence verifies them.',
    'Append a concise summary of the evidence and findings under the card\'s "## Activity" section.',
    'End the Activity entry with exactly one terminal marker on its own line, chosen from:',
    '  VERIFY: PASS — every acceptance criterion is objectively verified.',
    '  VERIFY: FAIL: <reason> — one or more criteria are objectively not met.',
    '  VERIFY: HUMAN: <reason> — one or more criteria cannot be confirmed without a human.',
    'Use `VERIFY: HUMAN` for anything you cannot confirm yourself, including visual or UX checks, external services, credentials, and ambiguous or subjective criteria. Do not guess or substitute an automated result for human judgment.',
    'Do not emit a terminal marker anywhere else or emit more than one terminal marker.',
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

export function buildCardDefinitionPrompt(card: BoardCard, cardFilePath: string): string {
  return [
    'You are an AI assistant defining a Methodology With No Name (MWNN) Kanban card so it is ready to start.',
    'Write a clear Description and a concrete, testable Acceptance criteria checklist for this card based on its title and any existing context. Do not implement the work — only define it.',
    '',
    `This card is stored as a markdown file at: ${cardFilePath}`,
    'Edit that file in place:',
    '  - Fill in the "## Description" section with a concise explanation of the slice of work.',
    '  - Fill in the "## Acceptance criteria" section with a markdown checklist (- [ ] ...) of specific, verifiable conditions.',
    '  - Do not change the frontmatter, the title, or the Activity section.',
    '',
    `Title: ${card.title}`,
    '',
    'Current description:',
    card.description?.trim() || 'No description provided.',
    '',
    'Current acceptance criteria:',
    card.acceptanceCriteria?.trim() || 'No acceptance criteria provided.',
  ].join('\n');
}

export type PlanImportSource =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'text'; readonly text: string };

export interface PlanImportTarget {
  readonly columnId: string;
  readonly columnTitle: string;
  /** How many cards already sit in the target column, so new ids/positions don't collide. */
  readonly existingCount: number;
}

/**
 * Build the hand-off prompt for importing a written plan into Backlog cards. The
 * agent reads the plan, decomposes it into genuine work items, and writes one
 * `.mwnn/cards/<id>.md` file per item directly into the target column. File
 * imports deliberately pass the supplied path through without reading the plan.
 *
 * The prompt is self-contained (it embeds the essential card-file contract and
 * decomposition rules so it works even when the chat provider does not
 * auto-load the skill files) and also points at the two skill files for the
 * authoritative version.
 */
export function buildPlanImportPrompt(
  plan: PlanImportSource,
  target: PlanImportTarget,
  boardFolder: string,
  skillPaths: readonly string[],
): string {
  const cardsDir = `${boardFolder.replace(/\/+$/, '')}/cards`;
  const sourceInstructions =
    plan.kind === 'file'
      ? [
          'The existing handoff is the import entry point. Read the supplied local plan file yourself and write the resulting cards; the extension does not parse or transform the plan for you.',
          'Accept either a workspace-relative or absolute local path. Resolve a workspace-relative path from the current workspace root; read an absolute path directly.',
          'Before changing any board file, verify that the supplied path exists, is readable, and is a regular file. If it is missing, inaccessible, invalid, or a directory, create no cards and report the exact path and reason clearly with STATUS: BLOCKED.',
        ]
      : [
          'The existing handoff is the import entry point. Use the plan text supplied below and write the resulting cards; the extension does not parse or decompose the plan for you.',
        ];
  const planSection =
    plan.kind === 'file'
      ? ['Read the plan document at this path:', plan.path]
      : ['Here is the plan to import:', '', plan.text.trim()];

  return [
    'You are an AI agent importing a written plan into a Methodology With No Name (MWNN) Kanban board.',
    ...sourceInstructions,
    'Turn the plan into Backlog cards: create exactly one card per genuine, outstanding actionable unit of work — a discrete slice someone could pick up and do. For each card write a concise title, a non-empty Description, a concrete Acceptance criteria checklist, an assignee (Human or AI), and any dependencies on other cards. Write the cards yourself as files; do not just describe them.',
    '',
    'Follow these repository skills for the full rules:',
    ...skillPaths.map((path) => `  - ${path}`),
    '',
    'Decompose with judgment (this is the whole point — a naive "every heading/bullet is a card" split is wrong):',
    '  - DO create a card for each real task, step, or deliverable still to be done, in the order it appears.',
    '  - DO NOT create cards from section/structural headings (Goal, Overview, Context, Decisions, Data Model, Status, Milestones, Risks, Notes, Progress Log, Verification, Files), metadata (dates, status lines), narrative about already-finished work (progress logs, changelog entries, `- [x]` done items), bare file lists, or code/schema blocks.',
    '  - When a heading\'s sub-bullets are the concrete steps, make cards from the sub-steps, not the umbrella heading. When sub-bullets are just detail, make one card and put the detail in its Description.',
    '  - If the plan has no genuine outstanding work items, create no cards and say so.',
    '',
    `Write each card as a markdown file at ${cardsDir}/<id>.md with this exact shape:`,
    '  ---',
    '  id: card-<unique>',
    '  title: <concise imperative; JSON-quote if it contains : { } [ ] " # or edge whitespace>',
    `  column: ${target.columnId}`,
    '  position: <integer, ascending, after existing cards>',
    '  assignee: { kind: ai }   # or { kind: human }',
    '  dependsOn: [card-<id>, …]   # omit this line when the card has no prerequisites',
    '  createdAt: <unix epoch ms>',
    '  updatedAt: <unix epoch ms>',
    '  ---',
    '',
    '  ## Description',
    '  <the item\'s supporting detail, or a concise explanation of the work>',
    '',
    '  ## Acceptance criteria',
    '  - [ ] <concrete, verifiable condition>',
    '',
    '  ## Activity',
    '',
    `Target column: "${target.columnTitle}" (id ${target.columnId}), which already has ${target.existingCount} card(s). Give new cards unique ids and ascending position values (step ~1000) starting after the existing cards so plan order is preserved.`,
    'The card filename base name must exactly match its frontmatter id. Check every existing card before choosing an id so no id is reused. Keep every title concise, every Description non-empty, and every Acceptance criteria section a concrete checklist.',
    'Fill "## Acceptance criteria" for every card with a short markdown checklist (- [ ] …) of concrete, testable conditions drawn from the item — do not leave it empty, but do not pad with filler.',
    'Set "assignee" on every card: use { kind: ai } for implementation, coding, refactoring, testing, or otherwise automatable work; use { kind: human } for product or design decisions, reviews and sign-off, or manual/external steps that need a person. When genuinely unsure, prefer { kind: ai }.',
    'Set "dependsOn" where the plan implies one item must be finished before another can start (wording like "after", "once … is done", "depends on", "requires", or a foundation/phase a later item builds on). List the prerequisite card\'s id(s) in the dependent card\'s dependsOn, and omit the line otherwise. Decide each card\'s id before writing so a later card can reference an earlier one. Only link genuine prerequisites — do NOT chain cards just because they are listed in order — and never create a self-dependency or a cycle. Reference only ids of cards in this import.',
    'The extension watches the board folder and reloads automatically once the files are written. A card with unfinished dependencies is shown as blocked and cannot advance past the Ready column until they are done.',
    'Importing the same plan again must be idempotent. Derive a stable import key from the source identity (canonicalized path for a file import), the actionable item location in the plan, and its normalized title. Inventory all existing cards and match that key (or an unambiguous equivalent scope) before writing; reuse matching cards and never create duplicates. Record the key/source item in each new card Activity so a later import can recognize it. Report the number of outstanding items, existing matches, and newly created cards.',
    'If the plan contains no outstanding actionable items, create no cards and report that clearly as a successful zero-card import.',
    '',
    ...planSection,
    '',
    'When you finish, report the result on its own line, exactly one of:',
    '  STATUS: DONE — the plan was imported or already synchronized (state outstanding item, existing match, and newly created card counts).',
    '  STATUS: BLOCKED: <reason> — include the supplied path for a file import and any inaccessible, invalid, ambiguous, or unreconciled item that needs a human.',
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

export function formatDefinitionHandoffEntry(
  providerLabel: string,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - Definition requested from ${providerLabel}`,
    `Asked ${providerLabel} to fill in the Description and Acceptance criteria for this card.`,
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
