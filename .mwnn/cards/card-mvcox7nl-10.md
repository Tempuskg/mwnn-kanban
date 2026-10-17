---
id: card-mvcox7nl-10
title: Smoke-test Cursor skipping and installation warnings
column: col-mqwk2njn-1
position: 10000
assignee: { kind: human }
createdAt: 1792259316993
updatedAt: 1792259316993
dependsOn: [card-mvcox7nl-3, card-mvcox7nl-4, card-mvcox7nl-5, card-mvcox7nl-6]
---

## Description
Exercise Cursor and an unwritable isolated user target after targeted validation. Verify the informational skip and existing warning behavior while the plan handoff continues; do not use a real user profile for failure injection.

## Acceptance criteria
- [ ] Cursor is skipped with its informational message and no silent workspace fallback.
- [ ] An unwritable user target produces a warning while a usable self-contained handoff continues; record both outcomes.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 3.4.
- Import key: mwnn-plan-import:sha256:5fa797ebd343a0b95be485db43b8d8b3da95e80523e9d490e5c380e923938fa6
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).
