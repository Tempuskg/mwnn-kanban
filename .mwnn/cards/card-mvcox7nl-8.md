---
id: card-mvcox7nl-8
title: Smoke-test default user installation in a Development Host
column: col-mqwk2njn-1
position: 8000
assignee: { kind: human }
createdAt: 1792259316993
updatedAt: 1792259316993
dependsOn: [card-mvcox7nl-3, card-mvcox7nl-4, card-mvcox7nl-5, card-mvcox7nl-6]
---

## Description
Use a disposable workspace and isolated user environment. Clear the installation setting, import a small plan, and inspect user targets, handoff references, and the workspace diff. Follow the plan validation order before interactive checks.

## Acceptance criteria
- [ ] With the setting cleared, both bundled guides are installed at the expected isolated user targets and the handoff references user paths.
- [ ] The workspace diff shows no new, modified, or removed workspace instruction files; record the observed result.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 3.2.
- Import key: mwnn-plan-import:sha256:331d176abfdcdbb1c4d41d4cdf0fa9c05ead4ef19158da9ff862a91d101a3ec6
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).
