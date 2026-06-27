# MWNN Kanban

An in-editor Kanban board for VS Code, built for the **Methodology With No Name
(MWNN)**. Track tasks across columns with drag-and-drop, stored per workspace.

## Features

- Board webview with configurable columns (defaults: To Do / In Progress / Done).
- Add, edit (double-click), delete, and drag cards between columns.
- Board state persists per workspace via VS Code workspace state.

## Commands

| Command | Description |
| --- | --- |
| `MWNN Kanban: Open Board` | Open (or focus) the board panel. |
| `MWNN Kanban: Add Column` | Add a new column. |
| `MWNN Kanban: Reset Board` | Clear all cards and recreate default columns. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `mwnn-kanban.defaultColumns` | `["To Do", "In Progress", "Done"]` | Columns created for a new or reset board. |
| `mwnn-kanban.confirmCardDeletion` | `true` | Confirm before deleting a card. |

## Development

```powershell
npm install
npm run compile          # bundle the extension host (dist/extension.js)
npm run compile-tests    # compile unit tests to dist-test/
npm test                 # run unit tests (node:test)
npm run lint             # ESLint
```

Press `F5` (Run Extension) to launch an Extension Development Host, then run
**MWNN Kanban: Open Board** from the Command Palette.

## Architecture

The extension host (Node, `src/`) and the board UI (browser, `media/board.js`)
run in separate contexts and communicate only via `postMessage`. The message
protocol and board model are declared once in [`src/types.ts`](src/types.ts) so
both sides type-check against the same contract. See [`AGENTS.md`](AGENTS.md)
and [`.github/copilot-instructions.md`](.github/copilot-instructions.md) for the
full conventions.
