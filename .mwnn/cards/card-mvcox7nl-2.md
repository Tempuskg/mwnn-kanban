---
id: card-mvcox7nl-2
title: Default runtime skill installation routing to user
column: col-mqwk2njn-3
position: 2000
assignee: { kind: human }
createdAt: 1792259316993
updatedAt: 1792268612895
---

## Description
Update readSkillsInstallLocation() in src/extension.ts so missing and invalid values resolve to user while explicit workspace remains supported. Update nearby runtime comments. Keep installation on demand during Import Plan and preserve the existing installer branches.

## Acceptance criteria
- [ ] Missing and invalid values resolve to user; explicit user and workspace resolve to their selected scope.
- [ ] No activation-time installation or rewriting of user settings is introduced.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 1.2,1.3-runtime.
- Import key: mwnn-plan-import:sha256:6614608f5dfc1ec4754eebdfecd7036fb30b8f058aee5bc27270e7b0db0d6a04
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).

### 2026-10-17T17:55:17.087Z - AI loop advanced this card
Moved to "Ready".

### 2026-10-17T17:55:19.399Z - AI loop advanced this card
Moved to "Implement".

### 2026-10-17T17:56:18.940Z - Usage Orchestrator chose Anthropic Claude Code CLI
Stage: implementation. Anthropic Claude Code CLI reports 34% remaining, resetting 2026-10-19T09:00:00.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-17T17:56:19.653Z - Usage Orchestrator dispatch dispatch-mvcp74n9-2 started
Card: card-mvcox7nl-2 ("Default runtime skill installation routing to user"). CLI: Anthropic Claude Code CLI. Stage: implementation.
Requested model: "opus" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: opus.
AI loop stage thinking level rule for the implementation stage: medium.

### 2026-10-17T17:56:22.037Z - Usage Orchestrator dispatch dispatch-mvcp74n9-2 model observed
Card: card-mvcox7nl-2. CLI: Anthropic Claude Code CLI. Stage: implementation.
Actual model: "claude-opus-5-5" (source: Claude Code stream-json system.init.model; attempt: dispatch-mvcp74n9-2).

### 2026-10-17 - Claude Code: blocked, no code changed
`readSkillsInstallLocation()` and the `mwnn-kanban.skillsInstallLocation` user-scope support are not on the checked-out branch (`main`). They exist only on `feat/usage-orchestrator-excluded-clis` (commits 32af6ff and 122e4ae; the function is at src/extension.ts:229 there). The source plan docs/user-scope-plan-import-skills-plan.md is also missing from this working tree. Switching branches here would disturb the concurrent dispatch of card-mvcox7nl-1 in the same working tree, so nothing was edited. To unblock, check out `feat/usage-orchestrator-excluded-clis` (or merge it into `main`), then re-dispatch this card.
STATUS: BLOCKED: target function only exists on branch feat/usage-orchestrator-excluded-clis; workspace is on main

### 2026-10-17T20:23:32.779Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.
