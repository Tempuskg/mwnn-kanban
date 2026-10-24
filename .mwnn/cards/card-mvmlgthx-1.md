---
id: card-mvmlgthx-1
title: Fix cursor agent cli runs output to MWNN Agent CLI output window doesn't update until it is finished. Would prefer if it updated as it's running.
column: col-mqxta6ho-4
position: 0
assignee: { kind: human }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6.1-sol
preferredModel.claude-code: sonnet
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1792858175061
updatedAt: 1792859719011
---

## Description
Cursor Agent CLI handoffs (the `cursor` provider and `cursor-other`, which shares its spec) spawn `cursor-agent -p --force --output-format text`. In print mode the `text` format emits only the final response once the agent finishes, so the "MWNN Agent CLI" output channel shows the `▶` start header and then nothing until exit. The user can't tell whether a long Define or Run handoff is progressing or stuck, and the board's CLI status pill and progress text have nothing to show either.

The process plumbing already streams. `runAgentCliProcess` forwards every stdout chunk to `observer.onOutput`, and `createCliOutputFeed` (`src/agentCliFeedback.ts`) writes each complete line to the channel and to the throttled status ticker in `createCliRunObserver` (`src/extension.ts`). The gap is the output format plus the lack of a readable renderer.

Switch Cursor's dispatch argv in `PROVIDER_SPECS` (`src/agentCliHandoff.ts`) to `--output-format stream-json`, which is what `modelDiscoveryArgs` already uses for Usage Orchestrator attempts. Add `--stream-partial-output` if the installed CLI supports it. Then add a pure renderer that turns each newline-delimited JSON event into readable lines as it arrives:
- assistant text
- a one-line summary for each tool call (file read or written, shell command run)
- the final result with its duration

Raw JSON must never reach the channel or the status ticker. Lines that aren't valid JSON pass through unchanged. Orchestrated Cursor attempts, which already run with stream-json and currently dump raw JSON into the channel, get the same rendering.

Several checks currently scan raw stdout, and they must keep working with the new format:
- credit and usage-limit exhaustion (`src/agentCliCredit.ts`)
- model rejection (`detectModelRejection`)
- the exit-failure summary (`conciseProcessOutput`)
- AI loop budget usage lines (`parseCliUsageLines`)
- actual-model discovery (`src/agentCliModelDiscovery.ts`)

Completion evidence reads the card file, not stdout, so it is unaffected.

All work happens in the free repo, `e:\mwnn-kanban`; this Pro repo is not touched. Out of scope: Claude Code, which buffers the same way under `--output-format text` and can be a follow-up card. Copilot and Codex output handling is unchanged.

## Acceptance criteria
- [x] For the `cursor` and `cursor-other` providers, both the normal dispatch argv and the Usage Orchestrator argv request `--output-format stream-json`. Model and thinking-level splicing still places `--model <name>` correctly, and `test/unit/agentCliHandoff.test.ts` / `test/unit/agentCliCursorOther.test.ts` assert the new argv.
- [x] A pure, vscode-free renderer turns Cursor stream-json lines into readable output lines. Unit tests cover: assistant text (including partial chunks merged into readable lines rather than one line per token), a tool-call start or completion summarized as one line, the final `result` event (success and error), unknown event types skipped without throwing, and a non-JSON line passed through unchanged.
- [x] The renderer handles a JSON event split across multiple stdout chunks and several events arriving in one chunk. A unit test feeds such chunked input and asserts the exact rendered lines.
- [x] During a live Cursor Define or Run handoff, the "MWNN Agent CLI" channel shows rendered lines while the process runs, not only after exit. The board CLI status pill and progress text show the latest rendered line, never raw JSON.
- [x] No raw `{"type":...}` JSON line appears in the output channel for Cursor runs, including Usage Orchestrator attempts. Copilot, Codex, and Claude Code channel output is byte-for-byte unchanged, verified by an existing or new feed test.
- [x] Credit and usage-limit exhaustion, model rejection, and the exit-failure summary still trigger for a Cursor run whose error arrives inside a stream-json event or on stderr. Unit tests with stream-json fixtures cover each of the three.
- [x] Actual-model discovery still reports the model from Cursor's `system.init` event, and `test/unit/agentCliModelDiscovery.test.ts` passes unchanged or is updated only for the new argv.
- [ ] Manual smoke test from the free repo with Pro linked: start a Cursor Agent CLI Define on a card, open the "MWNN Agent CLI" channel, and see output lines appear progressively before the `■ Exited with code 0.` footer.
- [x] In `e:\mwnn-kanban`, `npm run compile-tests`, `npm run compile`, `npm test`, and `npm run lint` pass.

## Activity
### 2026-10-24T16:11:59.853Z - Cursor Agent CLI Other definition handoff started
Started Cursor Agent CLI Other in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the definition stage: claude-opus-5-5-xhigh.

### 2026-10-24T16:13:34.927Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-5.5`, thinking level `high`
- codex: model `gpt-6.1-sol`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`
- cursor-other: model `claude-opus-5-5-medium`

### 2026-10-24T16:22:32.492Z - Auto-started in In Progress
Assigned to AI in Ready; moved to In Progress automatically.

### 2026-10-24 - Moved from mwnn-kanban-pro board
Moved from `e:\mwnn-kanban-pro\.mwnn/cards/card-mvmlgthx-1.md` (In Progress) to this board's Implement column (`col-mqwk2njn-3`).

### 2026-10-24T16:25:32.882Z - Handed off to GitHub Copilot
Dispatched this card to GitHub Copilot. The agent should append its completion note below.

### 2026-10-24 - Cursor stream-json live output implemented
Preferred model `claude-sonnet-5.5` was not available in this session; used Cursor Auto (Composer) instead.

Switched `cursor` / `cursor-other` dispatch and Usage Orchestrator argv to `--output-format stream-json --stream-partial-output`. Added pure `src/cursorStreamJson.ts` renderer (assistant deltas merged into lines, tool-call one-liners, result duration) and wired it through `createCliOutputFeed` / `createCliRunObserver` for Cursor providers only. Credit, model-rejection, exit-summary, and usage scanners expand stream-json before matching. Unit tests added/updated; `compile-tests`, `compile`, `test` (947 pass), and `lint` all green.

Live progressive channel updates are covered by the streaming renderer + feed wiring; still needs a Development Host smoke with Pro linked to confirm end-to-end.

Smoke steps: Extension Development Host → open a card → Define with Cursor Agent CLI → open Output → "MWNN Agent CLI" → confirm rendered lines appear before `■ Exited with code 0.` Offer: package/install the working-tree VSIX if helpful.

STATUS: BLOCKED: Manual Development Host smoke test with Pro linked still required (progressive Cursor channel output before exit footer).
