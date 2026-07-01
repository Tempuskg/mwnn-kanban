---
id: card-mqwtekyi-2
title: have an import plan into board feature
column: col-mqxta6ho-4
position: 1000
assignee: { kind: human }
createdAt: 1782592257690
updatedAt: 1782905130769
---

## Description
Add a feature that lets a user turn a written plan into board cards in one step, instead of adding each card by hand. A "plan" is a markdown document that lists discrete pieces of work — typically as a checklist (`- [ ] ...`) or a list of headings/numbered steps, the kind of plan an AI agent or a human produces before starting work.

The user invokes an import action, supplies the plan (paste text and/or pick a markdown file in the workspace), and the extension parses it into one card per plan item. Each parsed item becomes a card whose title comes from the item text; if the item carries extra detail (sub-bullets or body text under it), that detail is placed in the card's Description. The new cards are created in a single target column — the Backlog column by default — preserving the order they appear in the plan. The import runs through the existing board store / file-per-card persistence so imported cards are written to `.mwnn/cards/` like any other card and the board reloads to show them.

Scope is the import flow only (command, plan parsing, card creation, user feedback). It does not include AI-generating the plan, defining acceptance criteria for the imported cards, or any new card schema fields.

## Acceptance criteria
- [ ] A new command (e.g. `MWNN Kanban: Import Plan`) is registered, contributed in `package.json`, and reachable from the Command Palette; it is also available as an action from the board UI.
- [ ] The command lets the user provide the plan by pasting/typing plan text and/or selecting a markdown file from the workspace.
- [ ] The plan parser converts checklist items (`- [ ]` / `- [x]`), plain bullet/numbered list items, and/or headings into one card each, using the item text as the card title (checkbox/list markers stripped).
- [ ] Detail nested under a plan item (indented sub-bullets or paragraph text) is captured into the created card's Description; items without detail produce a card with an empty Description.
- [ ] Imported cards are created in order into a single target column, defaulting to the Backlog column (or the first column when no Backlog exists), through the existing board store so each card is persisted as a `.mwnn/cards/<id>.md` file.
- [ ] The board view refreshes to show the imported cards after the import completes.
- [ ] Empty input, whitespace-only input, or a plan that yields no recognizable items results in a clear message and creates no cards (no partial/garbage cards left behind).
- [ ] On success the user sees confirmation of how many cards were imported and into which column.
- [ ] Unit tests cover the plan-parsing logic, including the supported item formats, nested-detail extraction, and the no-items/empty-input case.
- [ ] `npm run lint`, `npm run compile`, and `npm test` all pass.

## Activity
### 2026-06-28T19:22:48.884Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-30T17:54:48.642Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-30 - Implemented Import Plan feature
Built the full import flow:
- Added `src/planImport.ts` with a pure `parsePlan(text)` that turns a markdown plan into ordered `{ title, description }` items. It handles checklists (`- [ ]`/`- [x]`), bullet/numbered lists, and headings; strips checkbox/list/heading markers; captures nested sub-bullets and paragraph text as the card Description (dedented, blanks trimmed); drops a preamble title/intro before a list; and returns no items for empty/whitespace/unrecognized input. Also added `findImportTargetColumnId` (Backlog role, else first column).
- Added `importCards(state, columnId, cards)` to `src/utils.ts` and exposed it on the board store (`src/boardStore.ts`) so imported cards persist as `.mwnn/cards/<id>.md` through the existing single-commit path.
- Registered the `mwnn-kanban.importPlan` command in `package.json` (command + Command Palette menu) and `src/extension.ts`, with a workspace-less fallback. The command lets the user supply the plan via clipboard paste (preserves multi-line) or by picking a workspace `.md` file, imports into the target column, refreshes the board, and shows a "Imported N card(s) into <column>" confirmation. Empty/no-item input shows a clear message and creates nothing.
- Added a board UI "Import plan" action button (`media/board.js`) that posts a new `requestImportPlan` message, handled in `src/boardPanel.ts`; wired the new message into the `src/types.ts` protocol + guard.
- Added unit tests in `test/unit/planImport.test.ts` (parser formats, nested-detail extraction, target-column selection, importCards, and the no-items/empty cases) and a protocol-test line for the new message.
- `npm run lint`, `npm run compile`, and `npm test` (99 tests) all pass.
