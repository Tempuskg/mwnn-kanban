---
id: card-mv2ik8oc-3
title: Add timesheet and reporting actions to the My Work view title
column: col-mqwk2njn-1
position: 4000
assignee: { kind: ai }
createdAt: 1791643972377
updatedAt: 1791643972377
---

## Description
Add `package.json` `menus.view/title` entries for the `mwnn-kanban.myWork` view, as decided in wiki/command-ui-surfaces.md (from card-mv2h1yip-1). Each entry is gated on `view == mwnn-kanban.myWork && mwnn-kanban.hasProLicense`:
- `mwnn-kanban-pro.openTimesheet`: `navigation@3` (primary icon after Portfolio and Rescan)
- `mwnn-kanban-pro.correctLastSession`: overflow `timesheet@1`
- `mwnn-kanban-pro.exportTimesheet`: overflow `timesheet@2`
- `mwnn-kanban-pro.exportReviewDigest`: overflow `reports@1`
- `mwnn-kanban-pro.setAllocationTargets`: overflow `settings@1`

Before adding the button, confirm with the user whether `openTimesheet` keeps its "Correct Timesheet" title, which is flagged in the wiki page. If it is renamed, the AGENTS.md rename sweep applies.

## Acceptance criteria
- [ ] The My Work title shows Portfolio, Rescan, and Timesheet icons, in that order
- [ ] The overflow menu lists Correct Last Session, Export Timesheet, Export Review Digest, and Set Allocation Targets in grouped sections
- [ ] All entries are hidden without a Pro license
- [ ] The decision on the "Correct Timesheet" title is recorded in this card's Activity
- [ ] Development Host smoke test with a Pro license: each new menu item runs its command

## Activity
- 2026-10-10 Claude Code: created from the command UI audit (card-mv2h1yip-1)
