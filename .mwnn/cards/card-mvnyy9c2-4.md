---
id: card-mvnyy9c2-4
title: Test and document card scheduledFor behavior
column: col-mqwk2njn-4
position: -104000
assignee: { kind: ai }
createdAt: 1792941289922
updatedAt: 1793471031416
dependsOn: [card-mvnyy9c2-2, card-mvnyy9c2-3]
---

## Description
Add unit coverage for serialize/parse (including date-only normalize), blocking before/at/after the scheduled time, move gate and relocate when only schedule blocks, Ready reverse-WIP, and AI Loop skip. After green tests, update `AGENTS.md`, the board README template, `aiCards` prompts, and `CHANGELOG.md` Unreleased for the local datetime contract.

## Acceptance criteria
- [x] Unit tests cover schedule blocking around the exact time and related Ready/move/loop behavior
- [x] Board contract and AI authoring/import prompts document `scheduledFor`
- [x] CHANGELOG Unreleased notes the feature

## Activity
- 2026-10-25 import:card-schedule-feature:tests-docs from card_schedule_feature plan

### 2026-10-31T18:21:02.912Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-10-31 - Codex
Verified existing serialize/parse coverage (including date-only normalization), schedule-only relocation, dependency combination, and Ready reverse-WIP. Tightened move/blocking checks to one millisecond before and after the scheduled time. Added five deterministic AI Loop tests covering schedule holds in Backlog/Ready/In Progress/Verify, eligibility at and after the exact time in the same session, and selection of other eligible work while scheduled work waits.

After green focused tests, documented the local datetime contract in AGENTS.md, the board README template, aiCards split/import prompts, and bundled authoring/import skills; added the feature under CHANGELOG Unreleased. Documented minute precision, local wall time without timezone conversion, date-only midnight normalization, invalid/cleared values, and combined schedule/dependency blocking.

Validation: npm run compile-tests, npm run compile, 155 focused tests, npm test (1074 passed), npm run lint, and scoped git diff --check passed. The initial full-suite run hit sandbox permissions in two disposable Git fixtures; the permitted rerun passed all tests. No interactive behavior changed in this card; the prior UI card's Development Host smoke test was not repeated. Preserved existing unrelated changes and this card's column.
STATUS: DONE
