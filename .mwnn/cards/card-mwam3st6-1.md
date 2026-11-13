---
id: card-mwam3st6-1
title: Local test install and smoke test of 1.0.12 before publishing
column: col-mqwk2njn-4
position: -115000
assignee: { kind: human }
createdAt: 1794310435482
updatedAt: 1794363545689
---

## Description
Release 1.0.12 is committed locally (`a67e21e`) but not pushed or tagged. Before pushing the `v1.0.12` tag, which publishes to both the VS Code Marketplace and Open VSX, install the working-tree build and smoke-test it.

Package with dependencies (never `--no-dependencies`) to a temp path:
`npx --yes @vscode/vsce package --out "$env:TEMP\mwnn-kanban-test.vsix"`. Confirm the archive contains `extension/node_modules/@tempuskg/mwnn-kanban-pro/`, install with `code --install-extension "$env:TEMP\mwnn-kanban-test.vsix" --force`, then reload the window.

Main change to check: cards moved into a Done column land at the top.

## Acceptance criteria
- [x] The VSIX contains `extension/node_modules/@tempuskg/mwnn-kanban-pro/` (1.0.6) and installs as version 1.0.12
- [x] The board opens and loads `.mwnn/` without errors after a window reload
- [x] Dragging or editing a card into Done places it at the top, with the other Done cards keeping their order
- [x] Moving a card into a non-Done column still appends it to the end
- [x] Pro features (for example Open Portfolio) still load

## Activity
### 2026-11-10T11:41:02.038Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-11-10 - Claude Code: packaging verified (verified evidence)
- `git status --short`: only `.mwnn/cards/` files differ from `a67e21e`, so the build matches the release commit.
- `npm run check:pro-package`: "@tempuskg/mwnn-kanban-pro@1.0.6 matches lockfile integrity and dist/index.js".
- `npx --yes @vscode/vsce package --out "$env:TEMP\mwnn-kanban-test.vsix"`: packaged C:\Users\darre\AppData\Local\Temp\mwnn-kanban-test.vsix (22 files, 351.8 KB, SHA-256 35CB3532BA64EB288B4CFAC0833DA47A39B0706AB1962A1F72AD92B97BCBFA8D).
- Inside the archive: `extension/package.json` = mwnn-kanban@1.0.12; `extension/node_modules/@tempuskg/mwnn-kanban-pro/package.json` = @tempuskg/mwnn-kanban-pro@1.0.6 (dist/index.js and media/portfolio.* present).
- `code --list-extensions --show-versions`: darrenjmcleod.mwnn-kanban@1.0.11 currently installed; 1.0.12 not yet installed. Awaiting go-ahead to install.

### 2026-11-10 - Claude Code: test VSIX installed
- Q: Install the 1.0.12 test VSIX over the installed 1.0.11? A: "Yes" (user-reported approval, interview chat, 2026-11-10).
- `code --install-extension "$env:TEMP\mwnn-kanban-test.vsix" --force`: "Extension 'mwnn-kanban-test.vsix' was successfully installed." (verified evidence)
- `code --list-extensions --show-versions`: darrenjmcleod.mwnn-kanban@1.0.12 (verified evidence). Criterion 1 met. Window reload still pending.

### 2026-11-10 - Interview: board load after reload
- Q: After reloading the window, does the board open and load `.mwnn/` without errors? A: "Yes" (user-reported by Darren McLeod in interview chat, 2026-11-10). Criterion 2 met (user-reported).

### 2026-11-10 - Claude Code: Done-placement test setup (verified evidence)
- Snapshot of the Done column (col-mqwk2njn-4) before the test saved to the session scratchpad as done-before.txt; current minimum position is -114000 (card-mw8ij8mv-2).
- Created throwaway card `card-mwamtest-1` in Backlog at position 2000 for the drag test. It is to be deleted after the test.

