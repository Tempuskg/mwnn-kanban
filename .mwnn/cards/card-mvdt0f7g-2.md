---
id: card-mvdt0f7g-2
title: add model name to the x cli running pill on the card
column: col-mqwk2njn-4
position: -84000
assignee: { kind: human }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6.1-sol
preferredModel.claude-code: sonnet
preferredModel.cursor: Gemini 3.8 Flash
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1792326651388
updatedAt: 1792345899079
---

## Description
Update the per-card running pill for local agent CLI runs to show the active CLI and its model. Show the effective requested model while the dispatch is starting or actual-model discovery is pending, then replace it with the actual model only when authoritative CLI/session evidence confirms that value. Keep the display scoped to the current card and dispatch across direct card runs, AI Loop attempts, retries, and provider switches. If no model was requested and no actual model is known, show only the CLI; never guess an actual model.

## Acceptance criteria
- [x] While a local agent CLI dispatch is running, its card pill identifies the active CLI and shows the effective requested model when one was selected; if none was selected, the pill shows only the CLI until actual-model evidence arrives.
- [x] When authoritative metadata reports the actual model, the pill updates to that name for the same dispatch, replacing the requested name; model information is not inferred from a CLI label, setting, or log text that does not confirm actual usage.
- [x] If actual-model discovery is unavailable, rejected, or malformed, no actual model is guessed; the requested model remains visible when available, otherwise the pill continues to show only the CLI.
- [x] A retry or provider switch displays the new dispatch's requested model while pending and its actual model when confirmed; status from another card or an earlier dispatch cannot overwrite the current pill.
- [x] Automated tests cover requested-to-actual updates, no requested model, unavailable actual-model evidence, and isolation between cards and dispatches for direct card runs and AI Loop attempts.
- [x] Long model names remain readable in the compact pill without changing the board layout, with the full name available on hover or equivalent accessible text.

