---
id: card-mvcunht9-1
title: Change readSkillsInstallLocation fallbacks to user scope
column: col-mqwk2njn-4
position: -79000
assignee: { kind: human }
createdAt: 1792268941293
updatedAt: 1792269628839
---

## Description
Code change split out of human card card-mvcox7nl-2 (source: docs/user-scope-plan-import-skills-plan.md, work item 1, second and third bullets). In src/extension.ts, `readSkillsInstallLocation()` (about line 229) currently reads `get<string>('skillsInstallLocation', 'workspace')` and returns `value === 'user' ? 'user' : 'workspace'`, so a missing or invalid value selects workspace. Change it so the missing-value default and any invalid value both resolve to `user`, and only an explicit `workspace` selects workspace. Update the Import Plan comment near the call site (about line 877) so it describes user-level installation as the default and workspace as the opt-in. Keep installation on demand inside Import Plan, keep both installer branches (`ensureUserSkillsInstalled` and `ensureSkillsInstalled`) unchanged, and add no activation-time install or settings migration. Extension-host only; no webview or message-protocol change. The contributed package.json default is already `user` (card-mvcox7nl-1, done). Focused resolver tests belong to card-mvcox7nl-3, not this card.

## Acceptance criteria
- [x] `readSkillsInstallLocation()` returns `user` for unset and invalid values, `user` for explicit `user`, and `workspace` only for explicit `workspace`.
- [x] The Import Plan comment near the call site describes user installation as the default and workspace as opt-in.
- [x] No activation-time installation, settings write, or migration is added, and both installer branches are unchanged.
- [x] `npm run compile-tests`, `npm run compile`, and `npm run lint` pass.

## Activity
- 2026-10-17 Claude Code: created from the interview on card-mvcox7nl-2 to carry its remaining code change. Import key: mwnn-plan-import:sha256:6614608f5dfc1ec4754eebdfecd7036fb30b8f058aee5bc27270e7b0db0d6a04 (work item 1.2,1.3-runtime).

### 2026-10-17T20:39:12.729Z - Usage Orchestrator chose Anthropic Claude Code CLI
Stage: implementation. Anthropic Claude Code CLI reports 32% remaining, resetting 2026-10-19T08:59:00.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-17T20:39:13.307Z - Usage Orchestrator dispatch dispatch-mvcv0m1n-1 started
Card: card-mvcunht9-1 ("Change readSkillsInstallLocation fallbacks to user scope"). CLI: Anthropic Claude Code CLI. Stage: implementation.
Requested model: "opus" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: opus.
AI loop stage thinking level rule for the implementation stage: medium.

### 2026-10-17T20:39:15.298Z - Usage Orchestrator dispatch dispatch-mvcv0m1n-1 model observed
Card: card-mvcunht9-1. CLI: Anthropic Claude Code CLI. Stage: implementation.
Actual model: "claude-opus-5-5" (source: Claude Code stream-json system.init.model; attempt: dispatch-mvcv0m1n-1).

### 2026-10-17 Claude Code: implemented
Changed `readSkillsInstallLocation()` in src/extension.ts to read `get<string>('skillsInstallLocation', 'user')` and return `value === 'workspace' ? 'workspace' : 'user'`, so unset/invalid/`user` resolve to user and only explicit `workspace` selects workspace. Rewrote the Import Plan comment above the call site to describe user-level install as the default and workspace as opt-in. No activation-time install, settings write, or migration added; `ensureUserSkillsInstalled` and `ensureSkillsInstalled` untouched. `npm run compile-tests`, `npm run compile`, and `npm run lint` pass. Resolver tests remain with card-mvcox7nl-3.
STATUS: DONE

### 2026-10-17T20:40:06.294Z - Run with AI parked in Verify
Implementation finished; reassigned to Human for verification and sign-off.
