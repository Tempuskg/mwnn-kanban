---
id: card-mv2ik8oc-2
title: "Add Pro upgrade, AI usage, and license actions to the sidebar view title"
column: col-mqwk2njn-4
position: -70000
assignee: { kind: human }
createdAt: 1791643972377
updatedAt: 1791649547484
---

## Description
Add `package.json` `menus.view/title` entries for the `mwnn-kanban.sidebar` view, as decided in wiki/command-ui-surfaces.md (from card-mv2h1yip-1):
- `mwnn-kanban.upgradeToPro`: `navigation@2`, when `view == mwnn-kanban.sidebar && !mwnn-kanban.hasProLicense`
- `mwnn-kanban-pro.showAiUsage`: `navigation@2`, when `view == mwnn-kanban.sidebar && mwnn-kanban.hasProLicense`
- `mwnn-kanban.showProLicenseStatus`: overflow group `pro@1`, when `view == mwnn-kanban.sidebar`
- `mwnn-kanban.enterProLicenseKey`: overflow group `pro@2`, when `view == mwnn-kanban.sidebar && !mwnn-kanban.hasProLicense`

Do **not** add Clear Pro License Key or Reset Board; both stay palette-only by decision.

## Acceptance criteria
- [x] Without a license, the sidebar title shows the gear plus a Get Pro star, and the overflow offers Show Pro License Status and Enter Pro License Key
- [x] With a license or trial, the star is replaced by the Show AI Provider Usage icon, and Enter Pro License Key is hidden
- [x] No menu entry exists for `clearProLicenseKey` or `resetBoard`
- [x] Every new entry includes the `view == mwnn-kanban.sidebar` clause and the documented license clause
- [x] Development Host smoke test: toggle the license via enter/clear key and see the title bar update

## Activity
- 2026-10-10 Claude Code: created from the command UI audit (card-mv2h1yip-1)

### 2026-10-10T15:18:01.031Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-10T15:18:46.689Z - Anthropic Claude Code CLI implementation handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: opus.
AI loop stage thinking level rule for the implementation stage: medium.

### 2026-10-10T15:18:50.920Z - Anthropic Claude Code CLI implementation handoff cancelled
The active CLI process was stopped. The card was not advanced and remains assigned for a recoverable retry.

### 2026-10-10T15:34:39.814Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-10 - Claude Code: implementation complete, smoke test pending
Added four `menus.view/title` entries in `package.json` for `mwnn-kanban.sidebar`: `upgradeToPro` (navigation@2, `!mwnn-kanban.hasProLicense`, icon `$(star-full)`), `mwnn-kanban-pro.showAiUsage` (navigation@2, `mwnn-kanban.hasProLicense`, icon `$(dashboard)`), `showProLicenseStatus` (overflow `pro@1`), and `enterProLicenseKey` (overflow `pro@2`, `!mwnn-kanban.hasProLicense`). Checked by script: no view/title entry for `clearProLicenseKey` or `resetBoard`. The context key is published by `src/pro/upgrade.ts` and refreshed after the enter and clear key commands. `npm run compile-tests`, `npm run compile`, and `npm test` passed (783/783).
The first two criteria (visible title-bar icons with and without a license) and the smoke test need a Development Host check: F5, open the MWNN sidebar, confirm the gear and star plus overflow Show Pro License Status / Enter Pro License Key; run Enter Pro License Key with a valid key or trial and confirm the star becomes the dashboard icon and Enter Pro License Key disappears; run Clear Pro License Key and confirm it reverts.
Initially reported as blocked: Development Host smoke test of the sidebar title bar needed a human; resolved below.

### 2026-10-10T16:21:02.559Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-10 - Interview: unlicensed sidebar title bar
Q: In the Development Host with no Pro license or trial, does the MWNN sidebar title show the gear and star icons, and does the overflow offer Show Pro License Status and Enter Pro License Key?
A: Yes. (User-reported in interview chat, 2026-10-10.)

### 2026-10-10 - Interview: licensed sidebar title bar
Q: After entering a valid Pro license key or starting a trial, is the star replaced by the Show AI Provider Usage (dashboard) icon, and is Enter Pro License Key hidden from the overflow?
A: Yes. (User-reported in interview chat, 2026-10-10.)

### 2026-10-10 - Interview: license toggle back to unlicensed
Q: After running Clear Pro License Key, does the title bar revert immediately (no reload) to the star icon with Enter Pro License Key back in the overflow?
A: Yes. (User-reported in interview chat, 2026-10-10.)

### 2026-10-10 - Interview summary
All five acceptance criteria are met. Criteria 3 and 4 (no clearProLicenseKey/resetBoard entry; every entry has the view and license clauses) are verified evidence: package.json view/title entries were checked by script and re-read in this interview. Criteria 1, 2 and 5 (unlicensed title bar, licensed title bar, enter/clear toggle updating live) are user-reported from a Development Host smoke test in this interview chat. There are no unresolved exceptions. The card has not been moved and its assignee is unchanged.
STATUS: DONE
