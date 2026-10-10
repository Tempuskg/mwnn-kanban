---
id: card-mv2ik8oc-2
title: "Add Pro upgrade, AI usage, and license actions to the sidebar view title"
column: col-mqwk2njn-1
position: 3000
assignee: { kind: ai }
createdAt: 1791643972377
updatedAt: 1791643972377
---

## Description
Add `package.json` `menus.view/title` entries for the `mwnn-kanban.sidebar` view, as decided in wiki/command-ui-surfaces.md (from card-mv2h1yip-1):
- `mwnn-kanban.upgradeToPro`: `navigation@2`, when `view == mwnn-kanban.sidebar && !mwnn-kanban.hasProLicense`
- `mwnn-kanban-pro.showAiUsage`: `navigation@2`, when `view == mwnn-kanban.sidebar && mwnn-kanban.hasProLicense`
- `mwnn-kanban.showProLicenseStatus`: overflow group `pro@1`, when `view == mwnn-kanban.sidebar`
- `mwnn-kanban.enterProLicenseKey`: overflow group `pro@2`, when `view == mwnn-kanban.sidebar && !mwnn-kanban.hasProLicense`

Do **not** add Clear Pro License Key or Reset Board; both stay palette-only by decision.

## Acceptance criteria
- [ ] Without a license, the sidebar title shows the gear plus a Get Pro star, and the overflow offers Show Pro License Status and Enter Pro License Key
- [ ] With a license or trial, the star is replaced by the Show AI Provider Usage icon, and Enter Pro License Key is hidden
- [ ] No menu entry exists for `clearProLicenseKey` or `resetBoard`
- [ ] Every new entry includes the `view == mwnn-kanban.sidebar` clause and the documented license clause
- [ ] Development Host smoke test: toggle the license via enter/clear key and see the title bar update

## Activity
- 2026-10-10 Claude Code: created from the command UI audit (card-mv2h1yip-1)
