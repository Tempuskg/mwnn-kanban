---
id: card-mvcox7nl-3
title: Test skill installation setting resolution
column: col-mqwk2njn-4
position: -83000
assignee: { kind: human }
createdAt: 1792259316993
updatedAt: 1792345895837
dependsOn: [card-mvcox7nl-1, card-mvcox7nl-2]
---

## Description
Use the smallest existing test seam to cover unset, invalid, user, and workspace values and verify agreement between the contributed and runtime defaults. Extract a pure resolver only if needed.

## Acceptance criteria
- [x] Focused coverage passes for unset, invalid, user, and workspace values.
- [x] A focused check verifies that the manifest and runtime both default to user.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 2.1-2.2.
- Import key: mwnn-plan-import:sha256:3a47295681395efc40f87d1fc298c90d38f99b48842fe7fb32d4b5ef9a221e83
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).

### 2026-10-18T17:46:29.930Z - Anthropic Claude Code CLI implementation handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: claude-sonnet-5-5-extended-thinking-preview.
Card thinking level: medium.

### 2026-10-18T17:46:33.445Z - Anthropic Claude Code CLI implementation handoff failed
Anthropic Claude Code CLI ended with exit code 1: Ignoring 3 permissions.allow entries from .claude/settings.json: this workspace has not been trusted. Run Claude Code interactively here once and accept the trust dialog, or set projects["e:/mwnn-kanban"].hasTrustDialogAccepted: true in C:\Users\darre\.claude.json.. The card was not advanced; verify CLI authentication/configuration and rerun the loop. The run used the card's preferred model "claude-sonnet-5-5-extended-thinking-preview".

### 2026-10-18T17:47:02.617Z - Usage Orchestrator chose Anthropic Claude Code CLI
Stage: implementation. Anthropic Claude Code CLI reports 23% remaining, resetting 2026-10-19T09:00:00.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-18T17:47:03.191Z - Usage Orchestrator dispatch dispatch-mve4b1xz-1 started
Card: card-mvcox7nl-3 ("Test skill installation setting resolution"). CLI: Anthropic Claude Code CLI. Stage: implementation.
Requested model: "opus" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: opus.
AI loop stage thinking level rule for the implementation stage: medium.

### 2026-10-18T17:47:05.479Z - Usage Orchestrator dispatch dispatch-mve4b1xz-1 model observed
Card: card-mvcox7nl-3. CLI: Anthropic Claude Code CLI. Stage: implementation.
Actual model: "claude-opus-5-5" (source: Claude Code stream-json system.init.model; attempt: dispatch-mve4b1xz-1).

### 2026-10-18 - Claude Code: implementation complete
- Extracted pure `resolveSkillsInstallLocation()` and `DEFAULT_SKILLS_INSTALL_LOCATION` ('user') into src/skills.ts (extension.ts imports `vscode` and is not unit-testable); `readSkillsInstallLocation()` in src/extension.ts now delegates to it with unchanged behavior.
- Added suite "skillsInstallLocation setting resolution" to test/unit/skills.test.ts: unset -> user, invalid values (null, '', case/whitespace variants, unknown string, non-strings) -> user, explicit user/workspace -> own scope, and a manifest check that package.json default is `user`, enum is {user, workspace}, and equals the runtime default.
- Validation: npm run compile-tests, npm run compile, focused skills tests (24/24), npm test (837/837 pass), eslint on touched files clean.
STATUS: DONE

### 2026-10-18T17:48:23.401Z - Run with AI parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
