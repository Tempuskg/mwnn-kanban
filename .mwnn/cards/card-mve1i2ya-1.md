---
id: card-mve1i2ya-1
title: Have the buttons at the bottom of the opened mwnn Kanban card always visible
column: col-mqwk2njn-3
position: 2000
assignee: { kind: ai }
preferredModel.copilot: claude-haiku-4.5
preferredModel.codex: gpt-6-luna
preferredModel.claude-code: sonnet
preferredModel.cursor: Gemini 3.8 Flash
thinkingLevel.copilot: medium
thinkingLevel.codex: medium
thinkingLevel.claude-code: medium
createdAt: 1792340912242
updatedAt: 1792873604407
---

## Description
When a card is opened, the card details dialog (`renderCardDetails` in `media/board.js`) shows a footer row of actions: Start interview / Run with AI / Fill in with AI (conditional), Delete, Duplicate, and Save. Today the whole `.card-modal` element is the scroll container (`max-height: calc(100vh - 32px); overflow: auto` in `media/board.css`), so on a card with long Description, Acceptance criteria, or Activity text the footer scrolls below the fold. The user has to scroll to the bottom to reach Save or the AI actions.

Keep the footer pinned to the bottom of the dialog so it is always visible without scrolling, whatever the content length or webview height. Only the dialog body (the `.card-modal-form` fields) scrolls. One way to do this: make `.card-modal` a non-scrolling flex column, give `.card-modal-form` `flex: 1 1 auto; min-height: 0; overflow: auto`, and make the header and footer `flex-shrink: 0`. A `position: sticky; bottom: 0` footer with an opaque background would also work. This is a webview-only CSS change (and DOM too, if needed). It needs no extension-host or message-protocol change. The column details dialog (`renderColumnDetails`) uses the same `.card-modal` / `.card-modal-form` / `.card-modal-footer` classes, so it will pick up the same behavior and must keep working.

## Acceptance criteria
- [x] With a card open whose content is taller than the webview (e.g. a long Activity log), the footer buttons (Delete, Duplicate, Save, and any visible AI button: Run with AI / Start interview / Fill in with AI) stay visible at the bottom of the dialog without scrolling.
- [x] The card fields between the header and the footer scroll inside the dialog, and every field (Title through Activity) can still be scrolled into view and edited.
- [x] The dialog header (title, "Currently in …" subtitle, Copy card path, Close) stays visible while the fields scroll.
- [x] Scrolled content never shows through or overlaps the footer or header: both have an opaque background in light, dark, and high-contrast themes.
- [x] A short card whose content fits needs no scrollbar, and its layout looks the same as it does today.
- [x] Footer buttons stay visible and usable in a narrow (≤720px) or short webview, and they still wrap or fit without horizontal overflow.
- [x] The column details dialog (same modal classes) still renders correctly, and its Delete column / Save footer is likewise always visible.
- [x] The unsaved-changes prompt (Save / Discard / Cancel) still appears above the dialog and works when you close a card with edits.
- [x] Keyboard focus order and `:focus-visible` outlines on the footer buttons are unchanged, and tabbing into a field keeps it scrolled into view.
- [ ] `npm run compile`, `npm test`, and `npm run lint` pass, and a Development Host smoke test confirms the behavior on a long card and a short card.

## Activity
### 2026-10-22T10:27:43.485Z - Anthropic Claude Code CLI definition handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the definition stage: opus.
AI loop stage thinking level rule for the definition stage: xhigh.

### 2026-10-22T10:28:33.107Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-haiku-4.5`, thinking level `medium`
- codex: model `gpt-6-luna`, thinking level `medium`
- claude-code: model `sonnet`, thinking level `medium`
- cursor: model `Gemini 3.8 Flash`

### 2026-10-22T10:28:34.069Z - AI loop placed this card in Ready
The definition was just filled in; moved to "Ready" to continue through the board flow.

### 2026-10-22T10:28:34.993Z - Anthropic Claude Code CLI triage handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: sonnet.
Card thinking level: medium.

### 2026-10-22T10:30:00.000Z - Triage decision
AI: this is a webview-only CSS/DOM layout change in `media/board.css` (and possibly `media/board.js`) with a clearly specified approach and no open product or design decisions. Final Development Host smoke verification happens in the Verify column.

