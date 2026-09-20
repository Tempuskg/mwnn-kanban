---
id: card-mu8wia90-2
title: Pick a card's model from a provider-scoped dropdown
column: col-mqwk2njn-4
position: -33000
assignee: { kind: ai }
createdAt: 1789853410404
updatedAt: 1789922500330
dependsOn: [card-mu8wia90-1, card-mu8r46nn-1]
---

## Description
Let the user choose a card's model from a list instead of typing it. Today the
card UI from `card-mtx4jeej-1` is a bare text input, so the user has to remember
each CLI's exact model spelling and a typo only surfaces when the dispatch
fails.

The list cannot be discovered from the CLIs. Checked against the installed
`copilot`, `codex`, and `claude` CLIs: all three accept `--model <name>`, but
none exposes a non-interactive way to enumerate the models it accepts. Copilot's
and Claude's `/model` exists only inside an interactive session, and Copilot's
`providers`/`models` help entries are help topics, not a queryable list. So the
suggestions have to come from a curated list, and `card-mu8r46nn-1` already owns
that per-provider list.

Use a combo box, not a closed dropdown: an `<input>` with a `<datalist>` gives
the pick-from-a-list affordance while still accepting a name that is not in the
list. That matters because it preserves the pass-through contract from
`card-mtx4jeej-1` - a model released after the last extension release, or a BYOK
model name, must still be usable without an extension update. A closed `<select>`
would turn the field into an enum and reintroduce exactly the staleness problem
that card ruled out.

With per-provider models on the card from `card-mu8wia90-1`, the UI is "pick the
provider, then pick the model": the provider selector chooses which entry of the
card's map is being edited, and the suggestion list narrows to that provider's
models. The card can still carry entries for several providers.

The webview has no Node or `vscode` access, so the suggestion list has to reach
it over the existing message protocol in `src/types.ts` with the rest of the
board state rather than being read from settings in the webview.

Out of scope: probing a CLI at runtime to discover models. If a CLI later ships
a non-interactive list command, feeding the same datalist from it is a separate
card; the curated setting stays as the override and the fallback.

## Acceptance criteria
- [x] The card details UI offers the model as a combo box: a text input backed by a suggestion list, where a value typed by hand that is not in the list is still accepted and saved unchanged.
- [x] The user picks the provider first, and the suggestion list shows only that provider's configured models; switching provider switches which of the card's per-provider entries is being edited and shown.
- [x] A provider with no configured models still shows an editable field with no suggestions, and the unset state still reads clearly as "uses the provider default".
- [x] Clearing the field removes that provider's entry from the card file, and the entries for other providers are left untouched.
- [x] The suggestion list reaches the webview over the shared message protocol declared in `src/types.ts`, with no `any`-typed crossing of the boundary and no attempt to read configuration from the webview.
- [x] Editing the configured model list in settings is reflected in an already-open board without reloading the window.
- [x] The suggestion list is presentation only: it never validates, rewrites, or rejects the saved value, and a card whose stored model is absent from the list still displays and dispatches that stored value.
- [x] Automated `node:test` coverage over `dist-test/` covers the protocol message carrying the per-provider suggestion list, the mapping from configured settings to per-provider suggestions, an unconfigured provider, and that an off-list value survives a save.
- [x] `npm run compile-tests`, `npm test`, `npm run compile`, and `npm run lint` all pass, and a Development Host smoke test confirms picking a model from the list, typing an off-list model, and clearing the field all persist correctly to the card file.

## Activity
### 2026-09-20T13:42:07.534Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-09-20 Claude Code: model picker is a provider-scoped combo box

Replaced the four always-visible model text fields with "pick the CLI, then
pick the model".

- Webview (`media/board.js`, `media/board.css`): a provider `<select>` beside
  one `<input>` backed by a `<datalist>`. Switching provider swaps which of the
  card's per-provider entries is shown and edited, and re-fills the datalist
  from that provider's list. The selector's option labels carry the model each
  other CLI is set to, since only one entry is visible at a time. The card
  opens on a provider it already names, so an existing model is visible
  immediately. A combo box rather than a `<select>`: the suggestions are a
  curated setting, not the set of valid names, so typing always wins and an
  off-list name is saved byte-for-byte.
- Drafts: `createPreferredModelDrafts` holds all four entries while the modal
  is open, so switching provider cannot lose an edit, and `changes(card)` is
  the single answer to what the user altered - the unsaved-changes check and
  the save path share it, so an untouched provider is never posted and never
  rewritten on the card file. Clearing a field posts `setPreferredModel` with
  no model, which removes only that provider's key.
- Protocol (`src/types.ts`): the `state` message now carries
  `modelSuggestions: AgentCliModelSuggestions`, a per-provider list declared
  beside the other message shapes. The webview reads only that field; it never
  reads configuration, and nothing crosses the boundary as `any`.
