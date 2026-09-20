---
id: card-mu8wia90-1
title: Scope a card's preferred model to the provider it runs on
column: col-mqwk2njn-4
position: -32000
assignee: { kind: ai }
createdAt: 1789853410404
updatedAt: 1789911705815
dependsOn: [card-mtx4jeej-1]
---

## Description
Make a card's preferred model provider-aware. `card-mtx4jeej-1` shipped a single
free-form `preferredModel` scalar, but a card never chooses its own provider:
the CLI is picked per dispatch by the `Run Card with AI` picker or
`mwnn-kanban.aiLoopProvider`, and the credit fallback in `card-mtx4l9l8-2` can
change it again mid-run. So one scalar is a name that is only valid for one of
the four CLIs.

Today a card reading `preferredModel: claude-opus-5` that is dispatched to Codex
produces `codex exec --model claude-opus-5 ...`, Codex refuses the name, and the
existing rejection path fails the dispatch naming the value and provider. That
is safe and well reported, but it is a dead end the user has to resolve by hand,
and it defeats the point of the field the moment the active provider is not the
one the author had in mind.

Replace the scalar with a per-provider map on the card, so the model that
reaches each CLI is one that CLI understands, and a provider the card says
nothing about simply uses its own default. This also improves the credit
fallback: the replacement provider picks up its own entry instead of inheriting
a name from the exhausted provider that it will reject.

Decide and document the frontmatter shape as part of this card - the card file
is the board's public integration surface. A map keyed by the provider ids in
`AGENT_CLI_PROVIDER_IDS` is the expected direction, but the exact serialization
(nested block, inline object like `assignee`, or repeated scalar keys) must stay
readable and parseable by the existing hand-rolled frontmatter parser, which is
line-based and has no nested-structure support today.

Existing cards must keep working. A card written with the old scalar
`preferredModel` predates provider scoping, so define and implement one explicit
rule for it rather than silently dropping it.

Coordination: `card-mu8r46nn-1` adds a workspace default model per provider and
defines the resolution order `card model -> workspace default -> provider
default`. These two cards touch the same resolution point. Whichever lands
second must reconcile with the other rather than replace it; the order itself
does not change.

Out of scope: pinning a provider on the card. A card-level provider would
override the loop's own provider selection and fight the credit fallback, which
is why the model is scoped per provider instead.

## Acceptance criteria
- [x] The card model in `src/types.ts` carries a preferred model per agent CLI provider, keyed by the ids in `AGENT_CLI_PROVIDER_IDS`, accepted by the card type guard, with unknown provider keys and blank values rejected or ignored rather than stored.
- [x] The frontmatter shape is documented and round-trips through `serializeCard`/`parseCard`: a card with entries for one, several, and all providers, and a card with none, all survive a parse and serialize cycle unchanged.
- [x] A card with no model entries at all writes no key for them, and an entry that is blank, whitespace-only, or otherwise unusable is treated as absent without making the card file unreadable on reload.
- [x] An existing card using the old scalar `preferredModel` keeps working under one documented, implemented rule (for example: applied to every provider, or migrated on first write); the rule is stated in the card-file contract and covered by a test.
- [x] Dispatch resolves the model for the provider actually running: `Run Card with AI` and all four AI-loop stages pass the entry for the active provider, and add no model argument when that provider has no entry.
- [x] When the credit fallback switches providers mid-run, the replacement provider uses its own entry, or runs on its default model when the card names none for it; the exhausted provider's model is never passed to the replacement.
- [x] A chat hand-off states only the model relevant to that hand-off rather than the whole per-provider map, and a card with no entries leaves the prompt unchanged.
- [x] The card-file contract documents the new shape in `AGENTS.md`, `media/skills/mwnn-card-authoring.md`, and the board folder `README.md` written by the extension, including the quoting rule and how the old scalar is handled.
- [x] Automated `node:test` coverage over `dist-test/` covers: the per-provider round-trip, the empty and blank cases, the type guard, the old-scalar rule, per-provider argument selection at dispatch, the no-entry-for-this-provider case, and the credit-fallback switch.
- [x] `npm run compile-tests`, `npm test`, `npm run compile`, and `npm run lint` all pass, and a Development Host smoke test confirms a card with per-provider models dispatches on the right model for each provider.

## Activity
### 2026-09-20T12:08:25.566Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-09-20 Claude Code: scoped the card's preferred model per provider

