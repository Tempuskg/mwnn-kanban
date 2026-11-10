---
id: card-mw8ii6eu-1
title: "fix error: Missing or invalid verification inputs. Configure .mwnn/verification.json, with a check mapping for every acceptance criterion, before dispatch."
column: col-mqwk2njn-4
position: -113000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6-luna
preferredModel.claude-code: sonnet
preferredModel.cursor-other: claude-opus-5-5-medium
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1794183455478
updatedAt: 1794237033189
---

## Description
Independent verification for CLI handoffs is failing before any checks run because `.mwnn/verification.json` is missing (or invalid). Several cards already hit that preparation error after reporting DONE (for example `card-mw89f8vw-1` and `card-mw8h6jsj-3`).

Create a version-1 verification profile at the repository-root path `.mwnn/verification.json` (that path is fixed even if the board folder setting changes), following `docs/independent-verification.md`. Map the exact acceptance-criterion text of each checkbox (no Markdown marker) to allowed check ids that actually prove that criterion. Include every criterion on cards that still need a verification-gated dispatch or re-dispatch, and include this card's own criteria so its implementation can be verified once the file exists. Use `human: true` with empty `checks` only when no automated check can establish the criterion. If any mapping uses `focused-tests`, list only compiled test paths under `dist-test/test/`.

## Acceptance criteria
- [x] `.mwnn/verification.json` exists at the repository root and parses as a version-1 profile (`version`, `criteria`, optional `focusedTests`) per `docs/independent-verification.md`
- [x] Every acceptance criterion on this card is mapped by exact checkbox text (without `- [ ]` / `- [x]`) to a non-empty `checks` array of allowed ids (`compile-tests`, `compile`, `focused-tests`, `tests`, `lint`, `diff`), or to `human: true` with empty `checks` when automation cannot prove it
- [x] Every acceptance criterion on cards that already failed with "Missing or invalid verification inputs" and still need independent verification (at least `card-mw89f8vw-1` and `card-mw8h6jsj-3`) is likewise mapped by exact text
- [x] Any `focusedTests` entries name only compiled `.test.js` files under `dist-test/test/`
- [x] With that profile in place, independent-verification input capture no longer fails with "Missing or invalid verification inputs" for a card whose criteria are fully mapped

## Activity
### 2026-11-09T15:02:58.818Z - Usage Orchestrator chose Cursor Agent CLI
Stage: definition. Cursor Agent CLI reports 71% remaining, resetting 2026-11-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-09T15:02:59.526Z - Usage Orchestrator dispatch dispatch-mw9e4t6u-1 started
Card: card-mw8ii6eu-1 ("fix error: Missing or invalid verification inputs. Configure .mwnn/verification.json, with a check mapping for every acceptance criterion, before dispatch."). CLI: Cursor Agent CLI. Stage: definition.
Requested model: "auto" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the definition stage: auto.
AI loop stage thinking level rule for the definition stage "max" was not applied: Cursor Agent CLI does not accept a thinking level, so the AI loop stage thinking level rule for the definition stage "max" was not applied and the run used that CLI's default thinking level.

### 2026-11-09T15:03:02.916Z - Usage Orchestrator dispatch dispatch-mw9e4t6u-1 model observed
Card: card-mw8ii6eu-1. CLI: Cursor Agent CLI. Stage: definition.
Actual model: "Auto" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mw9e4t6u-1).

### 2026-11-09T15:04:30.759Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-sonnet-5.5`, thinking level `high`
- codex: model `gpt-6-luna`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`
- cursor-other: model `claude-opus-5-5-medium`

### 2026-11-09T15:05:53.930Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-11-09 - Claude Code
Preferred model `sonnet` could not be selected from inside this session; the work was done with Claude Opus 5.5 (`claude-opus-5-5`).
Created `.mwnn/verification.json` (version 1) mapping, by exact checkbox text, every criterion on this card, `card-mw89f8vw-1`, `card-mw8h6jsj-3`, and `card-mvnyy9c2-1` (the three cards that hit "Missing or invalid verification inputs"). Criteria that no automated check proves are `human: true` with empty `checks`: the CHANGELOG entry on `card-mw89f8vw-1` and the first three criteria on `card-mw8h6jsj-3` (they need `npm ci`/`npm pack` against the registry, a doc read, and a network review). Because of those, both cards still need human review before they can be accepted. `focusedTests` lists five compiled files under `dist-test/test/unit/`.
Added `test/unit/verificationProfile.test.ts`. It parses the repository profile, checks exact-text coverage of those cards, checks that the focused paths exist, and runs `createOutcomeEvidenceFactory` against the real profile to confirm that capture no longer fails with the missing-inputs error.
`npm run compile-tests`, focused test (4/4), `npm test` (1125/1125), `npm run lint`, `npm run compile`, and `git diff --check HEAD` passed.
STATUS: DONE
