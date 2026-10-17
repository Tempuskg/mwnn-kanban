---
id: card-mvcox7nl-1
title: Default the contributed skill installation setting to user
column: col-mqwk2njn-4
position: -78000
assignee: { kind: human }
createdAt: 1792259316993
updatedAt: 1792268545059
---

## Description
Change the default of mwnn-kanban.skillsInstallLocation in package.json to user. Update the setting description and nearby setting comments to explain the default and explicit workspace option. Preserve existing user-scope support and configuration precedence.

## Acceptance criteria
- [x] The contributed default is user; workspace and user remain supported explicit values.
- [x] Setting descriptions explain user installation by default and the retained workspace option; no settings migration is introduced.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 1.1,1.3-setting.
- Import key: mwnn-plan-import:sha256:19eca442a6d3066c84c7776739d30ef04baf6712a92d3a2f4ff22724e01759d4
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).

### 2026-10-17T17:55:15.947Z - AI loop advanced this card
Moved to "Ready".

### 2026-10-17T17:55:18.265Z - AI loop advanced this card
Moved to "Implement".

### 2026-10-17T17:55:23.198Z - Usage Orchestrator chose Anthropic Claude Code CLI
Stage: implementation. Anthropic Claude Code CLI reports 34% remaining, resetting 2026-10-19T09:00:00.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-17T17:55:23.872Z - Usage Orchestrator dispatch dispatch-mvcp5xls-1 started
Card: card-mvcox7nl-1 ("Default the contributed skill installation setting to user"). CLI: Anthropic Claude Code CLI. Stage: implementation.
Requested model: "opus" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: opus.
AI loop stage thinking level rule for the implementation stage: medium.

### 2026-10-17T17:55:26.038Z - Usage Orchestrator dispatch dispatch-mvcp5xls-1 model observed
Card: card-mvcox7nl-1. CLI: Anthropic Claude Code CLI. Stage: implementation.
Actual model: "claude-opus-5-5" (source: Claude Code stream-json system.init.model; attempt: dispatch-mvcp5xls-1).

### 2026-10-17 - Claude Code: blocked on missing prerequisite
Preflight found that `mwnn-kanban.skillsInstallLocation` is absent from `package.json` on the checked-out `main` branch (HEAD 2595c83). The setting, its user-scope implementation, the source plan `docs/user-scope-plan-import-skills-plan.md`, and foundation card `card-mv6yxenp-1` exist only in commit 32af6ff on branch `feat/usage-orchestrator-excluded-clis`, which has not been merged to `main`. No edits made. To unblock: merge that branch into `main` (or check it out), then re-dispatch; the change is then flipping `"default"` to `"user"` and rewording `markdownDescription`/`enumDescriptions`.
Initially reported as blocked: mwnn-kanban.skillsInstallLocation does not exist on the checked-out main branch; its prerequisite commit 32af6ff is only on feat/usage-orchestrator-excluded-clis. Resolved in interview by fast-forward merge into main (see below).

### 2026-10-17T20:04:59.555Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-17 - Interview answer: prerequisite resolution
Question: Where should this card's change be made - merge `feat/usage-orchestrator-excluded-clis` into `main` first, do the change on that feature branch, or something else?
Answer: "Merge" - i.e. merge `feat/usage-orchestrator-excluded-clis` into `main` before making this card's change.
Source: user-reported in Claude Code interview chat, 2026-10-17. The merge has not been performed yet, so the earlier blocker still stands.

### 2026-10-17 - Interview check: merge feasibility (verified evidence)
Read-only check: `main` (2595c83) is an ancestor of `feat/usage-orchestrator-excluded-clis`, so the merge is a fast-forward of 4 commits (f9e8089, 32af6ff, 5c42b45, 122e4ae). `git merge-tree` reports no conflicts, and the branch touches none of the untracked `.mwnn/cards/card-mvcox7nl-*` or `.mwnn/imports/` files. No refs or working-tree files were changed.

### 2026-10-17 - Interview answer: who performs the merge
Question: Should Claude run the merge (`git merge --ff-only feat/usage-orchestrator-excluded-clis` on `main`) now in this chat, or will the user do it?
Answer: "You do it" - Claude Code performs the fast-forward merge in this chat.
Source: user-reported in Claude Code interview chat, 2026-10-17.

### 2026-10-17 - Interview action: prerequisite merged (verified evidence)
Claude Code ran `git merge --ff-only feat/usage-orchestrator-excluded-clis` on `main`: fast-forward 2595c83..122e4ae, 11 files changed, no conflicts. Verified afterwards: `main` HEAD is 122e4ae, and `package.json` line 263 now contributes `mwnn-kanban.skillsInstallLocation` with `"default": "workspace"` and enum `workspace`/`user`. Local `main` is 4 commits ahead of `origin/main` and was not pushed. The untracked `card-mvcox7nl-*` and `.mwnn/imports/` files are unchanged.
The earlier blocker's reason (setting absent from `main`) is resolved. The `STATUS: BLOCKED` line is left in place because both acceptance criteria are still open; this card's own change (default -> `user`, description updates) has not been made.

### 2026-10-17 - Interview answer: who makes the change
Question: Who should make this card's change (default -> `user`, setting description updates): re-dispatch to an AI agent via the AI loop, Claude in this interview chat, or the user?
Answer: "You do it" - Claude Code makes the change in this chat.
Source: user-reported in Claude Code interview chat, 2026-10-17.

### 2026-10-17 - Claude Code: change made and interview closed
Change (verified evidence): `package.json` `mwnn-kanban.skillsInstallLocation` now has `"default": "user"`; enum is unchanged (`workspace`, `user`) and `scope` stays `resource`. `markdownDescription` now says the setting defaults to `user` (installs into each AI tool's user-level folder, adds nothing to the repo) and that `workspace` installs the skills into the workspace. `enumDescriptions` mark `user` as the default and `workspace` as opt-in. `git diff --stat`: only `package.json`, 4 lines changed. No migration code and no other source changes. `package.json` has no comments of its own, so there were none to update. The runtime reader comments and fallback belong to card-mvcox7nl-2.
Validation (verified evidence): `package.json` parses (`node -e require('./package.json')`, default=user, enum=workspace,user); `npm run compile-tests` passed; `npm run compile` passed; `npm test` 792 pass / 0 fail; `npm run lint` clean.
Criteria: (1) met: contributed default is `user`; explicit `workspace` and `user` remain valid enum values, and `readSkillsInstallLocation()` (src/extension.ts:230-231) still maps an explicit `workspace` to workspace and `user` to user. (2) met: descriptions explain the user default and the retained workspace option; no settings migration introduced.
Not covered here (owned by other cards): `readSkillsInstallLocation()` still uses `'workspace'` as its in-code fallback for an invalid value (card-mvcox7nl-2); README/CHANGELOG (card-mvcox7nl-7); Development Host smoke test (card-mvcox7nl-8).
User-reported decisions: merge the prerequisite branch, and have Claude make the merge and the change. Uncommitted: the `package.json` edit. Unpushed: local `main` is 4 commits ahead of `origin/main`. The card's column was not changed.
Status: completed
STATUS: DONE
