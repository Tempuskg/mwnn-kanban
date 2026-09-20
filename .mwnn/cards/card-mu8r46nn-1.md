---
id: card-mu8r46nn-1
title: Add a workspace default preferred model with per-provider values
column: col-mqwk2njn-4
position: -28000
assignee: { kind: ai }
createdAt: 1789844354483
updatedAt: 1789865050277
dependsOn: [card-mtx4jeej-1]
---

## Description
Add a workspace-level default model so the user does not have to set a preferred
model on every card. Split out of `card-mtx4jeej-1`, which deliberately covers
only the per-card field.

The setting must be a per-provider map rather than a single string: model names
are provider-specific, so one shared default would be wrong for every CLI but
one, and the credit fallback in `card-mtx4l9l8-2` can change the active provider
mid-run. Follow the existing `mwnn-kanban.agentCliPaths` shape - an object keyed
by the provider ids in `AGENT_CLI_PROVIDER_IDS`, empty by default.

Each provider's value is a *list* of model names rather than one name, with the
first entry acting as that provider's default. One list serves two purposes and
keeps a single source of truth: this card's workspace default, and the
suggestion list behind the card UI's model picker in `card-mu8wia90-2`. The CLIs
cannot be asked which models they accept - `copilot`, `codex`, and `claude` all
take `--model <name>` but none can enumerate models non-interactively - so this
curated setting is the only place a model list can come from.

This card establishes the resolution order that later model-selection work
builds on: the card's own `preferredModel`, then the workspace default for the
active provider, then the provider's own default with no model argument added.

## Acceptance criteria
- [x] A new `mwnn-kanban` setting holds model names keyed by agent CLI provider id, each value a list of names, is declared in `package.json` with per-provider descriptions, defaults to empty, and uses the same configuration scope as the other AI-loop settings.
- [x] The first entry in a provider's list is that provider's default model; the remaining entries are carried as known models for that provider and are not otherwise used by this card.
- [x] With no card model and no default configured, dispatch behavior and CLI arguments are unchanged from before this card.
- [x] With a default configured for the active provider and no card model, that model is used for `Run Card with AI` and all four AI-loop stages.
- [x] A card's own `preferredModel` always wins over the workspace default; the default is not written back into the card file.
- [x] A default configured only for other providers is ignored for the active provider, which falls through to its own default model.
- [x] When the credit fallback switches providers mid-run, the replacement provider's own default entry is used rather than the exhausted provider's, and the applied model is recorded with the switch.
- [x] The resolution order is implemented in one place with no `vscode` import so it is unit-testable, and the settings value is validated: non-array values, non-string entries, blank entries, duplicate entries, empty lists, and unknown-provider keys are all ignored without throwing.
- [x] The validated per-provider model list is exposed from that same module so the card UI picker in `card-mu8wia90-2` can consume it without re-reading or re-validating configuration.
- [x] Automated `node:test` coverage over `dist-test/` covers each resolution branch: card model only, default only, both, neither, unknown provider key, blank entry, empty list, non-array value, and the fallback-provider case.
- [x] `npm run compile-tests`, `npm test`, `npm run compile`, and `npm run lint` pass, and the new setting appears with its description in the Development Host settings UI.

## Activity
### 2026-09-19T21:10:00.000Z - Scope amended by Claude Code
Widened the setting from one default model per provider to a list of model names
per provider, first entry being the default. The trigger was a question about
offering the model as a dropdown instead of free text: the CLIs cannot enumerate
their own models (verified against the installed `copilot`, `codex`, and
`claude` - all accept `--model <name>`, none lists models non-interactively), so
a picker needs a curated list, and that list belongs in this setting rather than
in a second one that could disagree with it.

Added acceptance criteria for the list shape, first-entry-is-default, the extra
validation cases a list brings, and exposing the validated list for the picker
in `card-mu8wia90-2`. The resolution order this card establishes is unchanged.
No implementation was done.

