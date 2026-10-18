---
id: card-mvcox7nl-2
title: Default runtime skill installation routing to user
column: col-mqwk2njn-4
position: -80000
assignee: { kind: human }
createdAt: 1792259316993
updatedAt: 1792324946339
---

## Description
Update readSkillsInstallLocation() in src/extension.ts so missing and invalid values resolve to user while explicit workspace remains supported. Update nearby runtime comments. Keep installation on demand during Import Plan and preserve the existing installer branches.

## Acceptance criteria
- [x] Missing and invalid values resolve to user; explicit user and workspace resolve to their selected scope.
- [x] No activation-time installation or rewriting of user settings is introduced.

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
Initially reported as blocked: target function only existed on branch feat/usage-orchestrator-excluded-clis while the workspace was on main; resolved by the function and completed fallback change now present in the working tree, verified below.

### 2026-10-17T20:23:32.779Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-17T20:27:08.207Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-17 - Interview: verified evidence (Claude Code)
Verified evidence, checked in the working tree on `main` during the interview chat, 2026-10-17:
- `readSkillsInstallLocation()` is now on `main` at src/extension.ts:229 (merged via bd90b84). So the reason in the earlier blocked marker, "function only exists on branch feat/usage-orchestrator-excluded-clis", no longer applies. docs/user-scope-plan-import-skills-plan.md is also present.
- The function still reads `get<string>('skillsInstallLocation', 'workspace')` and returns `value === 'user' ? 'user' : 'workspace'`. Invalid values still resolve to `workspace`, so acceptance criterion 1 is not met yet.
- package.json already declares `"default": "user"` for `mwnn-kanban.skillsInstallLocation` (sibling card's scope).
- The Import Plan call site (src/extension.ts:883) still installs on demand, with both installer branches intact.
No code was changed in this interview.

### 2026-10-17 - Interview: remaining work carded
Request (reported by the user in interview chat, 2026-10-17): "create mwnn kanban card(s) for remaining work".
- Created AI card card-mvcunht9-1 ("Change readSkillsInstallLocation fallbacks to user scope", Backlog) for the remaining code change in this card's scope.
- No other new cards: the follow-on tests, docs and smoke checks are already on the board as card-mvcox7nl-3 to card-mvcox7nl-11, and cards 3 to 6 already depend on this card.
- This card's acceptance criteria stay open until card-mvcunht9-1 is done and its evidence has been checked. Assignee, column and the existing STATUS line are unchanged.

### 2026-10-18T05:09:48.101Z - AI-guided interview started in Codex (ChatGPT)
Opened an interview chat in Codex (ChatGPT). Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-18T05:11:20.532Z - AI-guided interview started in Codex (ChatGPT)
Opened an interview chat in Codex (ChatGPT). Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-17 - Codex interview resume: evidence and open verification
- Verified evidence in the current working tree: src/extension.ts:229-232 reads the setting with default `user` and returns `workspace` only for the explicit value `workspace`; other values return `user`. The Import Plan comment describes user scope as the default and workspace as opt-in.
- Verified evidence: both installer calls remain inside the Import Plan callback at src/extension.ts:892 and :899. The current scoped git diff changes only the resolver fallback and nearby comment; it introduces no activation-time installation or settings write.
- Verified board state: linked implementation card card-mvcunht9-1 is in Done with checked criteria. Its Activity reports passing compile-tests, compile and lint; those historical command results have not been independently verified in this interview. Focused routing coverage remains unchecked on separate card card-mvcox7nl-3.
- Interview pause summary: source inspection supports both original acceptance criteria. Both checkboxes remain unchanged while verification evidence is clarified. Open item: location of the recorded validation results for card-mvcunht9-1. No new user answer has been supplied in this chat. No implementation, assignee, column, dependency or STATUS changes made; existing historical entries preserved.
### 2026-10-17 - Interview answer: validation record location
- Question: "The code change is present, and the linked implementation card is in Done. Where are its compile-tests, compile, and lint results recorded beyond the card’s Activity summary?"
- Answer: "just the activity summary"
- Source: user-reported in interview chat, 2026-10-17. The Activity summary is the only reported record of those checks; their historical outcomes were not independently verified in this interview.

### 2026-10-17 - Codex interview closing summary
- Criterion 1 met and individually checked based on verified source evidence: src/extension.ts:229-232 supplies `user` as the missing-value default and returns `workspace` only for the exact value `workspace`. Explicit `user` and invalid values return `user`.
- Criterion 2 met and individually checked based on verified source and scoped diff evidence: the only runtime change is the resolver fallback and its nearby comment. Installation remains inside Import Plan with both installer branches intact; no activation-time installation, settings write or migration was added.
- Verified board evidence: card-mvcunht9-1 is in the Done column. This card has no dependsOn frontmatter. Its column remains Implement (role in-progress, no WIP limit); no move, position change or assignee change was made.
- Both original acceptance criteria are met. No open criteria or unresolved exceptions remain within this card's scope. Focused automated coverage belongs to card-mvcox7nl-3; broader smoke testing remains separate work. This closing summary does not claim those checks passed or the whole feature is complete.
- The answer-location question is resolved by the user's answer above. Historical build/lint success remains an implementer-reported claim, distinct from the source evidence used for this card's criteria. No implementation or linked artifact changes were needed.
- Reworded the obsolete blocked marker into a historical note while preserving its reason. Only this card was edited.
STATUS: DONE
