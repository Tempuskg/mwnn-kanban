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

- Date: 2026-06-26
- Mode: Active implementation
- Note: `docs/implementation_plan.md` was empty at the start of this turn, so this plan is being seeded from the current repository state and updated as implementation progresses.

## Milestones

- [x] Harden core board operations against blank titles and invalid move targets.
- [x] Expand unit coverage around board-store and protocol edge cases.
- [x] Improve webview UX and accessibility for card and column interactions.
- [ ] Run broader validation and capture follow-up cleanup.

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

## Next Focus

- Run a manual Development Host smoke test for drag/drop, edit, delete, and empty-column flows.
- Capture any follow-up cleanup that appears during interactive testing.
