---
id: card-mqwl467r-1
title: Add Extension to vscode sidebar
column: col-mqwk2njn-4
position: 27000
assignee: { kind: ai }
createdAt: 1782578335095
updatedAt: 1782603269518
---

## Description
Have the extension appear on the sidebar with the other extensions

## Acceptance criteria
extension appears on the sidebar
when sidebar icon clicked the MWNN Kanban board is opened

## Activity
### 2026-06-27T21:31:59.422Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-27T23:08:00.179Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-27 - Completed by Claude Code
Added the extension to the VS Code activity bar (sidebar):
- Added a monochrome activity-bar icon at `media/sidebar-icon.svg` (the existing colorful `media/icon.png` can't be used in the activity bar since VS Code masks those icons to a single theme color).
- Registered a `viewsContainers.activitybar` entry (`mwnn-kanban`) and a webview `view` (`mwnn-kanban.sidebar`) in `package.json`.
- Created `src/sidebarView.ts` (`BoardSidebarViewProvider`): when the sidebar view is revealed (icon clicked) it opens the MWNN Kanban board panel in the editor, and it also renders an "Open Board" button. It opens on first resolve and whenever the view becomes visible again.
- Wired the provider into `src/extension.ts` for both the normal workspace path (opens the board) and the no-workspace path (shows the "open a workspace folder" prompt).
- Verified: `npm run compile`, `npm run lint`, and `npm test` (57 passing) all succeed.
