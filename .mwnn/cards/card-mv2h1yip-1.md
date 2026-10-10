---
id: card-mv2h1yip-1
title: Examine all commands and determine which ones should have buttons on the ui
column: col-mqwk2njn-4
position: -67000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6.1-sol
preferredModel.claude-code: sonnet
preferredModel.cursor: Gemini 3.8 Flash
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1791641439745
updatedAt: 1791644433431
---

## Description
Audit only — do not add any buttons in this card. Go through every command contributed in `package.json` (`contributes.commands`: 19 `mwnn-kanban.*` and 12 `mwnn-kanban-pro.*` commands) and decide, for each one, whether it should be reachable from a visible UI control (board webview toolbar/column/card controls, the sidebar loop view, the My Work view title/inline actions, or the editor/view title bar) in addition to the Command Palette. Some are already surfaced: the sidebar has Import Plan and play/pause/stop loop controls, the sidebar title has Agent CLI Models, My Work has Portfolio/Rescan plus Start/Stop Timer and Focus inline actions, and the board webview already covers add/rename/delete/limit columns and Run Card with AI. Many others are palette-only today, e.g. Stop Card AI Run, Reset Board, Populate/Manage Agent CLI Models, the Pro license commands, Correct Last Session, Open/Export Timesheet, Export Review Digest, Show AI Usage, Stop Focus Session, and Set Allocation Targets.

The output is a written decision record plus Backlog follow-up cards for the buttons worth adding, so implementation can be scheduled and reviewed slice by slice.

## Acceptance criteria
- [x] A wiki page `wiki/command-ui-surfaces.md` (with standard wiki frontmatter, and listed in `wiki/index.md` and `wiki/log.md`) contains a table covering every command id in `package.json` `contributes.commands` — none missing, none invented
- [x] Each table row records: command id, title, current UI surface(s) (or "palette only"), gating `when` clause (e.g. `enableRunWithAI`, `hasProLicense`), the decision (add button / keep as-is / palette only), and a one-line rationale
- [x] Each "add button" decision names the target surface (board webview, sidebar view, My Work view title/inline, or view/editor title) and the conditions under which the button is visible (license, setting, loop/run state)
- [x] Destructive or rarely used commands (e.g. Reset Board, Clear Pro License Key) carry an explicit decision on whether they get a button, and any button for them requires extension-host confirmation (webviews cannot use `window.confirm`)
- [x] Existing surfaces that duplicate or conflict with each other are flagged in the page
- [x] For each "add button" decision (or a logical group of them, e.g. one per surface), a Backlog card exists in `.mwnn/cards/` following the MWNN Card Authoring contract, with a non-empty Description and Acceptance criteria, and the page links each decision to its card id
- [x] No source, `package.json`, or webview code is changed by this card

## Activity
### 2026-10-10T14:10:54.769Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-10T14:11:34.271Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-10T14:44:30.323Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-10T14:45:31.330Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-5.5`, thinking level `high`
- codex: model `gpt-6.1-sol`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`
- cursor: model `Gemini 3.8 Flash`

### 2026-10-10T14:50:35.446Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-10 - Command UI audit completed by Claude Code
Model note: the card prefers `sonnet`, but this agent could not switch models; the work was done with Claude Opus 5.5 (`claude-opus-5-5`).
- Created `wiki/command-ui-surfaces.md`, plus a new `wiki/index.md` and `wiki/log.md` because the wiki did not exist yet. The decision table covers all 31 `contributes.commands` ids, script-verified against `package.json` with none missing, none invented, and titles matching. Each row records the current surface, gating `when`, decision, target surface and visibility, rationale, and card.
- Decisions: 11 add button, 16 keep as-is, 4 palette only. Reset Board and Clear Pro License Key stay palette-only with no button, and keep their existing host modals.
- Flagged seven duplicates and conflicts: Portfolio has two surfaces; three Agent CLI model commands overlap; the board model picker opens raw settings instead of the panel; Start and Stop Timer are both always shown; Import Plan's sidebar button ignores `enableRunWithAI`; "Correct Timesheet" is a misleading title; and stopCardRun's abort-all scope does not match the per-card board.
- Created Backlog follow-up cards card-mv2ik8oc-1 through card-mv2ik8oc-5, each linked from the page.
- No source, `package.json`, or webview files were changed by this card.
STATUS: DONE