### 2026-10-22T10:28:57.790Z - AI loop advanced this card
Moved to "Implement".

### 2026-10-22T10:28:58.680Z - Anthropic Claude Code CLI implementation handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: sonnet.
Card thinking level: medium.

### 2026-10-22 Claude Code - implementation
Changed `media/board.css` only: `.card-modal` now `overflow: hidden` (non-scrolling flex column); `.card-modal-form` gets `flex: 1 1 auto; min-height: 0; overflow-y: auto` so only the fields scroll; `.card-modal-header` and `.card-modal-footer` are `flex-shrink: 0`; footer also `flex-wrap: wrap` for narrow webviews. Header/footer sit outside the scroll region on the modal's opaque background, and the unsaved-changes prompt is a separate backdrop, so those two criteria are checked from structure. The column dialog shares the classes. `npm run compile`, `npm test` (856 pass) and `npm run lint` pass.
Remaining: Development Host smoke test (long card, short card, narrow/short webview, column dialog, themes, keyboard focus). Steps: open a card with a long Activity log and confirm header and footer stay put while fields scroll; open a short card and confirm no scrollbar; resize below 720px wide; open a column's details; close a card with edits to see the prompt.
Initially reported as blocked: Development Host smoke test needs a human; still pending, see latest entry.

### 2026-10-22T18:35:59.781Z - Anthropic Claude Code CLI implementation handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: sonnet.
Card thinking level: medium.

### 2026-10-22 Claude Code - re-verification
Confirmed the `media/board.css` change is in place (non-scrolling `.card-modal`, scrolling `.card-modal-form`, `flex-shrink: 0` header/footer, wrapping footer). `npm run compile` passes and `npm test` passes (896 pass, 0 fail). `npm run lint` reports one error, `src/runWithAi.ts:363` (`no-non-null-assertion`), in uncommitted work outside this card; this card's change touches only CSS. The layout criteria and the Development Host smoke test remain unverified, so they are left unchecked.
STATUS: BLOCKED: Development Host smoke test needs a human (long/short card, narrow webview, column dialog, themes, focus); lint error in src/runWithAi.ts:363 is outside this card

### 2026-10-24T20:26:42.129Z - Usage Orchestrator chose Cursor Agent CLI
Stage: implementation. Cursor Agent CLI reports 87.1% remaining, resetting 2026-11-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost. Pace variance -44.4 pts (57.3% elapsed).

### 2026-10-24T20:26:42.375Z - Usage Orchestrator dispatch dispatch-mvmunhaf-e started
Card: card-mve1i2ya-1 ("Have the buttons at the bottom of the opened mwnn Kanban card always visible"). CLI: Cursor Agent CLI. Stage: implementation.
Requested model: none (source: CLI default; no model argument was supplied).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.

### 2026-10-24T20:26:44.356Z - Usage Orchestrator dispatch dispatch-mvmunhaf-e model observed
Card: card-mve1i2ya-1. CLI: Cursor Agent CLI. Stage: implementation.
Actual model: "Auto" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mvmunhaf-e).

### 2026-10-24 Cursor Agent CLI - implementation
Confirmed and tightened the pinned-footer layout in `media/board.css`: `.card-modal` is a non-scrolling flex column (`overflow: hidden`); `.card-modal-form` is the only scroll region (`flex: 1 1 auto; min-height: 0; overflow-y: auto`); header and footer are `flex-shrink: 0` with opaque `var(--vscode-editorWidget-background)`; footer uses `flex-wrap: wrap` for ≤720px. DOM order in `renderCardDetails` / `renderColumnDetails` is already header → form → footer (no JS change). `npm run compile`, `npm test` (983 pass), and `npm run lint` all pass. Layout criteria checked from CSS/DOM evidence; the compound smoke criterion stays open.
Smoke steps: F5 Development Host → open a long-Activity card and confirm header/footer stay put while fields scroll → open a short card (no scrollbar, same look) → narrow the webview ≤720px → open column details (Delete/Save pinned) → close a dirty card to confirm Save/Discard/Cancel. Offer: I can package and install a working-tree VSIX for that smoke if you want.
STATUS: BLOCKED: Development Host smoke test needs a human (long/short card, narrow webview, column dialog)
