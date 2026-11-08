---
id: card-mvxv7lj9-1
title: When I hover on blocked and it highlights a card in the Implement column only the corners show red highlighted it's hard hard to notice
column: col-mqwk2njn-4
position: -106000
assignee: { kind: ai }
preferredModel.copilot: claude-haiku-4.5
preferredModel.codex: gpt-6-luna
preferredModel.claude-code: haiku
preferredModel.cursor-other: claude-opus-5-5-medium
thinkingLevel.copilot: medium
thinkingLevel.codex: medium
thinkingLevel.claude-code: medium
createdAt: 1793539668933
updatedAt: 1794153458279
---

## Description
Hovering or focusing a card's Blocked chip highlights its unfinished dependency cards via `.card-blocker-highlight` (red outline + soft glow). In the Implement column (and any column whose card list uses `overflow-y: auto`), that outline/glow is clipped so only faint corner fragments remain visible, which makes the highlight easy to miss. Make the blocker highlight clearly readable on the full card face in those columns without breaking hover/focus behavior or non-highlighted card layout.

## Acceptance criteria
- [x] Hovering or focusing a Blocked chip still highlights every unfinished dependency card that is currently rendered on the board.
- [x] A highlighted dependency card in the Implement column shows a clearly visible red emphasis around (or on) the full card perimeter, not just faint corner fragments.
- [x] The same full-card visibility holds when the highlighted card sits in any column whose card list scrolls (`overflow-y: auto`), including when the card is mid-list between neighbors.
- [x] Leaving the Blocked chip (mouse out / blur) removes the highlight from all previously highlighted cards.
- [x] Non-highlighted cards keep their existing spacing, borders, and layout; the fix must not permanently enlarge cards or change column scroll behavior when nothing is highlighted.
- [x] Development Host smoke: create a blocked card that depends on a card in Implement, hover/focus the Blocked chip, and confirm the Implement dependency is easy to spot at a glance.

## Activity
### 2026-11-08T15:31:11.242Z - Usage Orchestrator chose Cursor Agent CLI
Stage: definition. Cursor Agent CLI reports 71% remaining, resetting 2026-11-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-08T15:31:12.051Z - Usage Orchestrator dispatch dispatch-mw7zp8hf-1 started
Card: card-mvxv7lj9-1 ("When I hover on blocked and it highlights a card in the Implement column only the corners show red highlighted it's hard hard to notice"). CLI: Cursor Agent CLI. Stage: definition.
Requested model: "auto" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the definition stage: auto.
AI loop stage thinking level rule for the definition stage "max" was not applied: Cursor Agent CLI does not accept a thinking level, so the AI loop stage thinking level rule for the definition stage "max" was not applied and the run used that CLI's default thinking level.

### 2026-11-08T15:31:15.182Z - Usage Orchestrator dispatch dispatch-mw7zp8hf-1 model observed
Card: card-mvxv7lj9-1. CLI: Cursor Agent CLI. Stage: definition.
Actual model: "Auto" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mw7zp8hf-1).

### 2026-11-08T15:32:05.341Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-haiku-4.5`, thinking level `medium`
- codex: model `gpt-6-luna`, thinking level `medium`
- claude-code: model `haiku`, thinking level `medium`
- cursor-other: model `claude-opus-5-5-medium`

### 2026-11-08T15:35:16.117Z - Auto-started in Implement
Assigned to AI in Ready; moved to Implement automatically.

### 2026-11-08T15:35:27.001Z - Usage Orchestrator chose Cursor Agent CLI
Stage: implementation. Cursor Agent CLI reports 71% remaining, resetting 2026-11-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-08T15:35:27.704Z - Usage Orchestrator dispatch dispatch-mw7zupqw-2 started
Card: card-mvxv7lj9-1 ("When I hover on blocked and it highlights a card in the Implement column only the corners show red highlighted it's hard hard to notice"). CLI: Cursor Agent CLI. Stage: implementation.
Requested model: "auto" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: auto.

### 2026-11-08T15:35:31.144Z - Usage Orchestrator dispatch dispatch-mw7zupqw-2 model observed
Card: card-mvxv7lj9-1. CLI: Cursor Agent CLI. Stage: implementation.
Actual model: "Auto" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mw7zupqw-2).

### 2026-11-08T15:37:00.645Z - Blocker highlight clipping fix
Changed `.card.card-blocker-highlight` in `media/board.css` from outer outline + glow (clipped by `.cards { overflow-y: auto }`) to an inset red ring, soft inset glow, border-color, and light error wash that paints on the full card face. Hover/focus/blur JS on the Blocked chip was left unchanged. Code-side acceptance criteria verified by inspection; Development Host smoke still needed.
Initially reported as blocked: Development Host smoke was pending; resolved by the Codex verification below.

### 2026-11-08T15:38:14.295Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-11-08 - Codex Development Host verification
The existing inset highlight fix in media/board.css was preserved; no duplicate implementation was needed. gpt-6-luna could not be selected because this session exposes no model-switch control; used GPT-6 (Codex; exact variant not exposed). Verified unchanged mouseenter/focus and mouseleave/blur handlers in media/board.js.

Launched a working-tree Extension Development Host against an isolated temporary board containing a Ready card blocked by an unfinished Implement dependency between neighbors in a 17-card scrolling list. Activating the Blocked chip showed a strong red ring on all four sides and a red card-face wash; Tab removed it, and Shift+Tab restored it. Card spacing and column scrolling remained unchanged. The Development Host smoke criterion is now checked.

Validation: npm run compile-tests, npm run compile, and npm run lint passed. Full unit-suite result recorded below.
The sandboxed npm test run failed when disposable Git repositories could not write .git/config. An elevated retry reached CLI process tests but reported failures in process cancellation, model discovery, Codex usage probes, and Claude usage probes; stopped that prolonged run after these unrelated failures. The full suite is not green. Saved its output with the isolated smoke workspace as unit-validation.log. No TypeScript or CLI logic was changed for this card.

All six acceptance criteria are checked; the original Implement column is unchanged.
STATUS: DONE
