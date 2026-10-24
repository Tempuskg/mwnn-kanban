---
id: card-mvcox7nl-6
title: Test handoff fallback after a user installation failure
column: col-mqwk2njn-4
position: -87000
assignee: { kind: ai }
createdAt: 1792259316993
updatedAt: 1792666286138
dependsOn: [card-mvcox7nl-1, card-mvcox7nl-2]
---

## Description
Verify the changed default still produces a usable self-contained plan handoff when writing a user target fails. Reuse the warning and fallback behavior without silently falling back to workspace writes.

## Acceptance criteria
- [x] An isolated write-failure check confirms a warning and a usable self-contained handoff.
- [x] The handoff continues without creating workspace instruction files as a fallback.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 2.5.
- Import key: mwnn-plan-import:sha256:272004ae7c110e9e408084979f1accc7f5287dd6ff625677ce5805a5afb8887d
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).

### 2026-10-22T10:27:35.860Z - AI loop advanced this card
Moved to "Ready".

### 2026-10-22T10:27:37.949Z - AI loop advanced this card
Moved to "Implement".

### 2026-10-22T10:48:43.777Z - Anthropic Claude Code CLI implementation handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: opus.
AI loop stage thinking level rule for the implementation stage: medium.

### 2026-10-22 Claude Code: implemented
- Extracted the Import Plan best-effort install (warning on failure, no scope fallback) from `src/extension.ts` into `tryInstallImportPlanSkills` in `src/skillsInstall.ts`; the command now shows its returned warning.
- Added a temp-folder test in `test/unit/skillsInstall.test.ts` (per Claude Code/Copilot/Codex handoff): the default `user` scope's writes throw EACCES, the outcome carries a "your user folder … self-contained" warning, the workspace stays byte-for-byte unchanged, user folders stay empty, and `buildPlanImportPrompt` still embeds the card contract, decomposition rules, target column, and STATUS markers.
- Validation: compile-tests, compile, `npm test` (869/869 pass), eslint on touched files clean.
STATUS: DONE

### 2026-10-22T10:50:32.401Z - AI loop advanced this card
Moved to "Verify".

### 2026-10-22T10:50:33.412Z - Anthropic Claude Code CLI verification handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the verification stage: opus.
AI loop stage thinking level rule for the verification stage: medium.

### 2026-10-22 Claude Code: verification
- `src/skillsInstall.ts` `tryInstallImportPlanSkills` turns a load/write failure into a warning ("Could not install the MWNN skills into your user folder: … Continuing — the prompt is self-contained.") and has no retry at the workspace scope; `src/extension.ts` Import Plan shows that warning via `showWarningMessage` and then builds and hands off the plan prompt.
- `test/unit/skillsInstall.test.ts`: the isolated failure test (per Claude Code/Copilot/Codex) uses the default `user` scope with a user FS whose writes throw EACCES, asserts the warning text, a byte-for-byte unchanged temp workspace, empty user folders, and that `buildPlanImportPrompt` still embeds the card path contract, target column, acceptance-criteria section, decomposition rules, and STATUS markers.
- Ran `npm run compile-tests` and `npm run compile` (both clean), the focused test file (13/13 pass), and `npm test` (869/869 pass).
VERIFY: PASS

### 2026-10-22T10:51:26.037Z - AI loop verified this card
AI verification passed; moved to "Done".