## Activity
### 2026-10-18T12:47:00.401Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-10-18T15:39:20.532Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-10-18T15:55:17.766Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-5.5`, thinking level `high`
- codex: model `gpt-6.1-sol`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`
- cursor: model `Gemini 3.8 Flash`

### 2026-10-18T15:55:53.714Z - Auto-start held in Ready
Assigned to AI, but the card stays in Ready: "Ready" has 1 of its 3 defined cards (reverse WIP) and Backlog still has cards to define.

### 2026-10-18T16:26:50.329Z - Usage Orchestrator chose Anthropic Claude Code CLI
Stage: implementation. Anthropic Claude Code CLI reports 27% remaining, resetting 2026-10-19T09:00:00.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-18T16:26:50.926Z - Usage Orchestrator dispatch dispatch-mve1fwry-1 started
Card: card-mvdt0f7g-2 ("add model name to the x cli running pill on the card"). CLI: Anthropic Claude Code CLI. Stage: implementation.
Requested model: "sonnet" (source: the card's preferred model; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: sonnet.
Card thinking level: high.

### 2026-10-18T16:26:53.179Z - Usage Orchestrator dispatch dispatch-mve1fwry-1 model observed
Card: card-mvdt0f7g-2. CLI: Anthropic Claude Code CLI. Stage: implementation.
Actual model: "claude-sonnet-5-5" (source: Claude Code stream-json system.init.model; attempt: dispatch-mve1fwry-1).

### 2026-10-18T16:45:00.000Z - Claude Code implementation
Implemented the model on the per-card running pill.
- `src/agentCliHandoff.ts`: new `AgentCliProcessObserver.onModel` callback. `runAgentCliCardHandoff` reports the model actually passed to the CLI (requested) before launch, and reports the actual model only when `createAgentCliModelDiscovery` evidence arrives (blank values dropped). Nothing is inferred from labels, settings, or log text.
- `src/cliRunStatusTracker.ts` (new): per-dispatch tracker that stamps each `cliRunStatus` message with a `dispatchId` and the model known so far, and posts nothing after the dispatch ends. `createCliRunObserver` in `src/extension.ts` uses it, so direct card runs, AI Loop attempts, retries and provider switches each get their own dispatch.
- `src/types.ts`: `CliRunStatus` gains optional `dispatchId`, `requestedModel`, `actualModel`.
- `media/board.js` / `media/board.css`: `nextCliRunStatus` replaces the pill on a new dispatch and ignores a stale end from an earlier one; `cliRunPillView` shows the actual model over the requested one, with the full text in the title/aria-label; the model span is ellipsized at 18ch so the pill stays compact.
- Tests: `test/unit/cliRunPill.test.ts` (new) and a new suite in `test/unit/agentCliHandoff.test.ts` cover requested-to-actual, no requested model, missing/malformed metadata, retry/provider switch, card and dispatch isolation. `CHANGELOG.md` updated.
- Limitation: model discovery only runs for Usage Orchestrator/AI Loop dispatches (it changes CLI output format), so a plain direct card run shows the requested model, or only the CLI, and never an actual model.
- Validation: `npm run compile-tests`, `npm run compile`, `npm test` (828 pass, 0 fail), and `npm run lint` all pass.
- Not verified: the last acceptance criterion (long names stay compact without changing board layout) needs a visual check in a Development Host. Steps: run the `Run Extension` launch config, open the board, run a card with a long `preferredModel.<cli>` (e.g. `anthropic/claude-sonnet-5-5-extended-thinking-preview`), confirm the pill truncates with an ellipsis, the card width/layout is unchanged, and hovering shows the full model name; then confirm an AI Loop dispatch swaps the requested name for the CLI-reported one.
Initially reported as blocked: awaiting Development Host visual smoke test of the compact pill layout (all other criteria verified by automated tests); resolved in interview.

### 2026-10-18T17:18:40.336Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-18T17:25:00.000Z - Interview: static review of the compact pill (verified evidence, code only)
Verified evidence (source: `media/board.css` lines 339-453, `media/board.js` `cliRunPillView` and the card render block near line 850): the model renders in its own `.card-chip-running-model` span capped at `max-width: 18ch` with `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`; the chip has `max-width: 100%; min-width: 0` inside the wrapping `.card-meta` flex row; the full text ("<CLI> is working on this card on [requested] model <name> …") is set on both `title` and `aria-label`. This supports the last criterion but is not a visual check; the Development Host smoke test is still required and only the person can perform it.

### 2026-10-18T17:32:00.000Z - Interview: Development Host smoke test result (user-reported)
Q: Did the Development Host smoke test show a long model name truncated in the pill, the board layout unchanged, and the full name on hover?
A: "I ran the smoke test and the pill cuts the name off and hovering shows the full model name." (reported by Darren McLeod in interview chat, 2026-10-18)
Truncation: confirmed (user-reported). Full name on hover: confirmed (user-reported). Board layout unchanged: not yet stated (unknown, pending one follow-up question).

### 2026-10-18T17:36:00.000Z - Interview: board layout confirmation (user-reported)
Q: With the long model name showing, did the card keep the same width and leave the column and the cards around it in place, with no horizontal scrolling or overflow?
A: "yes" (reported by Darren McLeod in interview chat, 2026-10-18)

### 2026-10-18T17:37:00.000Z - Interview summary
- Criteria 1-5: met. Verified evidence: automated tests in `test/unit/cliRunPill.test.ts` and `test/unit/agentCliHandoff.test.ts`, plus `npm run compile-tests`, `npm run compile`, `npm test` (828 pass) and `npm run lint` passing, per the 2026-10-18T16:45 implementation entry.
- Criterion 6 (long model names readable in the compact pill, layout unchanged, full name on hover): met. User-reported: Development Host smoke test showed the name truncated, the full name on hover and the layout unchanged. Verified evidence (code only): the ellipsis CSS and the title/aria-label in `media/board.css` and `media/board.js`.
- Open criteria: none. Unresolved exceptions: none. Known limitation (in scope, recorded earlier): a plain direct card run shows the requested model or only the CLI, because model discovery runs only for Usage Orchestrator/AI Loop dispatches.
- Card column and assignee are unchanged; moving the card is left to the board's column/WIP rules.
STATUS: DONE

### 2026-10-18T18:10:00.000Z - Claude Code: thinking level added to the pill
Follow-up requested by Darren McLeod: the running pill now shows the thinking level after the model (e.g. `Claude Code running · sonnet · high`).
- `AgentCliModelStatus` and `CliRunStatus` gain an optional `thinkingLevel`, set only when the level was actually passed to the CLI (Cursor, which takes none, shows no level). No CLI confirms a level, so the hover text always calls it the thinking level the dispatch ran at, never a confirmed one.
- Files: `src/agentCliHandoff.ts`, `src/cliRunStatusTracker.ts`, `src/types.ts`, `media/board.js`, `media/board.css` (level ellipsized at 10ch), `CHANGELOG.md`.
- Tests: new cases in `test/unit/cliRunPill.test.ts` and `test/unit/agentCliHandoff.test.ts`. `npm run compile-tests`, `npm run compile`, `npm test` (833 pass, 0 fail) and `npm run lint` pass.
- Not verified: Development Host visual check of the pill with both a long model and a thinking level.

### 2026-10-18T18:30:00.000Z - Claude Code: pill and command preview span the card
Follow-up requested by Darren McLeod: the running pill and the live command preview now sit in their own `.card-run` row spanning the full card width, below the title and action buttons, instead of inside the narrower body column. The model name now uses the full pill width before it is ellipsized; the thinking level stays capped at 10ch. `npm test` (833 pass), `npm run compile` and `npm run lint` pass. Not verified: Development Host visual check.
