---
id: card-mvnyy9c2-2
title: Block cards until scheduledFor local datetime
column: col-mqwk2njn-4
position: -102000
assignee: { kind: ai }
createdAt: 1792941289922
updatedAt: 1793470520889
dependsOn: [card-mvnyy9c2-1]
---

## Description
Extend `isCardBlocked` so a card is blocked when unfinished dependencies apply or `now` is strictly before its local `scheduledFor`. Add helpers (`parseScheduledFor`, `isScheduledBlocked`, block reasons), inject `now` for tests, and fold schedule into move gating, Ready reverse-WIP, `relocateBlockedCards`, and blocked-move/Activity copy. AI Loop should pick this up via existing `isCardBlocked` calls.

## Acceptance criteria
- [x] Future `scheduledFor` blocks past Ready; at/after that moment does not
- [x] Dependencies and schedule combine; Ready reverse-WIP ignores schedule-blocked defined cards
- [x] Relocations and user-facing blocked messages mention the schedule datetime when it applies

## Activity
- 2026-10-25 import:card-schedule-feature:block-logic from card_schedule_feature plan

### 2026-10-31T17:51:16.001Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-31 - Claude Code
Added `parseScheduledFor`, `blockingSchedule`, `isScheduledBlocked`, and `cardBlockReasons` in src/utils.ts; `isCardBlocked`, `canMoveCardToColumn`, `readyState`, and `describeBlockedMove` take an injectable `now` (default `new Date()`), and `relocateBlockedCards` uses its timestamp as `now`. A card is blocked while `now` is strictly before its local `scheduledFor`, combined with dependencies. Relocations carry optional `scheduledFor`, and relocation notices, Activity entries, and blocked-move messages say "scheduled for YYYY-MM-DD HH:mm" when it applies (dependency-only wording unchanged). AI Loop picks it up through existing `isCardBlocked` calls. Added 4 tests in test/unit/cardScheduledFor.test.ts. compile-tests, compile, npm test (1069 pass), and eslint src are green.
STATUS: DONE
