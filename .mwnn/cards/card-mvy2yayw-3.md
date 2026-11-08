---
id: card-mvy2yayw-3
title: update card creation skill to include setting schedulefor if needed
column: col-mqwk2njn-4
position: -108000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6-luna
preferredModel.claude-code: sonnet
preferredModel.cursor-other: claude-opus-5-5-medium
thinkingLevel.copilot: medium
thinkingLevel.codex: medium
thinkingLevel.claude-code: medium
createdAt: 1793552672264
updatedAt: 1794156882147
---

## Description
Update the MWNN Card Authoring skill so agents that create or edit card files know when and how to set optional `scheduledFor`. The skill must teach the local wall-time format (`YYYY-MM-DDTHH:mm`, JSON-quoted, no timezone/UTC conversion), date-only → `T00:00` normalization, omit-to-clear, and that a future schedule blocks past Ready alongside unfinished dependencies (Ready reverse-WIP exclusion, AI Loop skip, relocate when blocked beyond Ready). Emphasize judgment: set the field only for an explicit start/not-before time from the request or source; never invent schedules from deadlines, due dates, or metadata timestamps. Edit the bundled authoring skill source so installs and managed copies pick up the guidance; keep plan-import schedule rules consistent where they already cover import-time schedules.

## Acceptance criteria
- [x] Bundled card-authoring skill source documents optional `scheduledFor` with format `YYYY-MM-DDTHH:mm` (JSON-quoted), no timezone/UTC conversion, date-only midnight normalization, and omit-to-clear
- [x] That skill states when to set it: only for an explicit start/not-before schedule from the request or source material — never from deadlines, due dates, or incidental metadata dates
- [x] That skill states the runtime effects of a future schedule (blocks past Ready with unfinished dependencies, excluded from Ready reverse-WIP, AI Loop skips it; hold ends at/after the exact time; blocked cards beyond Ready relocate back to Ready)
- [x] Plan-import skill schedule guidance stays consistent with the authoring skill (import-only explicit start/not-before; same format and effects)
- [x] After the bundled source change, a skills reinstall or equivalent managed-copy refresh would publish the updated authoring guidance (no stale installed copy that omits `scheduledFor` authoring rules)

## Activity
### 2026-11-08T16:48:33.512Z - Usage Orchestrator chose Cursor Agent CLI
Stage: definition. Cursor Agent CLI reports 71% remaining, resetting 2026-11-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-08T16:48:34.221Z - Usage Orchestrator dispatch dispatch-mw82gqel-3 started
Card: card-mvy2yayw-3 ("update card creation skill to include setting schedulefor if needed"). CLI: Cursor Agent CLI. Stage: definition.
Requested model: "auto" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the definition stage: auto.
AI loop stage thinking level rule for the definition stage "max" was not applied: Cursor Agent CLI does not accept a thinking level, so the AI loop stage thinking level rule for the definition stage "max" was not applied and the run used that CLI's default thinking level.

### 2026-11-08T16:48:38.104Z - Usage Orchestrator dispatch dispatch-mw82gqel-3 model observed
Card: card-mvy2yayw-3. CLI: Cursor Agent CLI. Stage: definition.
Actual model: "Auto" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mw82gqel-3).

### 2026-11-08T16:49:28.489Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-sonnet-5.5`, thinking level `medium`
- codex: model `gpt-6-luna`, thinking level `medium`
- claude-code: model `sonnet`, thinking level `medium`
- cursor-other: model `claude-opus-5-5-medium`

### 2026-11-08T16:50:26.932Z - Auto-started in Implement
Assigned to AI in Ready; moved to Implement automatically.

### 2026-11-08T16:50:31.911Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-11-08 Claude Code: implemented
Model note: the card prefers `sonnet`; this run could not switch models and used Claude Opus 5.5 (`claude-opus-5-5`) instead.
- `media/skills/mwnn-card-authoring.md`: added a **Scheduling a card** section covering when to set `scheduledFor` (explicit start/not-before only; never deadlines, due/target/milestone dates, or metadata timestamps; if ambiguous, omit it and note the date in the description), its format (JSON-quoted local `YYYY-MM-DDTHH:mm`, no timezone/UTC conversion, date-only becomes `T00:00`, resolve relative dates), clearing (delete the line, never write it empty), its runtime effects (blocks with dependencies, no moves past Ready, excluded from Ready reverse-WIP, AI Loop skips it, relocated back to Ready, hold ends at the exact minute but dependencies still apply), and keeping an existing schedule when editing a card. The `scheduledFor` field entry now links to that section.
- `media/skills/mwnn-plan-import.md`: aligned the `scheduledFor` rule with the authoring skill (adds due/target/milestone dates, handling of ambiguous dates, and relocation back to Ready) and linked it to the new section.
- `test/unit/skills.test.ts`: added a regression suite checking that both bundled sources contain this guidance and that every rendered install target (Copilot, Claude, Cursor, and the Codex AGENTS.md block) carries the section.
- Installed copies: the installer rewrites any file whose content differs, so a reinstall picks up the new text. Ran `installWorkspaceSkills` here to refresh `.claude/skills/*`, `.github/instructions/mwnn-*.instructions.md`, and the managed block in `AGENTS.md` (only the managed block changed).
- Validation: `npm run compile-tests` passed, `npm test` passed (1113/1113), `npm run lint` passed.
STATUS: DONE
