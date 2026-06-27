# MWNN Kanban

An in-editor Kanban board for VS Code built around the Methodology With No Name (MWNN). The board lives in workspace files, supports human and AI assignees, and keeps methodology signals like WIP and reverse-WIP visible directly in the editor.

## Features

- Git-trackable board storage in `.mwnn/` by default, with one markdown file per card and live reload when those files change.
- Default MWNN board shape of `Backlog`, `Ready`, `In Progress`, and `Done`, with editable columns, WIP limits, and Ready reverse-WIP support.
- Card detail editing in the webview for title, description, acceptance criteria, assignee, and activity history.
- Human and AI assignees with a `Run Card with AI` command and in-board action for AI-assigned work.
- Drag-and-drop card movement plus direct column add, rename, delete, limit, and reorder flows from the board UI.

## Commands

| Command | Description |
| --- | --- |
| `MWNN Kanban: Open Board` | Open or focus the board panel. |
| `MWNN Kanban: Add Column` | Add a new column. |
| `MWNN Kanban: Rename Column` | Rename an existing column. |
| `MWNN Kanban: Delete Column` | Delete a column, optionally moving its cards into another column first. |
| `MWNN Kanban: Set Column Limits` | Set a WIP limit and Ready reverse-WIP minimum for a column. |
| `MWNN Kanban: Run Card with AI` | Pick an AI-assigned card, run it with an available VS Code chat model, and append the response to card activity. |
| `MWNN Kanban: Reset Board` | Clear all cards and recreate the default board. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `mwnn-kanban.defaultColumns` | `["Backlog", "Ready", "In Progress", "Done"]` | Columns created for a new or reset board. Roles are inferred from these titles. |
| `mwnn-kanban.confirmCardDeletion` | `true` | Confirm before deleting a card. |
| `mwnn-kanban.boardFolder` | `.mwnn` | Workspace-relative folder that stores the board files. |
| `mwnn-kanban.defaultReadyReverseWip` | `3` | Default minimum number of defined cards the Ready column should keep available. |
| `mwnn-kanban.enableRunWithAI` | `true` | Enable AI-assisted board actions when supported language models are available. |

## Board Files

The board requires an open workspace folder. On first run, the extension creates the board folder and writes:

- `.mwnn/columns.json` for column order, roles, and limit metadata.
- `.mwnn/cards/<card-id>.md` for one markdown file per card.
- `.mwnn/README.md` for a local description of the board contract.

The extension watches `.mwnn/**` and reloads the board after external edits, which makes the filesystem contract usable for humans and coding agents alike.

## AI Collaboration

The primary AI contract lives in `AGENTS.md`. In short:

- AI-assigned work is represented by card frontmatter such as `assignee: { kind: ai, name: Codex }`.
- Agents should usually claim work in the `## Activity` section, keep `## Acceptance criteria` current, and move cards by editing the `column` and `position` frontmatter.
- Ready reverse-WIP depends on cards having a non-empty `## Description`, so agents should define work clearly before draining the Ready column.

## Development

```powershell
npm install
npm run compile          # bundle the extension host (dist/extension.js)
npm run compile-tests    # compile unit tests to dist-test/
npm test                 # run unit tests (node:test)
npm run lint             # ESLint
```

Press `F5` to launch an Extension Development Host, then run `MWNN Kanban: Open Board` from the Command Palette.

## Architecture

The extension host (`src/`) and the board UI (`media/board.js`) run in separate contexts and communicate only through `postMessage`. Shared message types and board models live in `src/types.ts`, the board persistence layer lives in `src/boardStore.ts`, and the board contract for direct editors is documented in `AGENTS.md` plus the generated `.mwnn/README.md`.
