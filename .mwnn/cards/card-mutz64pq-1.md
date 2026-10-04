---
id: card-mutz64pq-1
title: "Change the AI Loop UI so that it says AI Loop and then just have the icons play, pause, stop with no text"
column: col-mqwk2njn-4
position: -47000
assignee: { kind: ai }
preferredModel.copilot: gpt-5.4-mini
preferredModel.codex: gpt-5.5
preferredModel.claude-code: haiku
thinkingLevel.copilot: low
thinkingLevel.codex: low
thinkingLevel.claude-code: low
createdAt: 1791127671902
updatedAt: 1791151317671
---

## Description
Simplify the AI loop controls in the sidebar webview (`src/sidebarView.ts`, the `.loop-controls` group). Right now the three buttons read "▶ Play", "❚❚ Pause" and "■ Stop", and nothing visible says they belong to the AI loop. Add a visible "AI Loop" label before the controls, and change each button to show only its icon (play, pause, stop) with no text. Keep the existing tooltips, aria-labels, enable/disable behavior and the message protocol (`playAiLoop` / `pauseAiLoop` / `stopAiLoop`) as they are, so the controls stay accessible and keep working. This is a markup and CSS change on the webview side only. No host-side or protocol changes are expected.

## Acceptance criteria
- [x] The sidebar shows a visible "AI Loop" text label right before (or in the same row as) the Play/Pause/Stop buttons.
- [x] The Play, Pause and Stop buttons render only their icons (▶, ❚❚, ■ or equivalent VS Code-themed glyphs), with no visible "Play", "Pause" or "Stop" text.
- [x] Each button keeps a descriptive `title` tooltip and `aria-label`. The dynamic Play tooltip/aria-label updates in `applyAiLoopState` (disabled hint, resume, start) still work.
- [x] The button ids (`loop-play`, `loop-pause`, `loop-stop`), the posted message types and the enable/disable behavior from the AI loop state are unchanged.
- [x] The label and icon buttons fit on one row at a normal sidebar width without wrapping or clipping, and the icons are legible in both light and dark themes.
- [x] `npm run compile`, `npm test` and `npm run lint` pass. Any test that checks the sidebar HTML or button text is updated to match.
- [x] A smoke test in the Development Host confirms the label and icon-only buttons render, and that Play/Pause/Stop still start, pause and stop the loop.

## Activity
### 2026-10-04T21:21:37.001Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-04T21:22:15.260Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `gpt-5.4-mini`, thinking level `low`
- codex: model `gpt-5.5`, thinking level `low`
- claude-code: model `haiku`, thinking level `low`

### 2026-10-04T21:43:35.486Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-04 - Claude Code: implemented
Model: ran on `claude-opus-5-5`; could not switch to the preferred `haiku` model from inside the dispatched session.
In `src/sidebarView.ts`, added a visible "AI Loop" label as the first item in the `.loop-controls` row. It is `aria-hidden` because the group already has `aria-label="AI loop controls"`. The Play/Pause/Stop buttons now show only their ▶ / ❚❚ / ■ glyphs. Ids, titles, aria-labels, `applyAiLoopState`, enable/disable and the message types are unchanged. CSS: the row is vertically centered, the label is fixed-width with no wrapping, and the buttons get `min-width: 0` and `line-height: 1` so they shrink instead of clipping. The glyphs use the theme's secondary-button foreground color.
Validation: `npm run compile` passed, `npm test` passed (577/577), `npm run lint` was clean. No test checks the button text, so no test changes were needed.
Not yet verified: the one-row fit and light/dark legibility, and the Development Host smoke test. A person has to run these interactively.
STATUS: BLOCKED: needs a human Development Host smoke test (layout at sidebar width in light/dark themes, Play/Pause/Stop driving the loop)

### 2026-10-04 - Claude Code: smoke test confirmed
Packaged and installed the VSIX into the user's VS Code. The user confirmed that the label and icon buttons fit on one row and are legible, and that Play/Pause/Stop start, pause and stop the loop.
STATUS: DONE
