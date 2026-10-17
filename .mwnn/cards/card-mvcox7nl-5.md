---
id: card-mvcox7nl-5
title: Verify installer regressions after the default change
column: col-mqwk2njn-1
position: 5000
assignee: { kind: ai }
createdAt: 1792259316993
updatedAt: 1792259316993
dependsOn: [card-mvcox7nl-1, card-mvcox7nl-2]
---

## Description
Reuse existing tests for CODEX_HOME, repeated installation, unrelated Codex instruction preservation, and Cursor skipping. Add coverage only where the changed default exposes a gap; preserve the existing implementation rather than rebuilding it.

## Acceptance criteria
- [ ] Existing CODEX_HOME, repeated-installation, Codex preservation, and Cursor-skip tests pass with the new default.
- [ ] Any changed-behavior coverage gaps are addressed using isolated temporary roots; unchanged user files are not rewritten.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 2.4.
- Import key: mwnn-plan-import:sha256:7f5e1e13ab516010aedcc585585488f85957bf94a5abe6de7e68085465aea9e0
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).
