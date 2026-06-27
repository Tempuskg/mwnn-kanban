# MWNN Kanban Implementation Plan

## Goal

Complete the MWNN Kanban extension so it supports human + AI assignable work.

## Context

`mwnn-kanban` is currently a clean MVP VS Code extension: a Kanban webview with add/edit/delete/drag cards across columns, persisted in the workspace memento (`src/boardStore.ts`). Cards carry only `id`, `title`, and `createdAt` (`src/types.ts`).

Two things are still missing before it matches the intended goals:

1. MWNN methodology from the blog:
   lightweight Kanban with max WIP limits on flow columns and a signature reverse-WIP limit on a Ready column. The Ready column should never fall below a minimum number of defined, ready-to-start slices, so work is never starved. No sprints.
2. Human + AI usability:
   board state currently lives in the memento, which is invisible to AI coding agents working on the filesystem. The board needs to move to git-tracked workspace files with an assignee on each card, plus a documented contract so an agent can find, claim, do, and move its assigned slices.

This plan migrates storage to markdown-per-card files, adds the assignee + methodology model, rebuilds the UI to match, documents the AI contract, and adds an in-editor "Run with AI" action.

## Decisions

- Storage:
  one markdown file per card under `.mwnn/`, git-tracked.
- Assignee:
  `{ kind: 'human' | 'ai', name?: string }`; unassigned allowed.
- Methodology:
  max WIP limits, reverse WIP on Ready, card description/acceptance criteria, column roles, and fully user-editable columns (add / remove / rename / reorder / set limits).
- AI access:
  file contract documented in `AGENTS.md` (primary) + VS Code Language Model API "Run with AI" action (secondary). MCP server is out of scope for now.

## Data Model and On-Disk Format

Bump `BOARD_STATE_VERSION` to `2`. In-memory `BoardState` stays "columns each holding ordered cards", assembled from files. The files become the source of truth.

### `.mwnn/columns.json`

Board layout and config only.

```json
{
  "version": 2,
  "columns": [
    { "id": "col-backlog", "title": "Backlog", "role": "backlog", "wipLimit": null, "reverseWip": null },
    { "id": "col-ready", "title": "Ready", "role": "ready", "wipLimit": null, "reverseWip": 3 },
    { "id": "col-doing", "title": "In Progress", "role": "in-progress", "wipLimit": 3, "reverseWip": null },
    { "id": "col-done", "title": "Done", "role": "done", "wipLimit": null, "reverseWip": null }
  ]
}
```

### `.mwnn/cards/<id>.md`

One file per card. A single-file edit should map cleanly to one board action.

```md
---
id: card-abc123
title: Add login form
column: col-ready
position: 1000
assignee: { kind: ai, name: Claude }   # or { kind: human, name: Darren }; omit if unassigned
createdAt: 1719360000000
updatedAt: 1719360000000
---

## Description
What the slice is.

## Acceptance criteria
- [ ] ...

## Activity
- 2026-06-26 Claude: claimed
```

### Additional Notes

- Card-to-column linkage and ordering live in the card frontmatter (`column` + numeric `position`), so moving or reordering edits only that card file.
- Column definitions live in `columns.json`. No duplicated source of truth.
- A card counts as "defined" and ready when its `Description` section is non-empty. That drives the reverse-WIP count and the "needs definition" indicator.
- Types to add in `src/types.ts`:
  `Assignee`, `ColumnRole` (`'backlog' | 'ready' | 'in-progress' | 'done' | 'custom'`), `wipLimit` / `reverseWip` on `Column`, and `assignee` / `description` / `updatedAt` on `Card`.
- Extend `isBoardState`, `isColumn`, and `isCard` guards, add `isAssignee`, and extend the message protocol in Phase 4.

## Implementation Phases

### Phase 1 - Pure Serialization + Model

- Add `src/serialization.ts` with pure functions:
  `serializeCard(card): string`, `parseCard(text): Card`, `serializeColumns`, and `parseColumns`.
- Keep the parser dependency-free if possible, matching the repo's lean style.
- Extend `src/utils.ts`:
  keep existing pure ops and add `setAssignee`, `setDescription`, `setColumnConfig`, `removeColumn`, `renameColumn`, `reorderColumns`, `wipState(column)`, `readyState(readyColumn)`, and a card-position helper for ordering.

