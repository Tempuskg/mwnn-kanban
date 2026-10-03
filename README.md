# MWNN Kanban

[![VS Marketplace v0.0.13](https://img.shields.io/badge/VS%20Marketplace-v0.0.13-007ACC)](https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.mwnn-kanban)
[![Open VSX](https://img.shields.io/open-vsx/v/darrenjmcleod/mwnn-kanban?label=Open%20VSX)](https://open-vsx.org/extension/darrenjmcleod/mwnn-kanban)

An in-editor Kanban board for VS Code built around the [Methodology With No Name (MWNN)](https://www.darrenmcleod.com/2025/07/kanban-and-methodology-with-no-name.html). The board lives in workspace files, supports human and AI assignees, and keeps methodology signals like WIP and reverse-WIP visible directly in the editor.

## Features

- Git-trackable board storage in `.mwnn/` by default, with one markdown file per card and live reload when those files change.
- Default MWNN board shape of `Backlog`, `Ready`, `In Progress`, `Verify`, and `Done`, with editable columns, WIP limits, and Ready reverse-WIP support.
- Card detail editing in the webview for title, description, acceptance criteria, assignee, and activity history.
- Human and AI assignees with a `Run Card with AI` command and in-board action for AI-assigned work, targeting either a VS Code chat extension or a local agent CLI.
- A cancellable AI board loop that runs definition and implementation handoffs through a supported VS Code chat extension or a locally installed Copilot, Codex, Claude Code, or Cursor Agent CLI.
- AI definition fill for undefined cards: dragging a card without a Description into the Ready column offers to have AI write its Description and Acceptance criteria, and the card detail panel exposes a `Fill in with AI` button whenever both are empty. Definition fills can target a VS Code chat extension or a local agent CLI.
- Drag-and-drop card movement plus direct column add, rename, delete, limit, and reorder flows from the board UI.
- A Pro-only `Portfolio` button in the MWNN Kanban sidebar that opens the Pro Portfolio dashboard. It is shown only while a Pro license or live trial is active, appears or disappears as soon as a license key is entered or cleared, and is absent entirely otherwise.

## Privacy and network access

MWNN Kanban never transmits usage, board, or time data. When a Pro license is validated, the extension contacts Polar and sends the license key; the validation result is cached locally for up to 24 hours. This license check is the only network request MWNN Kanban makes directly. AI handoffs run through the chat extension or local agent CLI you choose and are subject to that provider's privacy terms.

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
| `mwnn-kanban.aiLoopCliFallbackEnabled` | `false` | Let the AI loop continue on another agent CLI when the active CLI reports exhausted credits or a spent usage/session limit. |
| `mwnn-kanban.aiLoopCliFallbackOrder` | `[]` | Ordered agent CLIs the loop falls back to when CLI fallback is enabled. |
| `mwnn-kanban.aiLoopModelEscalationEnabled` | `false` | Let the AI loop retry a card stage on a stronger model when the attempt reports `STATUS: BLOCKED` or produces no stage completion evidence. |
| `mwnn-kanban.aiLoopModelEscalationLadder` | `{}` | Ordered model names the loop escalates through for each agent CLI, cheapest first. |
| `mwnn-kanban.aiLoopModelEscalationOverridesCardModel` | `false` | Let escalation replace a model a card names for the active provider in its own `preferredModel.<provider>`. Off by default, so an explicit card model is left alone. |
| `mwnn-kanban.aiLoopMaxDispatches` | `0` | Maximum agent handoffs one AI loop run may dispatch before it stops. `0` disables the cap and leaves run length unchanged. |
| `mwnn-kanban.agentCliPaths` | `{}` | Optional executable-path overrides for each agent CLI provider, used by both `Run Card with AI` and the AI loop. The `copilot` value may point to either `copilot` or `gh`. Full paths containing spaces are supported. |
| `mwnn-kanban.agentCliModels` | `{}` | Model names per agent CLI provider. The first entry for a provider is the model used when a card names no model for that provider; the rest are that provider's other known models. Leave a provider out to use its own default model. |
| `mwnn-kanban.agentCliStageModels` | `{}` | Model per AI loop stage (`definition`, `triage`, `implementation`, `verification`), overriding `mwnn-kanban.agentCliModels` for that stage. A model the card names for the active CLI still wins. |
| `mwnn-kanban.agentCliThinkingLevels` | `{}` | Thinking level (reasoning effort) per agent CLI, passed through unchanged. Only CLIs that expose reasoning effort can honor it — today OpenAI Codex CLI; elsewhere the level is reported as not applied and the run proceeds at the CLI's default effort. |
| `mwnn-kanban.agentCliStageThinkingLevels` | `{}` | Thinking level per AI loop stage, overriding `mwnn-kanban.agentCliThinkingLevels` for that stage. A level the card names for the active CLI still wins. |
| `mwnn-kanban.chatProviderCommands` | `{}` | Optional VS Code command overrides for interactive chat handoffs, including AI Loop chat mode. |

## AI Loop Providers

With the default `prompt` setting, the loop first offers both execution channels: `VS Code chat extension` for interactive handoffs to GitHub Copilot, Codex (ChatGPT), or Claude Code, and `Local agent CLI` for synchronous non-interactive execution. Set `mwnn-kanban.aiLoopProvider` to `chat` to always use the chat-extension picker.

`mwnn-kanban.aiLoopVerifyCards` is off (`false`) by default. When it is off, the loop stops automating an AI-assigned card in the Verify column and assigns it to a human for verification. When it is on, the selected provider verifies the card against its acceptance criteria and records one of the requested Activity markers: `VERIFY: PASS`, `VERIFY: FAIL: <reason>`, or `VERIFY: HUMAN: <reason>` when it cannot verify the work. A passing verification is the only case in which the loop moves a card to Done. A failure, a cannot-verify verdict, an unavailable verification handoff, or any other non-passing outcome leaves the card in Verify, assigns it to a human, and records the reason in the card's Activity.

The execution channels differ when an agent produces no verdict. A local CLI run is synchronous, so if the process ends without a valid `VERIFY:` marker, the loop hands the card back to a human and records why. A chat handoff is asynchronous: if it never writes a valid `VERIFY:` marker, the loop keeps waiting and shows a live elapsed-time progress line until you stop the loop.

In CLI mode, the loop invokes each provider with the existing MWNN definition, triage, implementation, or verification prompt and the active workspace as its working directory. Executables are discovered on `PATH`, or can be configured as full paths in `mwnn-kanban.agentCliPaths`. The path is never split into a shell command, so paths containing spaces are safe.

| Provider | Default launcher | Official non-interactive capability |
| --- | --- | --- |
| GitHub Copilot CLI | `copilot` (preferred), then modern `gh copilot` | [`copilot` programmatic mode](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference) and the [`gh copilot` passthrough](https://cli.github.com/manual/gh_copilot) |
| OpenAI Codex CLI | `codex` | [`codex exec` non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) |
| Anthropic Claude Code CLI | `claude` | [`claude -p` print mode](https://code.claude.com/docs/en/cli-usage) |
| Cursor Agent CLI | `cursor-agent` | [Headless `--print` mode with `--force` file edits](https://docs.cursor.com/en/cli/headless) |

For the Copilot provider, MWNN Kanban prefers an available standalone `copilot` executable and otherwise uses GitHub CLI's modern built-in `gh copilot` passthrough. A `mwnn-kanban.agentCliPaths["copilot"]` override may identify either executable. The archived `github/gh-copilot` extension—which offered only command suggestion and explanation—is not an agentic launcher and is intentionally unsupported.

Cursor was verified against its official headless CLI documentation on 2026-07-24 and supports equivalent non-interactive file-modifying agent execution, so it is a full loop provider rather than an unsupported placeholder.

### Credit fallback between CLIs

CLI fallback is off by default: an exhausted CLI stops the loop exactly as any other failure does. Turn on `mwnn-kanban.aiLoopCliFallbackEnabled` and list providers in `mwnn-kanban.aiLoopCliFallbackOrder` to let the loop continue when the active CLI reports exhausted credits or a spent usage/session limit.

Only that failure triggers a switch. Authentication errors, network failures, transient rate limits, plain nonzero exits, and missing completion evidence keep the existing single-CLI behavior — a stage that simply did not finish is handled by model escalation below, not by changing CLI. The failed process always ends first; the replacement then retries the *same* stage for the same card in the same workspace, receiving the latest card contents plus a note explaining the interruption, so existing edits, checked acceptance criteria, and Activity history are kept. A switch alone never advances a card — the replacement must still satisfy the stage's completion evidence.

Each provider is tried at most once per loop run: duplicates, the exhausted CLI, and CLIs whose executable is unavailable are skipped, and a provider that exhausts its allowance is not retried during that run. When no eligible CLI is left, the loop pauses without advancing the interrupted card and tells you to restore credits or configure an available CLI. Every switch is shown in loop progress and recorded in the card's Activity with the time, interrupted stage, previous CLI, replacement CLI, and reason. Your saved `mwnn-kanban.aiLoopProvider` preference is never changed.

### Model escalation after a failed attempt

Escalation is off by default: an attempt that does not finish stops the card exactly as before. Turn on `mwnn-kanban.aiLoopModelEscalationEnabled` and list models per CLI, cheapest first, in `mwnn-kanban.aiLoopModelEscalationLadder` to run cards on the cheap model first and let the loop reach for a stronger one only when it has to.

This is a ladder, not a guess about which cards look hard. Exactly two outcomes escalate, and both mean the attempt was inconclusive: the agent reported `STATUS: BLOCKED`, or it exited cleanly without the stage's required completion evidence. Spent credits (handled by the CLI fallback above), authentication errors, network failures, cancellation, and a model name the CLI rejects never escalate — a stronger model cannot fix any of them, and retrying would spend the expensive model on a fault you still have to fix.

The failed process always ends first, and only one hand-off is ever in flight, so a repeated failure signal cannot start a duplicate run. The retry gets the same workspace, the same card, and the same stage instructions, plus the reason it was escalated, so existing edits, checked acceptance criteria, and Activity history are kept. An escalation never advances a card on its own: the stronger model still has to satisfy the same completion and verification evidence rules.

Escalation is bounded. Each model is tried at most once per card per loop run, so a card walks its ladder once and then stops rather than cycling between models; when the ladder runs out, the original failure stands. A card that names its own model for the active provider is left on that model unless you opt in with `mwnn-kanban.aiLoopModelEscalationOverridesCardModel`. Credit fallback and escalation compose: switching CLI costs no escalation step, and the replacement CLI climbs its own ladder from the bottom, since model names are CLI-specific. Every escalation appears in loop progress and is recorded in the card's Activity with the time, stage, previous model, replacement model, and trigger reason.

### Run usage and the dispatch budget

Every loop run reports what it dispatched when it ends: the number of agent handoffs it launched, grouped by stage and by the model each one actually ran on. The report is shown however the run ends — finished, cancelled, paused because no CLI has allowance left, or stopped on budget — and says which of those it was, so a run stopped by the cap is never mistaken for one that simply had nothing left to do.

Usage and cost figures are only ever lines a CLI printed itself, quoted and attributed to that CLI. MWNN Kanban ships no per-model price table and never estimates: prices change between releases and the CLIs do not report usage in any shared format, so an invented figure would look authoritative and be wrong. A CLI that reports nothing shows dispatch counts and nothing else.

The dispatch budget is off by default (`mwnn-kanban.aiLoopMaxDispatches` is `0`), which leaves run length and behavior unchanged. Set a positive number to stop a run once it has launched that many handoffs. Every launched process counts, including credit-fallback replacements and model-escalation retries, so the cap bounds what a run actually spends rather than only how many cards it touched.

The cap is checked *before* a handoff starts, never during one. Reaching it stops the run with no CLI process running and the in-flight card untouched: it keeps its column and assignee, is not advanced, and gains one Activity entry naming the configured budget — explicitly not spent credits — and no further handoffs are launched afterwards. The notification names the cap and tells you to raise or clear `mwnn-kanban.aiLoopMaxDispatches`.

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
- A card can name the AI model it should be run with **per agent CLI**, via optional `preferredModel.<provider>` frontmatter keys (also editable on the card in the board: pick the CLI, then pick a model from that CLI's configured list or type any other name), where `<provider>` is `copilot`, `codex`, `claude-code`, or `cursor`. The model is scoped per provider because a card never chooses its own CLI: the CLI is picked at dispatch and the credit fallback can swap it mid-run, so a single name would be valid for only one of the four. Each value is free-form and the entry for whichever provider actually runs is passed straight through to that CLI as its model argument, or stated in the prompt for a chat hand-off. Leave a provider out to use the rule for the AI loop stage being run (`mwnn-kanban.agentCliStageModels`), else the workspace default for that CLI (`mwnn-kanban.agentCliModels`), else that CLI's own default model when none is set.
- A single bare `preferredModel` scalar is the legacy, pre-scoping shape: it still applies to every provider the card does not scope explicitly, and is migrated to the per-provider keys the next time the extension writes that card.
- A workspace default model per agent CLI lives in `mwnn-kanban.agentCliModels`, whose first entry for a provider is that provider's default. A model the card names for the active provider always wins, and a workspace default is never written into a card file.
- A card can also name the *thinking level* (reasoning effort) it should be run at, per agent CLI, via optional `thinkingLevel.<provider>` frontmatter keys. It is independent of the model and resolves the same way: the card, then `mwnn-kanban.agentCliStageThinkingLevels`, then `mwnn-kanban.agentCliThinkingLevels`, then the CLI's own default effort. A level a CLI cannot apply is recorded on the card as not applied and never fails the run.

## Development

```powershell
npm install
npm run compile          # bundle the extension host (dist/extension.js)
npm run compile-tests    # compile unit tests to dist-test/
npm test                 # run unit tests (node:test)
npm run lint             # ESLint
npm run smoke:agent-cli -- codex # isolated live smoke for one installed provider
npm run smoke:card-model # per-card model end-to-end smoke (simulated CLIs, no credits)
```

### Local Pro package stub

The extension resolves the optional `@tempuskg/mwnn-kanban-pro` package at runtime. To exercise that loading boundary without GitHub Packages credentials, build and link the repository's no-op stub:

```powershell
npm run link:pro-stub
npm run compile
```

`link:pro-stub` builds `mwnn-kanban-pro/dist/index.js` and links the package into `node_modules` without changing `package.json` or `package-lock.json`. Re-run it after an `npm install` replaces the link. The stub only confirms that package discovery and registration work; it does not implement or unlock paid features.

Press `F5` to launch an Extension Development Host, then run `MWNN Kanban: Open Board` from the Command Palette.

## Architecture

The extension host (`src/`) and the board UI (`media/board.js`) run in separate contexts and communicate only through `postMessage`. Shared message types and board models live in `src/types.ts`, the board persistence layer lives in `src/boardStore.ts`, and the board contract for direct editors is documented in `AGENTS.md` plus the generated `.mwnn/README.md`.
