Ready for review
Select text to add comments on the plan
Plan: Complete the MWNN Kanban extension (human + AI assignable work)
Context
mwnn-kanban is a clean MVP VS Code extension: a Kanban webview with add/edit/delete/drag cards across columns, persisted in the workspace memento (src/boardStore.ts). Cards carry only id/title/createdAt (src/types.ts).

Two things are missing to "complete" it against the goals:

MWNN methodology (from the blog): lightweight Kanban with max WIP limits on flow columns and a signature reverse WIP limit on a Ready column (never let the count of defined, ready-to-start slices fall below a minimum, so work is never starved). No sprints.
Usable by humans and AI agents, with work assignable to either. The blocker is that board state lives in the memento — invisible to AI coding agents that work on the filesystem. The board must become git-tracked workspace files with an assignee on each card, plus a documented contract so an agent can find, claim, do, and move its assigned slices.
This plan migrates storage to markdown-per-card files, adds the assignee + methodology model, rebuilds the UI to match, documents the AI contract, and adds an in-editor "Run with AI" action.

Decisions (from user)
Storage: one markdown file per card under .mwnn/, git-tracked.
Assignee: { kind: 'human' | 'ai', name?: string }; unassigned allowed.
Methodology: max WIP limits, reverse WIP on Ready, card description/acceptance criteria, column roles, and fully user-editable columns (add / remove / rename / reorder / set limits).
AI access: file contract documented in AGENTS.md (primary) + VS Code Language Model API "Run with AI" action (secondary). MCP server is out of scope (future option).
Data model & on-disk format
Bump BOARD_STATE_VERSION to 2. In-memory BoardState stays "columns each holding ordered cards", assembled from files; files are the source of truth.

.mwnn/columns.json — board layout/config only (small, structural):

{
  "version": 2,
  "columns": [
    { "id": "col-backlog", "title": "Backlog",     "role": "backlog",     "wipLimit": null, "reverseWip": null },
    { "id": "col-ready",   "title": "Ready",        "role": "ready",       "wipLimit": null, "reverseWip": 3 },
    { "id": "col-doing",   "title": "In Progress",  "role": "in-progress", "wipLimit": 3,    "reverseWip": null },
    { "id": "col-done",    "title": "Done",         "role": "done",        "wipLimit": null, "reverseWip": null }
  ]
}
.mwnn/cards/<id>.md — one file per card; a single-file edit = one board action (ideal for humans and agents):

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
Card→column linkage and ordering live in the card frontmatter (column id + numeric position), so moving/reordering edits only that card's file. Column definitions live in columns.json. No duplicated source of truth.
A card is "defined"/ready when its body has a non-empty Description (used for the reverse-WIP "defined slices" count and a "needs definition" indicator).
Types to add in src/types.ts: Assignee, ColumnRole ('backlog'|'ready'|'in-progress'|'done'|'custom'), wipLimit/reverseWip on Column, assignee/description/updatedAt on Card. Extend isBoardState/isColumn/isCard guards and add isAssignee. Extend the message protocol (see Phase 4).

