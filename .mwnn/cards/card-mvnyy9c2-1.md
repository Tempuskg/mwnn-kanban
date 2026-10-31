---
id: card-mvnyy9c2-1
title: Add scheduledFor card field and setScheduledFor protocol
column: col-mqwk2njn-4
position: -95000
assignee: { kind: ai }
createdAt: 1792941289922
updatedAt: 1793324673586
---

## Description
Add optional `scheduledFor` (`YYYY-MM-DDTHH:mm` local wall time) on `Card`, parse/serialize it in card markdown (accept date-only as local `T00:00`; always write the full form; quote when needed), wire clone/equality, and add `setScheduledFor` through the webview message protocol, board panel, and board store (omit the key to clear).

## Acceptance criteria
- [x] `Card` supports optional `scheduledFor` string normalized to `YYYY-MM-DDTHH:mm`
- [x] Round-trip serialize/parse works; invalid values are ignored; date-only expands to `T00:00`
- [x] `setScheduledFor` updates or clears the field via store and panel message handling

## Activity
- 2026-10-25 import:card-schedule-feature:model-persist from card_schedule_feature plan

### 2026-10-30T01:38:24.001Z - Cursor Agent CLI implementation handoff started
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: auto.

### 2026-10-30 - Cursor Agent CLI
Added optional `scheduledFor` on `Card` (`YYYY-MM-DDTHH:mm`), with normalize/serialize/parse (date-only → `T00:00`, invalid ignored), clone/equality/duplicate wiring, and `setScheduledFor` through the webview protocol, board panel, and board store.
STATUS: DONE

### 2026-10-30T01:43:05.063Z - MWNN independent verification started

### 2026-10-30T01:43:05.311Z - Cursor Agent CLI implementation handoff failed
Missing or invalid verification inputs. Configure .mwnn/verification.json, with a check mapping for every acceptance criterion, before dispatch.
