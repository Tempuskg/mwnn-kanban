---
id: card-mukhe5ni-2
title: When you hover over the blocked indicator have it highlight the cards that are blocking it
column: col-mqwk2njn-4
position: -51000
assignee: { kind: ai }
preferredModel.copilot: claude-haiku-4.5
preferredModel.codex: gpt-5.5
preferredModel.claude-code: haiku
thinkingLevel.copilot: medium
thinkingLevel.codex: medium
thinkingLevel.claude-code: medium
createdAt: 1790553617694
updatedAt: 1791157471923
---

## Description
When a card shows the "Blocked" chip because of unfinished dependencies (rendered in `media/board.js` via `isCardBlocked` / `countBlockingDependencies`), hovering over (or keyboard-focusing) that chip should visually highlight every card on the board that is currently blocking it — i.e. the ids returned by `blockingDependencies(card)`. Leaving the chip removes the highlight. This is a webview-only change (`media/board.js` + `media/board.css`); no extension-host or message-protocol changes are needed. Cards located via the existing `.card[data-card-id="…"]` attribute.

## Acceptance criteria
- [x] Hovering the Blocked chip on a dependency-blocked card adds a distinct highlight class (e.g. `card-blocker-highlight`) to each card whose id is in that card's unfinished blocking dependencies, and to no other cards.
- [x] Moving the pointer off the chip (mouseleave) removes the highlight from all cards; no highlight lingers after a board re-render.
- [x] Focusing the chip via keyboard applies the same highlight, and blur removes it.
- [x] Dependencies already in a Done column, or ids that no longer exist on the board, are not highlighted.
- [x] A card blocked only by a latest `BLOCKED` activity status (no blocking dependencies) shows no highlight on hover and does not error.
- [x] The highlight style is visible in light, dark, and high-contrast VS Code themes, using theme CSS variables in `media/board.css`.
- [x] The chip tooltip still reads "Blocked by N unfinished dependency/dependencies".
- [x] `npm run compile`, `npm test`, and `npm run lint` pass, and a Development Host smoke test confirms the highlight appears/disappears on hover across columns.

## Activity
### 2026-10-04T23:27:34.730Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-04T23:28:12.904Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-haiku-4.5`, thinking level `medium`
- codex: model `gpt-5.5`, thinking level `medium`
- claude-code: model `haiku`, thinking level `medium`

### 2026-10-04T23:29:11.323Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-04 - Claude Code: implemented blocker highlight
Model note: preferred model `haiku` was not selectable from inside this session; the work was done with `claude-opus-5-5` instead.

- `media/board.js`: the dependency-blocked "Blocked" chip is now focusable (`tabIndex=0`) and on `mouseenter`/`focus` calls the new `highlightBlockingCards(card)`, which adds `card-blocker-highlight` to `.card[data-card-id]` elements for the ids from `blockingDependencies(card)` only (so Done-column and missing ids are excluded). `mouseleave`/`blur` calls `clearBlockerHighlights()`. Status-only BLOCKED chips get no listeners. `render()` clears `root.innerHTML`, so no highlight survives a re-render. Tooltip text is unchanged.
- `media/board.css`: `.card.card-blocker-highlight` uses an outline plus a halo built from `--vscode-inputValidation-errorBorder` (falling back to `--vscode-focusBorder`), and the chip gets a `:focus-visible` outline. Both variables are defined in the light, dark, and high-contrast themes.
- Validation: `npm run compile` succeeded, `npm test` passed 594/594, and `npm run lint` was clean.
- Still open: no interactive Development Host smoke test was possible from this agent session, so the last criterion stays unchecked until a human hovers the chip across columns.

STATUS: BLOCKED: needs a human Development Host smoke test of the hover/focus highlight (code, compile, tests, and lint are done)

### 2026-10-04 - Claude Code: smoke test confirmed
Installed the VSIX built from the working tree into VS Code. The user tested it in VS Code and confirmed the blocker highlight works on hover. All acceptance criteria are now met.

STATUS: DONE