- Host: `agentCliModelSuggestions()` in `src/agentCliModels.ts` maps the
  validated catalog to the protocol shape - a named seam, because the same
  values serve two different purposes (first entry = dispatch default, whole
  list = suggestions). `BoardPanel.postState` re-reads and re-validates
  `mwnn-kanban.agentCliModels` on every push, and a new
  `onDidChangeConfiguration` listener in `src/extension.ts` re-pushes state
  when `agentCliModels` or `enableRunWithAI` changes, so an edited list reaches
  an open board without a window reload.
- Presentation only: nothing validates, rewrites, or rejects a value against
  the list. A stored model absent from the list still displays, still saves,
  and still wins at dispatch (`resolveAgentCliModel` returns it with source
  `card`), and a provider with nothing configured gets an editable field with
  no suggestions plus help text saying blank means that CLI's own default.
- Tests: `test/unit/cardModelSuggestions.test.ts` covers the settings-to-
  suggestions mapping, an unconfigured provider, the `state` message carrying
  the list, an off-list value surviving a save, a stored off-list value
  displaying unchanged, and clearing one provider leaving the others intact.
- Smoke: new `scripts/smoke-card-model-picker.cjs` (`npm run
  smoke:card-model-picker`) drives the webview helpers against the real store
  on a real temp workspace through the same protocol messages: picking from the
  list, typing an off-list name, saving for a provider with no suggestions, and
  clearing - all asserted against the card file on disk.
- Docs: `CHANGELOG.md` and `README.md` describe the picker on the existing,
  still-unreleased card-model entries rather than adding a "Changed" note for a
  feature that has never shipped.

Validation run: `npm run compile-tests`, `npm test` (486 pass, 0 fail),
`npm run compile`, `npm run lint` all pass; `node
scripts/smoke-card-model-picker.cjs`, `node scripts/smoke-card-model.cjs`,
`node scripts/smoke-workspace-model-default.cjs` and `node
scripts/smoke-cli-fallback.cjs` all pass.

Outstanding, and the reason this is not DONE: the two criteria that can only be
confirmed by a human running the Development Host are unchecked. Someone needs
to open a board and check (a) the combo box renders and behaves - the list
drops down for a configured CLI, a typed off-list name and a cleared field both
persist to the card file, and the layout holds at narrow docked width - and
(b) editing `mwnn-kanban.agentCliModels` in settings updates the open board's
suggestions with no window reload. This session is non-interactive and cannot
launch the Development Host; everything scriptable about those behaviors is
covered by the smoke script above.

STATUS: BLOCKED: Development Host smoke test (combo box behavior and live
settings refresh) needs a human; all code, tests, and scriptable checks are
complete and passing.

### 2026-09-20 Claude Code: Development Host check done; datalist replaced

Ran the Development Host with a human driving it, against a seeded throwaway
workspace (two cards, `agentCliModels` configured for Copilot/Codex/Claude Code
and deliberately unconfigured for Cursor). This supersedes the BLOCKED status in
the entry above.

The check found a real defect in the first implementation. The `<datalist>` was
the wrong affordance: the browser filters its options against whatever is
already in the input, so the very card most likely to be edited - one that
already names a model - opened an empty popup and could not browse the list at
all. It was replaced with a menu the board draws itself, reusing the existing
anchored `assign-picker` markup and styling:

- A `▾` button beside the field opens the whole configured list for the selected
  CLI whatever the field holds; ArrowDown in the field opens it too. The menu
  narrows only on text typed *after* it opens (filtering on the pre-existing
  value was the same trap, and was fixed after the first Dev Host round).
- The current value carries a checkmark, and the menu ends with "Use <CLI>'s
  default", so clearing is a visible choice rather than select-all-and-delete.
- For a CLI with no configured models the button is disabled and the field stays
  editable, which is the unset state the card asks for.
- The field is unchanged in substance: free-form text, saved exactly as typed.

Confirmed in the Development Host, each against the card file on disk:
- Picked `gpt-5-codex` from the Codex list -> `preferredModel.codex:
  gpt-5-codex`.
- Set Claude Code to `claude-opus-5` from its list while Codex kept its own
  value -> switching provider edits a different entry, not the same one.
- Cleared Codex from the menu -> only `preferredModel.codex` disappeared;
  `preferredModel.claude-code` survived untouched, and the second card on the
  board never gained a key.
- Typed an off-list name on Cursor, the CLI with no configured models: the `▾`
  button was greyed out, the field was still editable, and the name persisted
  verbatim.
- Added `gpt-5-mini` to the `codex` list in workspace settings with the board
  open: it appeared in the menu with no window reload.

Final validation: `npm run compile-tests`, `npm test` (486 pass, 0 fail),
`npm run compile`, `npm run lint`, plus `node
scripts/smoke-card-model-picker.cjs` and `node scripts/smoke-card-model.cjs`
all pass. The webview type-check (`tsc --checkJs` over `media/board.js`) reports
only the three pre-existing errors it reported before this card.

STATUS: DONE
