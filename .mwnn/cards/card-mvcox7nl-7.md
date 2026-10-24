---
id: card-mvcox7nl-7
title: Document the verified user installation default
column: col-mqwk2njn-4
position: -88000
assignee: { kind: ai }
createdAt: 1792259316993
updatedAt: 1792666856353
dependsOn: [card-mvcox7nl-3, card-mvcox7nl-4, card-mvcox7nl-5, card-mvcox7nl-6]
---

## Description
After item 2 passes targeted validation, update the installation-scope section in README.md and add a concise CHANGELOG.md entry. Describe the new default, preservation of old workspace guidance, and precedence of existing explicit settings.

## Acceptance criteria
- [x] README.md explains user installation by default, the explicit workspace option, and that old workspace files remain.
- [x] CHANGELOG.md records the default change concisely; documentation follows passing targeted validation and preserves explicit-setting precedence.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 3.1.
- Import key: mwnn-plan-import:sha256:b6868578a7b899897a9caf8da26e2f71ba50fc9b3b0eeaa7d6a2e9cebb91508a
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).

### 2026-10-22T10:59:28.290Z - AI loop advanced this card
Moved to "Ready".

### 2026-10-22T10:59:30.111Z - AI loop advanced this card
Moved to "Implement".

### 2026-10-22T10:59:31.076Z - Anthropic Claude Code CLI implementation handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: opus.
AI loop stage thinking level rule for the implementation stage: medium.

### 2026-10-22 - Claude Code: documentation complete
- Targeted validation first: dependency cards 3–6 are Done; `npm run compile-tests` OK and focused `skills` + `skillsInstall` tests 37/37 pass.
- README.md `mwnn-kanban.skillsInstallLocation` row: default now shown as `user` (home-folder targets, Cursor skipped), `workspace` described as the explicit opt-in, MWNN files from earlier workspace installs are kept untouched, an explicit `workspace` setting still wins, and a failed user install warns without falling back to workspace writes.
- CHANGELOG.md `[Unreleased]` → `### Changed`: one concise entry for the new default, the `workspace` opt-in, explicit-setting precedence, and preserved workspace files.
STATUS: DONE

### 2026-10-22T11:00:25.606Z - AI loop advanced this card
Moved to "Verify".

### 2026-10-22T11:00:26.464Z - Anthropic Claude Code CLI verification handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the verification stage: opus.
AI loop stage thinking level rule for the verification stage: medium.

### 2026-10-22 - Claude Code: verification
- README.md `mwnn-kanban.skillsInstallLocation` row now shows default `user` (home-folder targets, Cursor skipped with notice), `workspace` as the explicit opt-in, and states that MWNN files from earlier workspace installs are kept (neither updated nor deleted by `user` mode) and that an explicit `workspace` value still wins.
- CHANGELOG.md `[Unreleased]` → `### Changed` has one concise entry covering the new default, the `workspace` opt-in, explicit-setting precedence, and preserved workspace files.
- Docs match source: package.json contributes `"default": "user"`; extension.ts reads the setting via `getConfiguration().get(...)`, so an explicit user/workspace value overrides the default.
- Targeted validation re-run: `npm run compile-tests` OK; `node --test dist-test/test/unit/skills*.test.js` 37/37 pass (including explicit workspace mode and failed-default-user-install cases). Dependency cards 3–6 were completed before the docs edit.
VERIFY: PASS

### 2026-10-22T11:00:56.255Z - AI loop verified this card
AI verification passed; moved to "Done".
