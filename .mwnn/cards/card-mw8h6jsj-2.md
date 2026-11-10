---
id: card-mw8h6jsj-2
title: Smoke-test the Pro trial start in a clean profile on 1.0.11
column: col-mqwk2njn-1
position: 1000
assignee: { kind: human }
createdAt: 1794181233331
updatedAt: 1794181233331
dependsOn: [card-mw89f8vw-1]
---

## Description
Free 1.0.11 (released 2026-11-08, bundling `@tempuskg/mwnn-kanban-pro` 1.0.6) is meant to start the 14-day Pro trial the first time a gated Pro feature opens, not at activation. The code and the packaged VSIX were checked, but nobody has seen it work at runtime. Free 1.0.10 shipped with this broken because its tests ran against a local Pro build.

Install the published 1.0.11 from the Marketplace or Open VSX into a clean profile, for example `code --user-data-dir <temp> --extensions-dir <temp-ext>`, with no license key and no stored trial.

## Acceptance criteria
- [ ] The installed version is 1.0.11 and Pro loads from the shipped `node_modules/@tempuskg/mwnn-kanban-pro` (1.0.6)
- [ ] After activation alone, the license status shows no trial, and My Work does not appear
- [ ] Running Open Portfolio opens the Portfolio and the license status shows a 14-day trial
- [ ] Reloading the window keeps the same trial start date

## Activity