Implementation phases
Phase 1 — Pure serialization + model (no vscode; fully unit-tested)
New src/serialization.ts: pure functions serializeCard(card): string / parseCard(text): Card (YAML-ish frontmatter + body; keep a tiny dependency-free parser or add gray-matter/yaml — prefer hand-rolled minimal parser to avoid deps, matching the repo's lean style), and serializeColumns / parseColumns for columns.json. Round-trip safe.
Extend src/utils.ts: keep existing pure ops; add setAssignee, setDescription, setColumnConfig (wip/reverseWip/title/role), addColumn (already), removeColumn, renameColumn, reorderColumns, and helpers wipState(column) → { count, limit, over } and readyState(readyColumn) → { defined, min, under }. position assignment helper (e.g. midpoint between neighbors) for ordering.
Phase 2 — File-backed store + migration (src/boardStore.ts)
Replace memento persistence with a .mwnn/ file store using vscode.workspace.fs (read/write/delete card files + columns.json). Keep the existing BoardStore interface and add setAssignee, setDescription, column-management methods.
Assemble BoardState by globbing .mwnn/cards/*.md + reading columns.json; sort each column by position.
Migration: on activation, if .mwnn/ is absent but a v1 board exists in the memento, write it out to files (default roles: first col backlog, a ready, middle in-progress, last done; no assignees) and leave the memento as a backup.
No workspace folder: file storage needs a folder. If none is open, show an informational message and disable board commands (document this limitation).
Add a FileSystemWatcher on .mwnn/** so external edits (by an AI agent or by hand) live-refresh the open board.
Phase 3 — Extension wiring + commands (src/extension.ts)
Update existing commands; add: mwnn-kanban.addColumn (exists), renameColumn, deleteColumn, setColumnLimits (wip + reverseWip via input boxes), and mwnn-kanban.runCardWithAI.
Run with AI (VS Code LM API): vscode.lm.selectChatModels(...), send the card's title + description + acceptance criteria, stream the model's response into the card's Activity section, and (on success) optionally move the card to the next flow column. Gate behind a settings flag; degrade gracefully if no model/consent. Register all in contributes.commands + palette menus in package.json.
New settings in package.json: mwnn-kanban.defaultReadyReverseWip (default 3), mwnn-kanban.enableRunWithAI (default true), mwnn-kanban.boardFolder (default .mwnn). Keep confirmCardDeletion; replace defaultColumns with a richer default that includes roles + the Ready reverse-WIP.
Phase 4 — Webview UI (media/board.js, media/board.css, src/boardPanel.ts)
Extend WebviewToHostMessage with: setAssignee, setDescription, openCard, addColumn/renameColumn/deleteColumn/setColumnLimits, runCardWithAI; keep state outbound. Mirror shapes in the board.js JSDoc.
Card rendering: show an assignee badge (human vs AI, color-coded) + a small picker (Unassigned / Human / AI, with optional name), and a "needs definition" marker when Description is empty.
Card detail panel (in-webview drawer or modal): edit title, description, acceptance criteria, assignee; a "Run with AI" button when assignee.kind === 'ai'. Replaces the window.prompt flows.
Column headers: show count / wipLimit with a warning style when over limit; on the Ready column show defined / reverseWip with an "under-supplied" warning when below min. Column controls: rename, delete, set limits, reorder (drag column or buttons).
Keep existing drag-and-drop for cards; wire moves to position recompute.
Phase 5 — AI contract docs (the "usable by AI agents" deliverable)
Update AGENTS.md (and add a short .mwnn/README.md written by the store on first run) documenting the board contract for agents: where files live, the card frontmatter schema, how to find work (cards where assignee.kind == ai), and the workflow — claim (note in Activity), do the work, update acceptance checkboxes, move the card by editing column/position, and respect WIP/reverse-WIP. Align with the existing .github/instructions/ai-control-file-implement.instructions.md conventions. Update README.md (features, commands, settings, storage location).
Phase 6 — Tests
Unit tests (node:test, matching existing test/unit/): serialization round-trip (parseCard(serializeCard(c)) === c), columns.json round-trip, board assembly + ordering from a fake fs, wipState/readyState math, assignee/description ops, column add/remove/rename/reorder, and v1→v2 migration. Inject a FileSystemLike (mirroring the existing MementoLike DI pattern) so the store is testable without vscode.
Files
Modify: src/types.ts, src/utils.ts, src/boardStore.ts, src/boardPanel.ts, src/extension.ts, media/board.js, media/board.css, package.json, README.md, AGENTS.md.
Add: src/serialization.ts, test/unit/serialization.test.ts, test/unit/boardStore.test.ts (extend), test/unit/boardOperations.test.ts (extend).
Verification (per .github/instructions/repo-validation.instructions.md)
npm run compile-tests then npm test — serialization round-trips, wip/reverse-wip math, assignee/column ops, and migration all green.
npm run compile (webpack) and npm run lint clean.
Extension Dev Host (F5) smoke test:
Open Board on a workspace folder → .mwnn/columns.json + .mwnn/cards/*.md created.
Add/edit/move cards; confirm each writes/updates a markdown file and the board reloads.
Set a column WIP limit and exceed it → warning shows. Drain the Ready column below its reverse-WIP → "under-supplied" warning shows.
Assign a card to AI; edit the card file by hand (simulating an agent) → board live-updates via the watcher.
"Run with AI" on an AI-assigned card → model output lands in the card's Activity (or skips cleanly if no LM available).
Migration: open a workspace whose memento holds a v1 board with no .mwnn/ → cards are written out to files with sensible roles, board renders unchanged.

## Status

- Date: 2026-06-27
- Mode: Active implementation
- Note: The pasted plan above now supersedes the earlier bootstrap checklist; live progress continues below.

## Milestones

- [x] Phase 1 - Pure serialization + model
- [x] Phase 2 - File-backed store + migration
- [x] Phase 3 - Extension wiring + commands
- [ ] Phase 4 - Webview UI for assignees and methodology
- [ ] Phase 5 - AI contract docs
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

## Next Focus

- Continue Phase 4 by adding direct column-management controls in the webview and reducing the remaining command-palette-only flows.
- After that UI work lands, run Development Host smoke tests for file watching, WIP/reverse-WIP indicators, detail-panel edits, and the LM consent/model-selection path.
