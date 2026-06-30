---
id: card-mqxtjpcz-1
title: Have the board reopen with vscode open
column: col-mqwk2njn-4
position: 5000
assignee: { kind: human }
createdAt: 1782652962851
updatedAt: 1782742627806
---

## Description
Today the MWNN Kanban board only appears as a webview panel after the user
explicitly runs the `mwnn-kanban.openBoard` command (or opens it from the
sidebar). When VS Code is closed and reopened, or the window is reloaded, the
panel is gone even if it was open before — the user has to reopen it by hand
every session.

This slice makes the board panel survive a VS Code restart/reload: if the board
was open when the window closed, it reopens automatically when VS Code opens the
same workspace, restored to the same editor column. This is the standard VS Code
webview persistence pattern (`registerWebviewPanelSerializer`), wired into the
existing `BoardPanel` lifecycle so a restored panel behaves identically to a
freshly opened one (live store state, file watcher updates, all message
handlers). When the board was not open beforehand, nothing should auto-open.

## Acceptance criteria
- [ ] A `WebviewPanelSerializer` for the board view type (`mwnn-kanban.board`) is registered during `activate()` and added to `context.subscriptions`.
- [ ] When the board panel is open and VS Code is fully closed and reopened on the same workspace, the board panel reopens automatically without the user running any command.
- [ ] When the board panel is open and the window is reloaded (Developer: Reload Window), the board panel is restored automatically.
- [ ] The restored panel reuses the existing `BoardPanel` singleton path so `BoardPanel.current` is set and `postStateIfOpen()`/`postState()` push live state into it.
- [ ] A restored panel is fully functional: it shows current store state, reflects external file changes via the board watcher, and all webview message handlers (add/move/edit/delete card, columns, AI handoff) work exactly as in a freshly opened panel.
- [ ] If the board panel was NOT open before the restart/reload, nothing auto-opens and behavior is unchanged.
- [ ] Restoration is reasonable when no workspace folder is present (no crash; board does not attempt to open against a missing store).
- [ ] The panel is restored to the same editor view column it occupied before, where VS Code provides it.
- [ ] No duplicate panels are created: triggering restore while a board panel already exists reveals the existing panel rather than opening a second one.
- [ ] Existing unit tests pass and the feature is covered by a test (or documented manual verification steps) confirming the serializer reopens the panel.

## Activity
### 2026-06-29T02:51:50.623Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-29T13:27:45.997Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-06-29 - Implemented board panel persistence (Claude Code)
Wired the standard VS Code webview persistence pattern into the existing
`BoardPanel` lifecycle so the board survives a restart/reload.

Changes:
- `src/boardPanel.ts`: exposed `BoardPanel.viewType` (`mwnn-kanban.board`) and
  added `BoardPanel.restore(panel, deps)`. `restore` re-applies the webview
  options VS Code drops across a reload (`enableScripts`, `localResourceRoots`),
  then routes through the same singleton path as `show`: if `BoardPanel.current`
  already exists it reveals it and disposes the duplicate panel VS Code handed
  over (no second panel); otherwise it adopts the restored panel as the
  singleton. The restored panel's `ready` message triggers `postState`, and the
  existing board watcher continues to call `postStateIfOpen()`.
- `src/extension.ts`: registered `vscode.window.registerWebviewPanelSerializer`
  for `BoardPanel.viewType` in `activate()` (added to `context.subscriptions`),
  whose `deserializeWebviewPanel` calls `BoardPanel.restore` with shared deps.
  In the no-workspace path (`registerUnavailableCommands`) a second serializer
  claims the view type and simply disposes any restored panel, so a persisted
  board cannot crash or open against a missing store.
- `CHANGELOG.md`: documented the feature under Unreleased.

Verification:
- `npm run compile-tests` + `npm test`: all 79 unit tests pass.
- `npm run lint` and `npm run compile` (webpack) both succeed.
- The vscode-importing modules (`boardPanel.ts`, `extension.ts`) are not covered
  by the node:test unit suite (no vscode shim), so per the acceptance criteria
  this is covered by documented manual verification:
  1. Run the extension, open the board (`MWNN Kanban: Open Board`), then
     "Developer: Reload Window" → the board panel reopens automatically in the
     same column with current state and working actions.
  2. Close and reopen VS Code on the same workspace with the board previously
     open → the board reopens automatically.
  3. With the board NOT open, reload/restart → nothing auto-opens.
  4. Trigger restore while a board is already open → the existing panel is
     revealed, no duplicate is created.

### 2026-06-29 - Fix: restored panel stuck on "Loading…" (Claude Code)
After installing the VSIX, the restored board tab showed the loading animation
forever. Root cause: with `"activationEvents": []` nothing woke the extension
when VS Code wanted to restore the panel, so the serializer was never
registered and `deserializeWebviewPanel` never ran — VS Code just left the
panel on its stale "Loading board state…" HTML. The `onWebviewPanel:<viewType>`
activation event is required for webview restoration and is not auto-generated.
Fix: added `"onWebviewPanel:mwnn-kanban.board"` to `activationEvents` in
`package.json`. Rebuild the VSIX and reinstall to pick this up.
