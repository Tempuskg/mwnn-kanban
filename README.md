# MWNN Kanban

[![VS Marketplace v0.0.1](https://img.shields.io/badge/VS%20Marketplace-v0.0.1-007ACC)](https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.mwnn-kanban)
[![Open VSX](https://img.shields.io/open-vsx/v/darrenjmcleod/mwnn-kanban?label=Open%20VSX)](https://open-vsx.org/extension/darrenjmcleod/mwnn-kanban)

An in-editor Kanban board for VS Code built around the Methodology With No Name (MWNN). The board lives in workspace files, supports human and AI assignees, and keeps methodology signals like WIP and reverse-WIP visible directly in the editor.

## Features

- Git-trackable board storage in `.mwnn/` by default, with one markdown file per card and live reload when those files change.
- Default MWNN board shape of `Backlog`, `Ready`, `In Progress`, `Verify`, and `Done`, with editable columns, WIP limits, and Ready reverse-WIP support.
- Card detail editing in the webview for title, description, acceptance criteria, assignee, and activity history.
- Human and AI assignees with a `Run Card with AI` command and in-board action for AI-assigned work, targeting either a VS Code chat extension or a local agent CLI.
- A cancellable AI board loop that runs definition and implementation handoffs through a supported VS Code chat extension or a locally installed Copilot, Codex, Claude Code, or Cursor Agent CLI.
- AI definition fill for undefined cards: dragging a card without a Description into the Ready column offers to have AI write its Description and Acceptance criteria, and the card detail panel exposes a `Fill in with AI` button whenever both are empty. Definition fills can target a VS Code chat extension or a local agent CLI.
- Drag-and-drop card movement plus direct column add, rename, delete, limit, and reorder flows from the board UI.

## Commands

| Command | Description |
| --- | --- |
| `MWNN Kanban: Open Board` | Open or focus the board panel. |
| `MWNN Kanban: Add Column` | Add a new column. |
| `MWNN Kanban: Rename Column` | Rename an existing column. |
| `MWNN Kanban: Delete Column` | Delete a column, optionally moving its cards into another column first. |
| `MWNN Kanban: Set Column Limits` | Set a WIP limit and Ready reverse-WIP minimum for a column. |
| `MWNN Kanban: Run Card with AI` | Pick an AI-assigned card and hand it to a VS Code chat extension or run it with a locally installed agent CLI, recording the dispatch in card activity. |
| `MWNN Kanban: Run Board with AI Loop` | Process eligible board cards through a selected VS Code chat extension or local non-interactive agent CLI. |
| `MWNN Kanban: Stop AI Loop` | Stop the loop and cancel an active CLI process without advancing its card. |
| `MWNN Kanban: Stop Card AI Run` | Cancel the active per-card local agent CLI run without advancing its card. |
| `MWNN Kanban: Import Plan` | Hand a local plan path or clipboard text to an available VS Code AI chat provider for card import. |
| `MWNN Kanban: Reset Board` | Clear all cards and recreate the default board. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `mwnn-kanban.defaultColumns` | `["Backlog", "Ready", "In Progress", "Verify", "Done"]` | Columns created for a new or reset board. Roles are inferred from these titles. |
| `mwnn-kanban.confirmCardDeletion` | `true` | Confirm before deleting a card. |
| `mwnn-kanban.boardFolder` | `.mwnn` | Workspace-relative folder that stores the board files. |
| `mwnn-kanban.defaultReadyReverseWip` | `3` | Default minimum number of defined cards the Ready column should keep available. |
| `mwnn-kanban.enableRunWithAI` | `true` | Enable AI-assisted board actions when supported language models are available. |
| `mwnn-kanban.aiLoopProvider` | `prompt` | Choose `chat`, `copilot`, `codex`, `claude-code`, or `cursor`; `prompt` asks whether to use a VS Code chat extension or local CLI. |
| `mwnn-kanban.aiLoopReviewFreshDefinitions` | `false` | Pause newly AI-defined cards in Ready until the next loop run so a human can review the definition first. |
| `mwnn-kanban.aiLoopVerifyCards` | `false` | Let the AI loop verify AI-assigned cards in the Verify column. When off, the loop assigns those cards to a human for verification. |
| `mwnn-kanban.agentCliPaths` | `{}` | Optional executable-path overrides for each agent CLI provider, used by both `Run Card with AI` and the AI loop. Full paths containing spaces are supported. |
| `mwnn-kanban.chatProviderCommands` | `{}` | Optional VS Code command overrides for interactive chat handoffs, including AI Loop chat mode. |

## AI Loop Providers

With the default `prompt` setting, the loop first offers both execution channels: `VS Code chat extension` for interactive handoffs to GitHub Copilot, Codex (ChatGPT), or Claude Code, and `Local agent CLI` for synchronous non-interactive execution. Set `mwnn-kanban.aiLoopProvider` to `chat` to always use the chat-extension picker.

`mwnn-kanban.aiLoopVerifyCards` is off (`false`) by default. When it is off, the loop stops automating an AI-assigned card in the Verify column and assigns it to a human for verification. When it is on, the selected provider verifies the card against its acceptance criteria and records one of the requested Activity markers: `VERIFY: PASS`, `VERIFY: FAIL: <reason>`, or `VERIFY: HUMAN: <reason>` when it cannot verify the work. A passing verification is the only case in which the loop moves a card to Done. A failure, a cannot-verify verdict, an unavailable verification handoff, or any other non-passing outcome leaves the card in Verify, assigns it to a human, and records the reason in the card's Activity.

The execution channels differ when an agent produces no verdict. A local CLI run is synchronous, so if the process ends without a valid `VERIFY:` marker, the loop hands the card back to a human and records why. A chat handoff is asynchronous: if it never writes a valid `VERIFY:` marker, the loop keeps waiting and shows a live elapsed-time progress line until you stop the loop.

In CLI mode, the loop invokes each provider with the existing MWNN definition, triage, or implementation prompt and the active workspace as its working directory. Executables are discovered on `PATH`, or can be configured as full paths in `mwnn-kanban.agentCliPaths`. The path is never split into a shell command, so paths containing spaces are safe.

| Provider | Default executable | Official non-interactive capability |
| --- | --- | --- |
| GitHub Copilot CLI | `copilot` | [`-p` programmatic mode](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference) |
| OpenAI Codex CLI | `codex` | [`codex exec` non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) |
| Anthropic Claude Code CLI | `claude` | [`claude -p` print mode](https://code.claude.com/docs/en/cli-usage) |
| Cursor Agent CLI | `cursor-agent` | [Headless `--print` mode with `--force` file edits](https://docs.cursor.com/en/cli/headless) |

Cursor was verified against its official headless CLI documentation on 2026-07-24 and supports equivalent non-interactive file-modifying agent execution, so it is a full loop provider rather than an unsupported placeholder.

In CLI mode, the loop waits for the process to exit and then reloads the card file. Implementation succeeds only when the process exits successfully and newly appended Activity contains `STATUS: DONE` or `STATUS: BLOCKED: <reason>`; definition and triage handoffs require their corresponding card-file edits. Missing executables, start failures, nonzero exits, and missing or invalid evidence leave the card in place and add a recoverable failure entry. Stopping the loop terminates the active child process and records a cancellation without marking the card complete.

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
npm run smoke:agent-cli -- codex # isolated live smoke for one installed provider
```

Press `F5` to launch an Extension Development Host, then run `MWNN Kanban: Open Board` from the Command Palette.

## Publishing

The same `mwnn-kanban.vsix` artifact is published to both registries. Before the first release, create or confirm the `darrenjmcleod` publisher in the [Visual Studio Marketplace publisher portal](https://marketplace.visualstudio.com/manage/publishers/) and create a token for all accessible organizations with the `Marketplace (Manage)` scope. Then create the matching Open VSX namespace after signing the Eclipse Publisher Agreement:

```powershell
$env:OVSX_PAT = '<open-vsx-token>'
npx --yes ovsx create-namespace darrenjmcleod -p $env:OVSX_PAT
```

Validate and package a release locally:

```powershell
npm ci
npm run compile-tests
npm run compile
npm test
npm run lint
npm run package:vsix
```

Publish that exact artifact after setting registry tokens in the current PowerShell session:

```powershell
$env:VSCE_PAT = '<visual-studio-marketplace-token>'
$env:OVSX_PAT = '<open-vsx-token>'
npx --yes @vscode/vsce publish --packagePath .\mwnn-kanban.vsix -p $env:VSCE_PAT
npx --yes ovsx publish .\mwnn-kanban.vsix -p $env:OVSX_PAT
```

For automated releases, add repository secrets named `VSCE_PAT` and `OVSX_PAT`. Pushing a tag that exactly matches the manifest version (for example, `v0.0.1`) or manually dispatching the `Release extension` workflow validates the extension, builds one VSIX, uploads it as a workflow artifact, and publishes that same file to both registries. Run `npm run version:build` for a patch bump; it updates `package.json`, `package-lock.json`, and the VS Marketplace version badge without creating a commit or tag.

> **Marketplace authentication:** Microsoft has announced that global Azure DevOps PATs will stop working on December 1, 2026. The `VSCE_PAT` flow above is valid for the initial release, but the VS Marketplace publishing job must be migrated to [Microsoft Entra ID secure automated publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace) before that date. Open VSX continues to use its own access token.

## Architecture

The extension host (`src/`) and the board UI (`media/board.js`) run in separate contexts and communicate only through `postMessage`. Shared message types and board models live in `src/types.ts`, the board persistence layer lives in `src/boardStore.ts`, and the board contract for direct editors is documented in `AGENTS.md` plus the generated `.mwnn/README.md`.
