---
id: card-mua1psyq-1
title: ADD thinking level to model selection
column: col-mqwk2njn-4
position: -34000
assignee: { kind: ai }
createdAt: 1789922625506
updatedAt: 1790426740606
---

## Description
Model selection currently answers only "which model", never "how hard should it
think". Add a *thinking level* (reasoning effort) as a second, independent axis
of the same selection, so a dispatch can pair a model with an effort level
without the user hand-encoding it into the model name.

The level resolves through the existing layered policy in `src/agentCliModels.ts`
rather than a parallel one: an AI-loop escalation value, else the card's
per-provider level, else the AI loop stage rule, else the workspace per-provider
default, else nothing (the CLI runs at its own default effort, argv unchanged).
Like the model, the level is scoped per provider — the CLI is chosen at dispatch
and the credit fallback can swap it mid-run — and it is never validated against a
list of names.

Surfaces to extend:

- Card file contract: `thinkingLevel.<provider>` frontmatter keys, parsed and
  serialized in `src/serialization.ts`, typed in `src/types.ts` alongside
  `preferredModels`, with the same scalar-quoting and blank-value-is-ignored rules.
- Settings: per-provider workspace defaults and per-stage rules, mirroring
  `mwnn-kanban.agentCliModels` and `mwnn-kanban.agentCliStageModels`.
- Argument building: each provider spells reasoning effort differently and some
  do not accept it at all, so `src/agentCliHandoff.ts` needs a per-provider
  thinking spec beside the existing `model` spec. A provider without one reports
  `applied: false` with a reason and runs anyway, exactly as an unsupported model
  does today — the run must never fail solely because a level could not be applied.
- Card editor UI: a level control per provider in `media/board.js`, next to the
  existing model input, sharing the same draft/change plumbing.
- Docs: the card contract in `AGENTS.md` and the MWNN Card Authoring skill.

Out of scope: changing how models themselves resolve, and adding thinking level
to the escalation ladder's *configuration* format beyond what resolution needs.

## Acceptance criteria
- [x] `src/types.ts` declares a per-provider thinking-level shape beside `preferredModels`, with a type guard, and the board message protocol carries it on both the extension-host and webview sides.
- [x] `src/serialization.ts` reads and writes `thinkingLevel.<provider>` frontmatter for the four provider ids, ignoring unknown provider keys and blank/whitespace-only values, and omitting the key entirely when unset.
- [x] Round-tripping a card with thinking levels through parse → serialize preserves every level, and a card with none serializes byte-identically to today.
- [x] `src/agentCliModels.ts` resolves a thinking level through the same layered order as the model (escalation → card → stage rule → workspace default → none) and reports which layer supplied it.
- [x] Two new settings are contributed in `package.json` — a per-provider workspace default and a per-stage rule map — validated by readers that degrade malformed input to "not configured" without throwing.
- [x] `src/agentCliHandoff.ts` turns a resolved level into that provider's own CLI arguments via a per-provider spec, splicing them as separate argv entries (never interpolated into a command string) at the correct index for each provider's fixed args.
- [x] A provider with no thinking-level support yields `applied: false` with a user-facing reason and still dispatches on the CLI's default effort; the run does not fail.
- [x] With no card level, no stage rule, and no workspace default configured, the spawned argv for every provider is byte-identical to the current behavior.
- [x] The card editor in `media/board.js` shows a thinking-level control per provider beside the model input, and editing it persists to the card file through the existing change-detection path.
- [x] Unit tests cover: resolution precedence across all layers, per-provider argument shaping, the unsupported-provider path, settings validation of malformed input, and serialization round-trip.
- [x] `AGENTS.md` and `media/skills/mwnn-card-authoring.md` document the `thinkingLevel.<provider>` key, its per-provider scoping, and its fallback order.
- [x] `npm run compile-tests`, `npm run compile`, the focused new tests, `npm test`, and `npm run lint` all pass.

## Activity
### 2026-09-20T16:44:19.692Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-09-20T17:04:28.302Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-09-20 Claude Code: implemented thinking level as a second selection axis
Added `thinkingLevel.<provider>` end to end, mirroring the model axis rather than
running beside it.

- `src/types.ts`: `CardThinkingLevels` beside `preferredModels`, the
  `isCardThinkingLevels` guard, `Card.thinkingLevels` in `isCard`, and the
  `setThinkingLevel` webview→host message with its guard. `media/board.js`
  mirrors the card shape and posts that message.
- `src/utils.ts`: `normalizeThinkingLevel`, `normalizeCardThinkingLevels`,
  `cardThinkingLevelFor`, `setThinkingLevel`, and the field carried through
  `cloneCard`. `src/boardStore.ts` carries it through its own card sanitizer
  too - the clone that would otherwise have dropped it silently on reload.
- `src/serialization.ts`: `thinkingLevel.<provider>` parsed and serialized for
  the four provider ids under the existing scalar-quoting rule. Unknown
  provider keys and blank/whitespace-only values are ignored, and a card with
  no levels writes no key, so it serializes byte-identically to before.
- `src/agentCliModels.ts`: `resolveAgentCliThinkingLevel` with the same layered
  order as the model (escalation → card → stage rule → workspace default →
  none), reporting its source, plus the two validating settings readers.
- `package.json`: `mwnn-kanban.agentCliThinkingLevels` (per-provider default)
  and `mwnn-kanban.agentCliStageThinkingLevels` (per-stage rule), read in
  `src/extension.ts` and threaded through `runWithAi` and `agentCliFallback`.
- `src/agentCliHandoff.ts`: a per-provider `thinking` spec beside `model`,
  spliced as separate argv entries at the provider's own index. Codex is the
  only CLI that currently spells reasoning effort on its command line
  (`-c model_reasoning_effort=<level>`, after `exec` and before the stdin `-`);
  Copilot, Claude Code, and Cursor publish no such argument, so they carry no
  spec, report `applied: false` with a user-facing reason, and still dispatch
  on the CLI's default effort. Adding a spec later is a one-line change.
- `media/board.js` / `media/board.css`: a thinking-level field beside the model
  combo box in the same control, sharing the provider selector, the drafts, and
  the change-detection path, so only the field actually edited is posted.
- Docs: `AGENTS.md` (board contract and its embedded skill copy),
  `media/skills/mwnn-card-authoring.md`, the generated `.mwnn/README.md`
  contract in `src/boardStore.ts`, and a `CHANGELOG.md` entry.

Tests: new `test/unit/cardThinkingLevel.test.ts` (33 tests) covering resolution
precedence across all layers, per-provider argument shaping, the
unsupported-provider path, settings validation of malformed input, and the
serialization round-trip including the byte-identical no-level case; plus a
store round-trip test in `test/unit/boardStore.test.ts` and webview draft tests
in `test/unit/cardModelSuggestions.test.ts`.

Validation: `npm run compile-tests`, `npm run compile`, the focused new tests,
`npm test` (523 passing), and `npm run lint` all pass. Not run: the Extension
Development Host smoke test of the new card-editor field, which needs an
interactive VS Code window this session does not have. Its persistence path is
covered by tests at every link (drafts → change detection → message guard →
store → card file); only the visual rendering is unconfirmed.

STATUS: DONE