Replaced the single `preferredModel` scalar with a per-provider map.

- Frontmatter shape: one scalar line per provider, `preferredModel.<provider>`
  (`copilot`, `codex`, `claude-code`, `cursor`). Chosen over a nested block or
  an inline object because the frontmatter parser is line-based with no nested
  support: a flat repeated key needs no new parsing machinery, keeps each value
  independently quotable under the one existing scalar rule, diffs cleanly when
  one CLI's model changes, and is still valid YAML for other readers. Decision
  and reasoning are recorded in `src/serialization.ts`.
- Model: `preferredModels?: CardPreferredModels` on `Card` in `src/types.ts`,
  keyed by `AGENT_CLI_PROVIDER_IDS`. The type guard `isCardPreferredModels`
  rejects unknown provider keys, blank values, non-strings, and empty maps, so
  nothing unusable reaches board state; the parser and `setPreferredModel` drop
  the same things instead, so a hand-edited card file stays readable.
- Legacy rule: a bare `preferredModel` scalar is read as the card's model for
  every provider that has no scoped key of its own, so an existing card
  dispatches exactly as before. Nothing writes the bare key again, so the next
  save migrates the file to the scoped keys. Documented in the contract and
  covered by tests plus the smoke script.
- Dispatch: `cardPreferredModelFor(card, provider)` in `src/utils.ts` is the
  single read point. `runAgentCliCardHandoff` resolves against
  `handoff.target.provider`, which covers `Run Card with AI` and all four loop
  stages; `agentCliFallback` resolves against `replacement.provider`, so the
  exhausted CLI's model is never handed to its replacement.
- Chat hand-offs pass only the entry for the chat target's provider, so the
  other CLIs' names stay out of a prompt that could not act on them, and a card
  with no entry for that provider leaves the prompt byte-identical.
- Webview: the card modal now shows one model field per CLI
  (`media/board.js`, `media/board.css`); `setPreferredModel` carries a
  `provider`, and only the fields that changed are posted.
- Docs: `AGENTS.md` (board contract and managed skills block),
  `media/skills/mwnn-card-authoring.md` and its installed Copilot/Claude
  copies, the board-folder `README.md` written by `boardStore`, `README.md`,
  `package.json` setting descriptions, and `CHANGELOG.md`.
- Tests: `test/unit/cardPreferredModel.test.ts` rewritten for the new shape -
  per-provider round-trip (one/several/all/none) with byte-stable re-serialize,
  empty and blank maps, blank and unknown scoped keys, the type guard, the
  legacy scalar rule plus its migration on write, per-provider argument
  selection, the no-entry-for-this-provider dispatch, and two credit-fallback
  cases (replacement uses its own entry; replacement with no entry runs its own
  default). Sibling suites updated for the new `setPreferredModel` signature.

Validation: `npm run compile-tests`, `npm test` (480 passing, 0 failing),
`npm run compile`, and `npm run lint` all pass. The scriptable Development Host
check `node scripts/smoke-card-model.cjs` passes and prints the argv each CLI
received, confirming each provider runs on its own entry, that a provider the
card skips gets no model argument, that clearing one key leaves the others
intact, and that a legacy bare scalar still dispatches everywhere and migrates
on the next write; `node scripts/smoke-workspace-model-default.cjs` and
`node scripts/smoke-cli-fallback.cjs` also pass.

The visual half of the Development Host check is also confirmed: a human ran
the extension and verified the card modal renders one labelled model field per
CLI (GitHub Copilot, OpenAI Codex, Anthropic Claude Code, Cursor Agent) with
the all-blank help text, and the narrow docked width, where the fields stack to
one column per CLI with no horizontal overflow.

Two follow-ups from that review, both in the webview only:
- The placeholder and help text now read "this CLI's default" rather than
  "this CLI default"; the missing apostrophe was an artifact of how the edit
  was applied, not a wording choice.
- At the narrow breakpoint the stacked gaps were inverted - 8px between a label
  and its own input against 6px between rows - so each label grouped with the
  field above it. The breakpoint now uses 4px inside a row and 12px between
  rows (`media/board.css`); the wide two-column layout is unchanged.

Both follow-ups were then re-checked in the Development Host at narrow width:
the placeholders read "Uses this CLI's default", and each label groups with the
input below it. No further webview changes outstanding.

STATUS: DONE