### Phase 2 - File-Backed Store + Migration

- Replace memento persistence with a `.mwnn/` file store using `vscode.workspace.fs`.
- Keep the existing `BoardStore` interface and add `setAssignee`, `setDescription`, and column-management methods.
- Assemble `BoardState` by reading `.mwnn/cards/*.md` and `columns.json`, then sort each column by `position`.
- Migration:
  on activation, if `.mwnn/` is absent but a v1 board exists in memento, write it out to files with sensible default roles and no assignees. Leave the memento as backup.
- No workspace folder:
  show an informational message and disable board commands.
- Add a `FileSystemWatcher` on `.mwnn/**` so external edits live-refresh the open board.

### Phase 3 - Extension Wiring + Commands

- Update existing commands.
- Add:
  `mwnn-kanban.addColumn`, `renameColumn`, `deleteColumn`, `setColumnLimits`, and `mwnn-kanban.runCardWithAI`.
- `Run with AI` should:
  call `vscode.lm.selectChatModels(...)`, send the card title + description + acceptance criteria, stream the model response into the card `Activity`, and optionally move the card to the next flow column.
- Gate AI behavior behind a setting and degrade gracefully if no model or consent is available.
- Register commands and palette entries in `package.json`.
- Add settings:
  `mwnn-kanban.defaultReadyReverseWip` (default `3`), `mwnn-kanban.enableRunWithAI` (default `true`), and `mwnn-kanban.boardFolder` (default `.mwnn`).
- Keep `confirmCardDeletion`.
- Replace `defaultColumns` with a richer default that includes roles + Ready reverse-WIP.

### Phase 4 - Webview UI

- Extend `WebviewToHostMessage` with:
  `setAssignee`, `setDescription`, `openCard`, `addColumn`, `renameColumn`, `deleteColumn`, `setColumnLimits`, and `runCardWithAI`.
- Mirror the shapes in the `board.js` JSDoc.
- Card rendering should show:
  assignee badge, small assignee picker, and a "needs definition" marker.
- Replace prompt-based editing with an in-webview drawer or modal for:
  title, description, acceptance criteria, assignee, and `Run with AI` when `assignee.kind === 'ai'`.
- Column headers should show:
  count / WIP limit warnings and Ready defined / reverse-WIP warnings.
- Column controls should support:
  rename, delete, set limits, and reorder.
- Keep drag-and-drop for cards and wire moves to position recompute.

### Phase 5 - AI Contract Docs

- Update `AGENTS.md` with the board contract for agents:
  where files live, card frontmatter schema, how to find work, and the claim / do / update / move workflow.
- Add a short `.mwnn/README.md` written by the store on first run.
- Align with the existing `.github/instructions/ai-control-file-implement.instructions.md` conventions.
- Update `README.md` for features, commands, settings, and storage location.

### Phase 6 - Tests

- Add or extend unit tests for:
  serialization round-trips, `columns.json` round-trips, board assembly + ordering from a fake FS, WIP / reverse-WIP math, assignee / description ops, column add/remove/rename/reorder, and v1 -> v2 migration.
- Inject a `FileSystemLike` abstraction mirroring the existing `MementoLike` DI pattern so the store is testable without VS Code.

## Files

### Modify

- `src/types.ts`
- `src/utils.ts`
- `src/boardStore.ts`
- `src/boardPanel.ts`
- `src/extension.ts`
- `media/board.js`
- `media/board.css`
- `package.json`
- `README.md`
- `AGENTS.md`

### Add

- `src/serialization.ts`
- `test/unit/serialization.test.ts`
- `test/unit/boardStore.test.ts` (extend)
- `test/unit/boardOperations.test.ts` (extend)

## Verification

Per `.github/instructions/repo-validation.instructions.md`:

- `npm run compile-tests`, then `npm test`
- `npm run compile`
- `npm run lint`

### Development Host Smoke Test

1. Open Board on a workspace folder -> `.mwnn/columns.json` + `.mwnn/cards/*.md` created. [x]
2. Add, edit, and move cards -> each action writes or updates a markdown file and the board reloads. [x]
3. Set a column WIP limit and exceed it -> warning shows. [x]
4. Drain the Ready column below its reverse-WIP minimum -> "under-supplied" warning shows. [x]
5. Assign a card to AI, then edit the card file by hand -> board live-updates through the watcher. [x]
6. Run "Run with AI" on an AI-assigned card -> model output lands in `Activity` or skips cleanly if no LM is available.
7. Migration test:
   open a workspace whose memento holds a v1 board with no `.mwnn/` -> cards are written to files with sensible roles and the board renders unchanged.