### 2026-09-19T23:02:34.045Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-09-19T23:55:00.000Z - Implemented by Claude Code
Added the workspace default model, keyed by agent CLI provider, as a list per
provider whose first entry is that provider's default.

- `src/agentCliProviders.ts` (new): the provider id list and its type guard,
  split out of `agentCliHandoff` so the model module can depend on provider
  identity without a circular import. `agentCliHandoff` re-exports them, so no
  existing import site changed.
- `src/agentCliModels.ts` (new, no `vscode` import): validates the raw setting
  (`readAgentCliModelCatalog`) and owns the single resolution order - card
  `preferredModel`, then the active provider's first configured entry, then
  nothing and no model argument. Non-object values, unknown provider keys,
  non-array values, non-string entries, blanks, duplicates, and empty lists are
  all dropped without throwing. `agentCliModelsFor` exposes each provider's
  whole validated list for the picker in `card-mu8wia90-2`.
- `src/agentCliHandoff.ts`: the handoff takes an optional `modelCatalog` and
  resolves the model per dispatch against the provider running that attempt;
  selections now carry their source, so Activity, failure messages, and model
  rejections name the card or the workspace setting correctly.
- `src/agentCliFallback.ts`: forwards the catalog, and a switch record carries
  the replacement provider's own resolved model, which the switch Activity entry
  now states.
- `src/runWithAi.ts` and `src/extension.ts`: `Run Card with AI` and the loop
  both read `mwnn-kanban.agentCliModels` through the validator.
- `package.json`: the setting declared with per-provider descriptions, an empty
  default, and `resource` scope, matching the other AI-loop settings.
- Docs: README settings table and AI contract, CHANGELOG, `AGENTS.md`, the three
  card-authoring skill copies, and the board-folder README text in
  `src/boardStore.ts` now describe the workspace default.

Coverage: `test/unit/agentCliModels.test.ts` (16 tests) covers card only,
default only, both, neither, unknown provider key, blank entry, empty list,
non-array and non-object values, duplicates, the other-provider case, all four
loop stages, and the fallback-provider case with and without a configured
replacement default; one test in `test/unit/runWithAi.test.ts` covers
`Run Card with AI`. `scripts/smoke-workspace-model-default.cjs`
(`npm run smoke:workspace-model`) exercises the real board store and handoff
over a temp workspace and asserts the settings declaration.

Validated: `npm run compile-tests`, `npm test` (411 pass, 0 fail),
`npm run compile`, `npm run lint`, `npm run smoke:workspace-model`, and
`npm run smoke:card-model` all pass.

Not done: the Development Host half of the last criterion. Confirming the new
setting renders with its description in the settings UI needs a person at the
editor; the scriptable half of that check asserts the contribution's type,
empty default, scope parity with the other AI-loop settings, and a description
for every provider.

STATUS: BLOCKED: the final criterion needs a human to open the Extension Development Host and confirm mwnn-kanban.agentCliModels appears with its description in the settings UI; every other criterion is implemented and verified.

### 2026-09-20T00:20:00.000Z - Development Host check confirmed
User ran the Extension Development Host and confirmed `mwnn-kanban.agentCliModels`
renders in the settings UI as "Mwnn-kanban: Agent Cli Models" with its full
description. That closes the last criterion, which is now checked; every
criterion on this card is met.

Observed in the same screenshot: because each provider's value is a list, the
settings UI shows an empty Item/Value table with an "Edit in settings.json"
link rather than inline editing. That is how VS Code renders object settings
whose values are not simple scalars, and it is expected for this shape - the
in-board model picker in `card-mu8wia90-2` is the editing surface that consumes
this list.

Also swept one stale copy missed earlier: the card-authoring skill text embedded
in `AGENTS.md` still said an omitted `preferredModel` uses the provider default,
and now names the workspace default first, matching the three installed skill
copies and the board-folder README text.

STATUS: DONE
