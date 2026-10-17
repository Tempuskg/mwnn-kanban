---
id: card-mvcox7nl-4
title: Test import installation scope isolation
column: col-mqwk2njn-1
position: 4000
assignee: { kind: ai }
createdAt: 1792259316993
updatedAt: 1792259316993
dependsOn: [card-mvcox7nl-1, card-mvcox7nl-2]
---

## Description
Exercise the Import Plan installation branch with temporary user and workspace roots for the new default and explicit workspace mode. Include detected AI environments and the selected handoff provider. Keep automated writes out of the real user profile.

## Acceptance criteria
- [ ] Default imports install both bundled documents only in temporary user targets and leave workspace instruction files unchanged.
- [ ] Explicit workspace mode writes workspace targets, and handoff references match the chosen scope.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 2.3.
- Import key: mwnn-plan-import:sha256:dffb60e8c9661ae84a5bdf6c9205057ea7177b0880e7c74d08fd77ace11ac3ed
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).
