---
id: card-muyrib7f-1
title: Add an AI-guided interview checkbox for Human cards
column: col-mqwk2njn-4
position: -63000
assignee: { kind: human }
createdAt: 1791417134139
updatedAt: 1791583883505
---

## Description
Keep Human/AI as the responsibility selector. Add an optional checkbox labelled "AI-guided interview" beneath the assignee controls when Human is selected, with helper text "AI asks one question at a time and records your answers." A human supplies the facts and decisions while AI guides and records the conversation.

Persist the choice as an optional boolean card field (for example, interview: true), defaulting to off for existing and new cards. Clearing the checkbox removes the optional field. Switching to AI or Unassigned clears the choice; the host also treats an externally edited interview flag on a non-Human card as inactive. Preserve the human name and all other card fields.

Update the shared Card type, runtime guards, Markdown serialization, board store and webview message contract together. The current assignee controls and card details are in media/board.js; the host model and persistence are in src/types.ts, src/serialization.ts and src/boardStore.ts. Host and webview run in separate contexts. The companion card implements the interview run action using this saved choice.

## Acceptance criteria
- [x] Human card details show a labelled, keyboard-accessible checkbox and helper text; AI and Unassigned show their existing assignee choices without an interview checkbox.
- [x] The saved choice survives save, close/reopen, reload and Markdown round trips; legacy cards without the field remain off and existing facts, Activity, assignee name, dependencies and provider settings are preserved.
- [x] Unchecking or changing the assignee away from Human clears the persisted choice; host validation prevents an interview flag from making an AI or Unassigned card interview-eligible.
- [x] Shared host/webview message validation and store updates reject invalid field values and save edits consistently with the current card editor.
- [x] Focused persistence/store/protocol tests cover on/off, legacy and invalid values; a Development Host check verifies checkbox visibility, keyboard use and reload behavior.

## Activity
### 2026-10-09T17:22:00.305Z - AI loop advanced this card
Moved to "Ready".

### 2026-10-09T21:31:47.542Z - AI loop advanced this card
Moved to "Implement".

### 2026-10-09T21:31:50.897Z - Usage Orchestrator chose Anthropic Claude Code CLI
Stage: implementation. Anthropic Claude Code CLI reports 73% remaining, resetting 2026-10-12T09:00:00.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-09T21:31:51.480Z - Usage Orchestrator dispatch dispatch-mv1hdhko-1 started
Card: card-muyrib7f-1 ("Add an AI-guided interview checkbox for Human cards"). CLI: Anthropic Claude Code CLI. Stage: implementation.
Requested model: "opus" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: opus.
AI loop stage thinking level rule for the implementation stage: medium.

### 2026-10-09T21:31:53.447Z - Usage Orchestrator dispatch dispatch-mv1hdhko-1 runtime model unconfirmed
Card: card-muyrib7f-1. CLI: Anthropic Claude Code CLI. Stage: implementation.
Runtime model not confirmed: Claude Code stream-json output contained no nonempty system.init.model or assistant message model field. The model request or CLI-default selection is recorded in the matching dispatch start entry. This entry reports model confirmation only; dispatch outcome is recorded separately. Attempt: dispatch-mv1hdhko-1.

### 2026-10-09T21:31:53.669Z - Anthropic Claude Code CLI implementation handoff failed
Anthropic Claude Code CLI ended with exit code 1: Ignoring 3 permissions.allow entries from .claude/settings.json: this workspace has not been trusted. Run Claude Code interactively here once and accept the trust dialog, or set projects["e:/mwnn-kanban"].hasTrustDialogAccepted: true in C:\Users\darre\.claude.json. Error: When using --print, --output-format=stream-json requires --verbose. The card was not advanced; verify CLI authentication/configuration and rerun the loop. The run used the AI loop stage model rule for the implementation stage "opus".

### 2026-10-09T21:37:13.042Z - Usage Orchestrator chose Anthropic Claude Code CLI
Stage: implementation. Anthropic Claude Code CLI reports 73% remaining, resetting 2026-10-12T09:00:00.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-09T21:37:13.848Z - Usage Orchestrator dispatch dispatch-mv1hkebc-1 started
Card: card-muyrib7f-1 ("Add an AI-guided interview checkbox for Human cards"). CLI: Anthropic Claude Code CLI. Stage: implementation.
Requested model: "opus" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: opus.
AI loop stage thinking level rule for the implementation stage: medium.

### 2026-10-09T21:37:15.872Z - Usage Orchestrator dispatch dispatch-mv1hkebc-1 model observed
Card: card-muyrib7f-1. CLI: Anthropic Claude Code CLI. Stage: implementation.
Actual model: "claude-opus-5-5" (source: Claude Code stream-json system.init.model; attempt: dispatch-mv1hkebc-1).

### 2026-10-09 - Claude Code: implemented interview flag
Added optional `interview?: true` to the Card type with `isInterviewCard()` (only true on Human-assigned cards), a validated `setInterview { cardId, interview: boolean }` webview message, `setInterview` mutation + store method + panel handler, and Markdown serialization (`interview: true` written only for Human cards; any other value, or the flag on an AI/unassigned card, parses as off). `setAssignee` away from Human clears the flag; duplicate and store reload/migration clones keep it. Webview card details (media/board.js, media/board.css) show a labelled "AI-guided interview" checkbox with helper text "AI asks one question at a time and records your answers." beneath the assignee row, only when Human is selected; switching to AI/Unassigned unchecks it, and the save/unsaved-changes paths include it. Board README contract documents the key. Tests: test/unit/cardInterview.test.ts (on/off, legacy, invalid values, non-Human inactive, protocol, store persist/reload/reopen/clear). Validation: `npm run compile-tests`, `npm run compile`, `npm test` (756/756 pass), `npm run lint` all green.
Remaining: Development Host smoke test (open a Human card, check visibility and keyboard toggling with Tab/Space, save, reload the window, confirm the checkbox persists; switch to AI and confirm it hides and the file loses `interview: true`).
Initially reported as blocked: Development Host smoke test of checkbox visibility, keyboard use and reload needed a human; resolved below.

### 2026-10-09 - Claude Code: AI-guided interview (Development Host smoke test)
Asked one question at a time; human answers recorded:
1. Test build: a Development Host with the current working tree was already running.
2. Visibility: the Human card details show the "AI-guided interview" checkbox and the helper text "AI asks one question at a time and records your answers." beneath the assignee row.
3. Keyboard: Tab reaches the checkbox with a visible focus ring; Space toggles it on and off.
4. Persistence: checked + saved, then Reload Window and reopen. The box stays checked and the card file has `interview: true`.
5. Clearing: switching to AI, then Unassigned, and saving hides the checkbox and removes `interview: true`; the name and other fields stay intact.
Smoke test passed; all acceptance criteria are met.
STATUS: DONE
