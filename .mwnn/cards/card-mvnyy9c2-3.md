---
id: card-mvnyy9c2-3
title: Add scheduledFor datetime UI on the board
column: col-mqwk2njn-4
position: -103000
assignee: { kind: ai }
createdAt: 1792941289922
updatedAt: 1793470840237
dependsOn: [card-mvnyy9c2-1, card-mvnyy9c2-2]
---

## Description
In the card detail editor, add a **Scheduled for** `<input type="datetime-local">` (minute step) plus Clear that posts `setScheduledFor`. Reuse the Blocked chip with tooltips that distinguish schedule vs dependencies (and both). Mirror schedule checks in webview drag/drop blocking. While any open card has a future `scheduledFor`, re-render about every 30s and on window focus so unlocks land near the scheduled minute.

## Acceptance criteria
- [x] Detail view can set and clear a local datetime mapped to `YYYY-MM-DDTHH:mm`
- [x] Blocked chip/tooltips and drop rules respect future schedules the same as the host
- [x] Board refreshes on ~30s interval (and focus) when future schedules exist

## Activity
- 2026-10-25 import:card-schedule-feature:webview-ui from card_schedule_feature plan

### 2026-10-31T18:15:41.664Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-31 - Claude Code
Webview only (media/board.js, media/board.css). Card detail has a **Scheduled for** `datetime-local` input (step 60) plus Clear; the value is normalized to `YYYY-MM-DDTHH:mm` and Save posts `setScheduledFor` (omitting the key to clear), before any column move so a cleared schedule can unblock the move in the same save; unsaved-changes detection includes it. Added webview mirrors `normalizeScheduledFor`/`blockingSchedule` and folded the schedule into `isCardBlocked`, so the Blocked chip, Ready reverse-WIP count, and drag/drop gating match the host. Chip tooltip distinguishes schedule-only, dependencies-only, and both. While any non-Done card has a future schedule, a 30s interval and window focus re-render when a schedule unlocks (skipped while a modal, picker, or drag is open; closing renders anyway); the interval stops when no future schedules remain. Validation: node --check, compile-tests, compile, npm test (1069 pass), npm run lint green; helper semantics sanity-checked in Node. Not yet smoke-tested in a Development Host: open a card, set a time 1-2 min ahead, Save, confirm Blocked chip tooltip and that dragging past Ready is refused, then wait for the chip to clear; reopen and Clear, Save.
STATUS: DONE
