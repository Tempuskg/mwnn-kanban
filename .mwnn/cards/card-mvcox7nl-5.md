---
id: card-mvcox7nl-5
title: Verify installer regressions after the default change
column: col-mqwk2njn-4
position: -86000
assignee: { kind: ai }
createdAt: 1792259316993
updatedAt: 1792666118425
dependsOn: [card-mvcox7nl-1, card-mvcox7nl-2]
---

## Description
Reuse existing tests for CODEX_HOME, repeated installation, unrelated Codex instruction preservation, and Cursor skipping. Add coverage only where the changed default exposes a gap; preserve the existing implementation rather than rebuilding it.

## Acceptance criteria
- [x] Existing CODEX_HOME, repeated-installation, Codex preservation, and Cursor-skip tests pass with the new default.
- [x] Any changed-behavior coverage gaps are addressed using isolated temporary roots; unchanged user files are not rewritten.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 2.4.
- Import key: mwnn-plan-import:sha256:7f5e1e13ab516010aedcc585585488f85957bf94a5abe6de7e68085465aea9e0
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).

### 2026-10-22T10:27:28.070Z - AI loop advanced this card
Moved to "Ready".

### 2026-10-22T10:46:44.767Z - AI loop advanced this card
Moved to "Implement".

### 2026-10-22T10:46:46.843Z - Anthropic Claude Code CLI implementation handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: opus.
AI loop stage thinking level rule for the implementation stage: medium.

### 2026-10-22 - Claude Code: installer regression verification
- Existing coverage reused unchanged: test/unit/skills.test.ts (CODEX_HOME vs ~/.codex path, Codex block preservation/idempotency, Cursor skipped in user plan, default → user) and test/unit/skillsInstall.test.ts (default-mode user install, Cursor skip, repeated import writes nothing, explicit workspace mode). All pass with the new default.
- Gaps the default exposed at the installer level, now covered in test/unit/skillsInstall.test.ts using isolated os.tmpdir() roots: (1) default install keeps a pre-existing user Codex AGENTS.md's unrelated content and an unrelated user Claude skill byte for byte, and a repeat run rewrites nothing; (2) with CODEX_HOME unset, the Codex block goes to temp ~/.codex/AGENTS.md and the reference points there. No source changes.
- Validation: npm run compile-tests OK, focused skills + skillsInstall 34/34, npm test 866/866, npm run lint clean.
STATUS: DONE

### 2026-10-22T10:47:53.180Z - AI loop advanced this card
Moved to "Verify".

### 2026-10-22T10:47:54.232Z - Anthropic Claude Code CLI verification handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the verification stage: opus.
AI loop stage thinking level rule for the verification stage: medium.

### 2026-10-22 - Claude Code: verification
- Re-read test/unit/skills.test.ts (CODEX_HOME vs ~/.codex path, Codex block preservation/idempotency, Cursor skipped in user plan) and test/unit/skillsInstall.test.ts (default → user, Cursor skip, repeated default import writes nothing, explicit workspace mode).
- Gap coverage present in test/unit/skillsInstall.test.ts using mkdtemp os.tmpdir() roots: unrelated user Codex AGENTS.md content and an unrelated user Claude skill kept byte for byte with a repeat run writing nothing; CODEX_HOME unset routes the Codex block to temp ~/.codex/AGENTS.md. src/skills.ts unchanged.
- npm run compile-tests OK; focused skills + skillsInstall 34/34 pass; npm test 866/866 pass.
VERIFY: PASS

### 2026-10-22T10:48:38.325Z - AI loop verified this card
AI verification passed; moved to "Done".
