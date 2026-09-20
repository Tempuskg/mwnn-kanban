---
id: card-mu8r46nn-2
title: Add per-stage preferred model rules for the AI loop
column: col-mqwk2njn-4
position: -29000
assignee: { kind: ai }
createdAt: 1789844354483
updatedAt: 1789870622466
dependsOn: [card-mtx4jeej-1, card-mu8r46nn-1]
---

## Description
Let the user pick a different model per AI-loop stage, so cheap stages do not
pay for an expensive model. The loop's four stages differ a lot in difficulty:
definition and triage are short reasoning tasks, while implementation and
verification touch the workspace. Split out of `card-mtx4jeej-1`.

Key the rules on the existing `AgentCliHandoffKind` values (`definition`,
`triage`, `implementation`, `verification`) rather than on column ids or titles:
stage is what the loop already dispatches on, and column titles are
user-editable. A card's own `preferredModel` still wins, since a card-level
choice is the more specific intent.

Slots into the resolution order from `card-mu8r46nn-1` as a new layer: card
model, then stage rule, then workspace default, then provider default.

## Acceptance criteria
- [x] A new `mwnn-kanban` setting maps AI-loop stage to a model name, is declared in `package.json` with a description per stage, and defaults to empty so behavior is unchanged when unset.
- [x] Stage keys are the four existing handoff kinds; unknown keys and blank values are ignored without throwing, and no column id or column title appears in the setting.
- [x] Resolution order is card model, then stage rule, then workspace default, then provider default, with exactly one resolution site shared by every dispatch path.
- [x] Each of the four loop stages dispatches with its own configured model within a single loop run, and `Run Card with AI` uses the implementation stage rule.
- [x] A stage rule naming a model the active provider does not accept is surfaced the same way a rejected card model is, and is not misclassified as credit exhaustion.
- [x] Automated `node:test` coverage over `dist-test/` covers each stage, an unset stage falling through to the lower layers, a card model overriding a stage rule, and invalid stage keys and values.
- [x] `npm run compile-tests`, `npm test`, `npm run compile`, and `npm run lint` pass.

## Activity
### 2026-09-20T00:45:28.182Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-09-20T00:56:26.000Z - Implemented per-stage model rules
Added `mwnn-kanban.agentCliStageModels`: a model name per AI-loop stage, empty by
default. Stage ids moved to `src/agentCliStages.ts` (mirroring `agentCliProviders`)
so the settings reader can key on them without importing the spawn machinery;
`agentCliHandoff` re-exports them, so no import site changed. `agentCliModels` now
validates the setting (`readAgentCliStageModels`) and `resolveAgentCliModel` - still
the single resolution site, and the only producer of the model-source union - layers
card model, then stage rule, then workspace default, then provider default.

The stage reaches that site as the handoff's own `kind`, so every dispatch path is
covered by one change: each of the loop's four stages, the credit fallback's
replacement CLI (which re-resolves for the stage it is retrying), and `Run Card with
AI` (implementation for a run, definition for a definition fill). A stage rule the
CLI refuses goes down the existing model-rejection path - never classified as credit
exhaustion - and the message names the stage key in the new setting rather than the
card.

Changed files: `src/agentCliStages.ts` (new), `src/agentCliModels.ts`,
`src/agentCliHandoff.ts`, `src/agentCliFallback.ts`, `src/runWithAi.ts`,
`src/extension.ts`, `src/boardStore.ts`, `package.json`, `CHANGELOG.md`,
`test/unit/agentCliStageModels.test.ts` (new), plus the stale resolution-order
sentence in `README.md`, `AGENTS.md`, and the three installed card-authoring skill
copies.

Validation: `npm run compile-tests`, `npm test` (432 pass, 0 fail; 21 new tests over
6 suites), `npm run compile`, and `npm run lint` all pass. New coverage: settings
validation (unknown keys including a column id and a column title, blank and
control-character values, non-object settings), the manifest declaration, resolution
order including a card model overriding a stage rule and an unset stage falling
through, all four stages dispatching on their own model in one run, the same through
the fallback runner the loop actually uses, a replacement CLI keeping the interrupted
stage's rule, refusal classification, and both `Run Card with AI` kinds.

STATUS: DONE