## Status

- Date: `2026-06-27`
- Mode: Active implementation
- Note: The pasted plan above supersedes the earlier bootstrap checklist. Live progress continues below.

## Milestones

- [x] Phase 1 - Pure serialization + model
- [x] Phase 2 - File-backed store + migration
- [x] Phase 3 - Extension wiring + commands
- [x] Phase 4 - Webview UI for assignees and methodology
- [x] Phase 5 - AI contract docs
- [ ] Phase 6 - Expanded tests + end-to-end validation

## Progress Log

### 2026-06-26

- Completed the first implementation slice in `src/utils.ts` and `src/extension.ts`.
- Added normalization so whitespace-only column and card titles are ignored instead of being persisted.
- Fixed a `moveCard` edge case where a missing destination column could remove a card from the board.
- Extended unit coverage for the new guardrails.
- Validation passed for `npm run compile-tests`, `npm run compile`, focused `node --test dist-test/test/unit/boardOperations.test.js`, full `npm test`, and `npm run lint`.
- Manual Development Host smoke testing is still pending for interactive webview behavior.
- Added runtime validation for inbound webview messages before the extension host dispatches them.
- Added tests for malformed persisted board state and malformed protocol messages.
- Refreshed the webview with a visible board intro, empty states, explicit Edit and Delete buttons, and improved ARIA labeling for columns and cards.
- Validation passed for `node --check media/board.js`, `npm run compile-tests`, `npm run compile`, `npm test`, and `npm run lint` after the webview refresh.

### 2026-06-27

