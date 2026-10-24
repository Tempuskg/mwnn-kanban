---
id: card-mvcox7nl-4
title: Test import installation scope isolation
column: col-mqwk2njn-4
position: -85000
assignee: { kind: ai }
createdAt: 1792259316993
updatedAt: 1792665234122
dependsOn: [card-mvcox7nl-1, card-mvcox7nl-2]
---

## Description
Exercise the Import Plan installation branch with temporary user and workspace roots for the new default and explicit workspace mode. Include detected AI environments and the selected handoff provider. Keep automated writes out of the real user profile.

## Acceptance criteria
- [x] Default imports install both bundled documents only in temporary user targets and leave workspace instruction files unchanged.
- [x] Explicit workspace mode writes workspace targets, and handoff references match the chosen scope.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 2.3.
- Import key: mwnn-plan-import:sha256:dffb60e8c9661ae84a5bdf6c9205057ea7177b0880e7c74d08fd77ace11ac3ed
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).

### 2026-10-22T10:27:20.466Z - AI loop advanced this card
Moved to "Ready".

### 2026-10-22T10:29:58.056Z - AI loop advanced this card
Moved to "Implement".

### 2026-10-22T10:29:59.631Z - Anthropic Claude Code CLI implementation handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: opus.
AI loop stage thinking level rule for the implementation stage: medium.

### 2026-10-22 - Claude Code: implementation complete
- Extracted the Import Plan installation branch (environment detection, workspace install, user install, handoff reference paths) from src/extension.ts into the vscode-free src/skillsInstall.ts; user-level IO is injected (`UserFileIo`), and extension.ts backs it with the existing atomic `vscode.workspace.fs` writer. Behavior unchanged.
- Added test/unit/skillsInstall.test.ts, which uses temp workspace, home, and CODEX_HOME roots under os.tmpdir() (the user IO asserts every path stays inside the temp root, so the real profile is never touched). The workspace has copilot/codex/claude/cursor markers, and each run is repeated for claude-code, copilot, and codex handoff providers:
  - default (unset setting -> user): both bundled documents go to ~/.copilot and ~/.claude SKILL.md plus a CODEX_HOME AGENTS.md managed block; Cursor is skipped; the workspace snapshot is byte-identical; handoff references are absolute temp-user paths that exist. Also covers an unmarked workspace (provider only) and a no-op repeat import.
  - explicit workspace: all workspace targets are written, existing AGENTS.md content is kept, the user folders stay empty, and handoff references are workspace-relative files that exist.
- Validation: npm run compile-tests, npm run compile, focused tests 32/32, npm test 864/864, npm run lint clean.
STATUS: DONE

### 2026-10-22T10:32:53.760Z - AI loop advanced this card
Moved to "Verify".

### 2026-10-22T10:32:54.653Z - Anthropic Claude Code CLI verification handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the verification stage: opus.
AI loop stage thinking level rule for the verification stage: medium.

### 2026-10-22 - Claude Code: verification
- test/unit/skillsInstall.test.ts runs installImportPlanSkills/importPlanSkillReferencePaths (the same functions the Import Plan command in src/extension.ts calls) against temp workspace/home/CODEX_HOME roots under os.tmpdir(); the user IO guard asserts every user write stays in the temp root. The workspace has copilot/codex/claude/cursor markers and each scope is run for claude-code, copilot, and codex handoff providers.
- AC1: default (unset → user) writes both bundled documents only to temp ~/.copilot and ~/.claude SKILL.md plus CODEX_HOME AGENTS.md; the workspace snapshot is asserted byte-identical; references are existing absolute temp-user paths.
- AC2: explicit workspace writes .github/instructions, .claude/skills, .cursor/rules, and the AGENTS.md block (existing content kept), with no user writes; references are workspace-relative files that exist.
- Re-ran: npm run compile-tests OK, focused skillsInstall tests 8/8 pass, npm test 864/864 pass, npm run compile OK, npm run lint clean.
VERIFY: PASS

### 2026-10-22T10:33:54.028Z - AI loop verified this card
AI verification passed; moved to "Done".
