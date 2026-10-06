---
id: card-mttellf2-1
title: if there is no .mwnn folder when you do import plan it fails
column: col-mqwk2njn-4
position: -52000
assignee: { kind: human }
preferredModel.copilot: gpt-5.3-codex
preferredModel.codex: gpt-5.5
preferredModel.claude-code: sonnet
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1788916339118
updatedAt: 1791237856863
---

## Description
Import plan fails in a workspace that has no board folder yet (default `.mwnn/`). When `columns.json` is missing, `loadOrInitializeState` in `src/boardStore.ts` builds the default board in memory only, so `importPlan` in `src/extension.ts` hands the agent a Backlog column id and board path that do not exist on disk: there is no `columns.json`, no `cards/` directory, and no board `README.md`, and the agent's card writes fail or land against a column id that is not persisted.

Fix it by materializing the board on disk before the plan is handed off: if the board folder (from `mwnn-kanban.boardFolder`) has no `columns.json`, write the current default board (folder, `cards/`, `columns.json`, `README.md`) through the existing store write path, then build the prompt from the persisted column ids. Creating the folder at extension *install* time is not possible (no workspace exists then), and creating it on every activation would litter unrelated workspaces, so creation stays lazy and is triggered by import plan. Existing boards must be left untouched.

## Acceptance criteria
- [x] Running Import plan in a workspace with no board folder creates `<boardFolder>/columns.json`, `<boardFolder>/cards/`, and `<boardFolder>/README.md` before the prompt is handed off
- [x] The Backlog column id embedded in the import prompt matches a column id in the newly written `columns.json`
- [x] A card file the agent writes into `<boardFolder>/cards/` after the handoff loads onto the board in the Backlog column without a manual reload
- [x] Running Import plan when `columns.json` already exists does not rewrite or alter `columns.json` or any existing card file
- [x] A non-default `mwnn-kanban.boardFolder` value is honored (folder created at that path, not `.mwnn/`)
- [x] Merely activating the extension or opening a workspace (without importing or editing the board) still does not create the board folder
- [x] A focused unit test covers persisting the initial board when `columns.json` is absent and the no-op when it is present; `npm run compile-tests` and `npm test` pass

## Activity
### 2026-10-05T19:01:33.853Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-05T19:02:27.604Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `gpt-5.3-codex`, thinking level `high`
- codex: model `gpt-5.5`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`

### 2026-10-05T19:10:50.134Z - Anthropic Claude Code CLI implementation handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: sonnet.
Card thinking level: high.

### 2026-10-05 - Implemented by Claude Code
Root cause: `loadOrInitializeState` in `src/boardStore.ts` only wrote the default board to disk when migrating a legacy memento; a brand-new workspace with no `columns.json` and no legacy state got an in-memory-only default board, so `importPlan` in `src/extension.ts` handed agents a column id and board path that didn't exist on disk.

Fix: added `ensurePersisted()` to the `BoardStore` interface/implementation in `src/boardStore.ts` — it writes the current in-memory state through the existing `writeBoardState` path (same one used by every other mutation) only when `columns.json` is absent, and otherwise just refreshes from disk without touching any file. `importPlan` in `src/extension.ts` now calls `await store.ensurePersisted()` before computing the target Backlog column and building the prompt, so the column id handed to the agent always matches a column written to disk, and `cards/`/`README.md` exist before the handoff.

Added two unit tests in `test/unit/boardStore.test.ts`: one asserting `ensurePersisted` materializes `columns.json`, `cards/`, and `README.md` with the same column ids as the in-memory default; one asserting it is a byte-for-byte no-op (full filesystem snapshot unchanged) when `columns.json` already exists. The existing "keeps a default board in memory without creating files until the first mutation" test continues to pass unchanged, confirming plain activation still creates nothing.

Validated: `npm run compile-tests`, `npm test` (596/596 passing), `npm run compile`, `npm run lint` all clean. Did not smoke-test in a Development Host (no interactive VS Code session available here); the card file load/watcher behavior relies on existing, already-tested reload infrastructure that this change does not modify.

STATUS: DONE

### 2026-10-05T19:13:41.226Z - Run with AI parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
