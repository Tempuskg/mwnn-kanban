---
id: card-mt0hv0ff-1
title: Don't open multiple MWNN Kanban boards
column: col-mqxta6ho-4
position: 1000
assignee: { kind: ai }
createdAt: 1787168298219
updatedAt: 1787168941289
---

## Description
Ensure every MWNN Kanban entry point reuses the single live board panel for the current VS Code window. If the board is already open, reveal and focus that panel instead of creating another; after it is closed, allow the next open request to create one fresh panel. Preserve this single-panel behavior when VS Code restores webviews after a reload or restart.

## Acceptance criteria
- [x] Repeatedly running the Open Board command while an MWNN Kanban panel exists leaves exactly one board panel open and reveals the existing panel.
- [x] Other board-opening entry points, including the sidebar button and actions that need to show the board, reuse the same live panel instead of creating a duplicate.
- [x] When the existing board is hidden or in another editor group, opening the board focuses that same panel without moving it or opening a second panel.
- [x] After the board panel is closed, the next open request creates exactly one new, functional board panel.
- [x] Reloading or restarting a window with a restorable board does not leave more than one live MWNN Kanban panel.
- [x] Automated tests cover initial creation, repeated-open reuse, close-and-reopen behavior, and duplicate prevention during restoration.

## Activity
### 2026-08-19T19:38:42.441Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-08-19T19:41:02.587Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-08-19T19:45:30.771Z - Implemented by Codex (ChatGPT)
Added an identity-aware single-panel lifecycle used by board creation and restoration, so every entry point reveals the live panel, duplicate restored panels are disposed, stale closes cannot clear a replacement, and a fresh panel can open after closure. Added lifecycle regression tests and an Unreleased changelog note. `npm run compile-tests`, `npm run compile`, the focused panel tests, all 320 unit tests, and `npm run lint` passed. A Development Host UI smoke test was unavailable because the Windows Computer Use native pipe could not start; the lifecycle and placement paths are covered by automated tests.
STATUS: DONE