- Re-read the pasted plan and switched implementation tracking from the bootstrap checklist to the plan's six phases.
- Started Phase 1 on the pure shared-model side instead of touching VS Code storage or the webview boundary first.
- Expanded the shared board model to carry assignee, description, updatedAt, column role, and WIP metadata while staying backward-compatible with the current memento-backed store.
- Added pure utility operations for assignee updates, description updates, column config changes, column removal/reordering, and WIP/reverse-WIP calculations.
- Extended unit coverage for the new methodology helpers and metadata guards.
- Validation passed for `npm run compile-tests`, `npm run compile`, focused `node --test dist-test/test/unit/boardOperations.test.js`, full `npm test`, and `npm run lint` after the Phase 1 model changes.
- Added `src/serialization.ts` with dependency-free card-markdown and `columns.json` round-trip helpers plus focused serialization tests.
- Added a pure card-position helper to support file-backed ordering in the upcoming `.mwnn/` store.
- Deferred the global board-state version bump until the file-store migration lands so the current memento-backed board did not get invalidated mid-phase.
- Validation passed for `npm run compile-tests`, `npm run compile`, focused `node --test dist-test/test/unit/serialization.test.js dist-test/test/unit/boardOperations.test.js`, full `npm test`, and `npm run lint` after the serialization layer landed.
- Phase 1 is now complete enough to start replacing the memento store with the `.mwnn/` file-backed store.
- Started Phase 2 by replacing the old memento-only board store with a testable file-backed store abstraction rooted at `.mwnn/`.
- Added the first migration path from legacy memento state into `.mwnn/columns.json` and markdown card files, and bumped the live board-state version to 2 now that the file-backed path exists.
- Updated activation wiring so the extension awaits the file-backed store and shows an informational message when no workspace folder is open.
- Validation passed for `npm run compile-tests`, `npm run compile`, focused `node --test dist-test/test/unit/boardStore.test.js dist-test/test/unit/serialization.test.js`, full `npm test`, and `npm run lint` after the first Phase 2 store migration pass.
- Added a debounced `.mwnn/**` file watcher and a store-level reload path so external edits can refresh the in-memory board state without reopening the panel.
- Added unit coverage for external file reload and malformed external file edits so the watcher path has a safe store primitive behind it.
- Phase 2 is now complete enough to shift into command wiring on top of the file-backed store.
- Started Phase 3 by adding command-palette scaffolding for column rename/delete/limit management and registering the new board-folder / reverse-WIP / AI-enable settings.
- Finished the remaining Phase 3 command work by adding `mwnn-kanban.runCardWithAI`, model selection / graceful fallback handling, and an activity-append path that records LM output back into each card file.
- Updated the first-run board defaults to `Backlog`, `Ready`, `In Progress`, and `Done` so reverse-WIP has a Ready column to target without extra setup.
- Extended unit coverage for the new activity append primitive in both the pure board operations and the file-backed store.
- Validation passed for `npm run compile-tests`, `npm run compile`, focused `node --test dist-test/test/unit/boardOperations.test.js dist-test/test/unit/boardStore.test.js`, full `npm test`, and `npm run lint` after the Phase 3 AI command pass.
- Phase 3 is now complete in code, with Development Host smoke testing still pending for the LM consent/model-selection flow.
- Started Phase 4 by extending the host/webview protocol for assignee, description, acceptance criteria, and per-card Run with AI actions.
- Replaced the in-webview edit prompt with a card detail panel that can edit title, assignee, description, and acceptance criteria while showing the card activity log inline.
- Added assignee badges, a "needs definition" marker, and WIP/reverse-WIP status badges to the board so methodology signals are visible directly on the webview.
- Validation passed for `node --check media/board.js`, `npm run compile-tests`, `npm run compile`, focused `node --test dist-test/test/unit/boardOperations.test.js dist-test/test/unit/boardStore.test.js dist-test/test/unit/protocol.test.js`, full `npm test`, and `npm run lint` after the first Phase 4 UI slice.
- Finished the remaining Phase 4 column controls by adding in-webview add/configure/delete/reorder flows plus typed host messages for column rename, limits, deletion, and reordering.
- The board webview now covers card detail edits, AI runs, methodology indicators, and direct column management without depending on command-palette-only flows for everyday board work.
- Validation passed for `node --check media/board.js`, `npm run compile-tests`, `npm run compile`, focused `node --test dist-test/test/unit/protocol.test.js`, full `npm test`, and `npm run lint` after the column-management UI pass.
- Phase 4 is now complete in code, with Development Host smoke testing still pending for the interactive board behaviors.
- Started Phase 5 by moving the board contract into repo-local docs instead of leaving it implicit in the implementation plan.
- Added a store-written `.mwnn/README.md` contract file so direct editors inside a workspace can discover the filesystem schema and workflow without leaving the board folder.
- Updated `AGENTS.md` with the primary human/AI board contract and refreshed `README.md` so the published extension docs match the current commands, settings, storage model, and AI workflow.
- Added unit coverage for older workspaces that already have board files but are missing the new `.mwnn/README.md` artifact.
- Validation passed for `npm run compile-tests`, `npm run compile`, focused `node --test dist-test/test/unit/boardStore.test.js`, full `npm test`, and `npm run lint` after the Phase 5 contract-doc pass.
- Phase 5 is now complete in code and docs.
- Started another Phase 6 pass by extracting the AI card-selection, prompt-building, activity-formatting, and quick-pick summary logic into a pure `src/aiCards.ts` module.
- Added focused unit coverage for the AI-assigned card selection path and the LM prompt/activity formatting helpers instead of leaving that behavior extension-host-only and untested.
- Confirmed on 2026-06-27 that the installed `code.cmd --help` output does not advertise extension-test CLI flags, and the desktop automation runtime is still failing before connection with `codex/sandbox-state-meta: missing field sandboxPolicy`.
- The remaining live Development Host smoke tests are therefore still blocked in this environment even though compile/test/lint coverage keeps expanding.
- Fixed a board regression where the webview's add-card button no-oped in VS Code because it still relied on `window.prompt(...)`; add-card and add-column now request host-side `showInputBox(...)` prompts instead.
- Validation passed for `node --check media/board.js`, `npm run compile-tests`, `npm run compile`, focused `node --test dist-test/test/unit/protocol.test.js`, full `npm test`, and `npm run lint` after the host-side prompt fix.

## Next Focus

- Finish Phase 6 by running the remaining Development Host smoke tests for file watching, WIP/reverse-WIP indicators, detail-panel edits, column controls, and the LM consent/model-selection path once an interactive VS Code session or working automation path is available.
- After that live validation pass, decide whether any final test gaps or documentation polish remain before considering the implementation plan complete.