### 2026-11-10 - Done drag test, first attempt (verified evidence + user-reported)
- User reported dragging `card-mwamtest-1` from Backlog into Done ("Done", interview chat, 2026-11-10).
- Card file after the drag: `column: col-mqwk2njn-4`, `position: -113500`, so it is 2nd in Done (index 1), between card-mw8ij8mv-2 (-114000) and card-mw8ii6eu-1 (-113000). Not at the top.
- The other 147 Done cards have the same positions and order as the pre-test snapshot (diff of done-before.txt and done-after.txt was empty).
- `src/utils.ts` `insertIndexForColumnPlacement` (lines 894-903): an explicit drop index always wins, and top placement applies only when no index is given (editor column change, agent/API moves). The result most likely reflects the drop slot rather than a defect. Criterion 3 is not yet shown; next test uses the editor's column field, which gives no index.

### 2026-11-10 - Editor move to Backlog (verified evidence + user-reported)
- User reported changing `card-mwamtest-1` to Backlog in the card editor and saving ("Done", interview chat, 2026-11-10).
- Card file after save: `column: col-mqwk2njn-1`, `position: 0`, so it sits ABOVE card-mw8h6jsj-2 (1000). It went to the top of Backlog, not the end.
- Cause: `media/board.js` `columnChangeMove` (lines 30-35) always posts `moveCard` with `toIndex: 0`, so an editor column change puts the card at the top of any column. Not a 1.0.12 regression: `git log -S` traces it to 34b1e29, and 1.0.11 (db4695d) has the same line.
- Criterion 4 ("Moving a card into a non-Done column still appends it to the end") is NOT met for the editor path. Waiting for a decision from the user on whether this blocks the release.

### 2026-11-10 - Interview: editor top placement in non-Done columns
- Q: Is the editor putting cards at the top of non-Done columns a defect to fix before 1.0.12, or intended existing behaviour? A: "That's intended" (user-reported by Darren McLeod in interview chat, 2026-11-10).
- Not a release blocker. Criterion 4 will be confirmed by dragging to the end of a non-Done column, with the editor path excluded per this answer.

### 2026-11-10 - Editor move into Done (verified evidence + user-reported)
- User reported changing `card-mwamtest-1` to Done in the card editor and saving ("Done", interview chat, 2026-11-10).
- Card file: `column: col-mqwk2njn-4`, `position: -115000`, which is strictly below the previous minimum (-114000, card-mw8ij8mv-2), so it is first in Done.
- The other 147 Done cards have the same positions and order as the pre-test snapshot (empty diff against done-before.txt).
- Criterion 3 met: editing a card into Done puts it at the top, and the earlier drag kept the other Done cards in order. A drag honours its drop slot by design (`insertIndexForColumnPlacement`).

### 2026-11-10 - Drag into Backlog (verified evidence + user-reported)
- User reported dragging `card-mwamtest-1` from Done into Backlog, below card-mw8h6jsj-2 ("Done", interview chat, 2026-11-10).
- Card file: `column: col-mqwk2njn-1`, `position: 2000`, after card-mw8h6jsj-2 (1000), so it is last in Backlog. The Done column again matches the pre-test snapshot exactly.
- Criterion 4 met for drag moves. Editor moves put the card at the top of non-Done columns; the user confirmed that is intended (see the entry above).

### 2026-11-10 - Interview: Pro features
- Q: Does Open Portfolio open and load without errors? A: "Yes" (user-reported by Darren McLeod in interview chat, 2026-11-10). Criterion 5 met (user-reported).

### 2026-11-10 - Closing summary
- Removed the throwaway test card `card-mwamtest-1.md` (created by Claude Code for this test). Done and Backlog match their pre-test order.
- Criterion 1 met (verified evidence): the VSIX contains @tempuskg/mwnn-kanban-pro@1.0.6, and darrenjmcleod.mwnn-kanban@1.0.12 is installed.
- Criterion 2 met (user-reported): the board loads after a window reload.
- Criterion 3 met (verified from the card files): an editor move into Done put the card at the top (-115000); the other Done cards kept their order. A drag honours its drop slot by design.
- Criterion 4 met (verified from the card files): a drag into Backlog added the card at the end (2000). Editor moves put the card at the top of non-Done columns, which the user confirmed is intended (in place since 34b1e29, not a 1.0.12 change).
- Criterion 5 met (user-reported): Open Portfolio loads.
- No unresolved exceptions. Still to do and not done here: push a67e21e and the v1.0.12 tag to publish to both the VS Code Marketplace and Open VSX. The card was not moved; the column is left to the board's rules.
STATUS: DONE
