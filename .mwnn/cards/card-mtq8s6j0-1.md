---
id: card-mtq8s6j0-1
title: When defining a card with AI have the AI breakup into multiple cards if warranted
column: col-mqwk2njn-4
position: -48000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-4.6
preferredModel.codex: gpt-5.5
preferredModel.claude-code: sonnet
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1788725170188
updatedAt: 1791153852288
---

## Description
Extend the AI card-definition prompt/handoff (all definition paths: vscode.lm and agent-CLI file-mediated handoff) so that when a card's title/context covers more than one independently deliverable slice, the AI splits it into multiple cards instead of writing one oversized definition. The original card keeps the first slice (its id, column, and position stay put) and gets its Description/Acceptance criteria narrowed to that slice; each additional slice becomes a new well-formed card file in the same column, positioned right after the original, following the MWNN Card Authoring contract. Real prerequisites between the slices are expressed with `dependsOn`. Cards that are already a single coherent slice are defined in place exactly as today.

## Acceptance criteria
- [x] The definition prompt instructs the AI to judge whether the card warrants splitting, and to split only into genuinely independent deliverables (not sequential steps of one change).
- [x] When split, the original card file keeps its id, frontmatter, run-settings keys, and existing Activity, and its Description/Acceptance criteria cover only its own slice.
- [x] Each new card has a unique `card-<base36>-<n>` id matching its filename, a valid column id (same as the original), ascending positions after the original without renumbering existing cards, non-empty Description and Acceptance criteria, and an empty Activity.
- [x] New cards carry `dependsOn` only for real prerequisites; no self-dependencies or cycles are produced.
- [x] The original card's Activity gets a dated entry listing the ids of the cards split from it.
- [x] Completion detection for the definition handoff still succeeds when extra cards were created, and the board reloads to show them.
- [x] A card that does not warrant splitting is defined in place with no new cards created.
- [x] Unit tests cover the prompt text including the split guidance; `npm run compile-tests` and `npm test` pass.
- [x] Development Host smoke test: defining a clearly multi-part card produces multiple valid cards on the board.

## Activity
### 2026-10-04T21:59:33.006Z - Anthropic Claude Code CLI definition handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
Workspace default model: default.
Workspace default thinking level: low.

### 2026-10-04T21:59:57.995Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-4.6`, thinking level `high`
- codex: model `gpt-5.5`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`

### 2026-10-04T22:06:05.139Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-04T22:40:00.000Z - Claude Code: split guidance added to card definition
Preferred model `sonnet` was not available to switch to in this session; the work was done with Claude Opus 5.5 (`claude-opus-5-5`).

- `src/aiCards.ts`: `buildCardDefinitionPrompt` now includes a "## Splitting into multiple cards" section (`buildSplitSection`). Every definition path (Run With AI CLI, chat hand-off incl. the file-mediated fallback, and the AI loop's CLI/chat gateways) builds its prompt through this function. The new section tells the agent to:
  - judge first, and split only into independent deliverables, never into sequential steps of one change; a single slice is defined in place with no new cards.
  - keep the first slice on the original card, with its id, title, column, position, frontmatter and Activity unchanged.
  - write each further slice as a new card beside it. The id is `card-<base36>-<n>` and matches the filename. The card uses the same column id and sits at a position between the original and the next card, without renumbering. It copies the assignee, has a non-empty Description and Acceptance criteria, and an empty Activity. When Jev picks run settings, the new card gets no run-settings keys; otherwise the agent uses the same run-settings rules.
  - add `dependsOn` only for real prerequisites, pointing back to the original or to earlier split cards only (so no self-dependencies or cycles), and leave the original's dependsOn alone.
  - append a dated "Split into multiple cards" Activity entry that lists the new ids.
- Completion detection is unchanged and still works. `validateCompletionEvidence('definition')` only checks that the original card is defined, and the board-folder watcher loads new card files the same way plan import does.
- `test/unit/aiCards.test.ts`: two new tests cover the split guidance and the Jev-mode run-settings variant.
- Validation: `npm run compile-tests` passed, `npm test` passed (579/579), `npm run compile` passed, `npm run lint` was clean.
- Not yet verified live: criteria 2-5 and 7 depend on what the agent does, and criterion 9 is the Development Host smoke test. I set up a scratch board to run Claude Code CLI on a clearly multi-part card and on a single-slice card, but the session sandbox denied that run. A human needs to run "Fill in with AI" on a multi-part card and on a single-slice card in the Development Host, check the resulting files, and then tick those boxes.
STATUS: BLOCKED: needs a human Development Host smoke test (define a clearly multi-part card and a single-slice card) to verify criteria 2-5, 7 and 9; the live agent run was denied by the session sandbox

### 2026-10-04T23:10:00.000Z - Claude Code: live CLI check of the split prompt
The user allowed a narrow headless run (`claude -p --model sonnet --permission-mode acceptEdits --allowedTools Read,Write,Edit,Glob,Grep`). I ran the real definition prompt (Jev mode) against a scratch board outside the repo, with one multi-part card at position 1000, an existing card at 2000, and a single-slice card at 3000. I then loaded every resulting file with the extension's own `parseCard` and `isCardDefined`.
- The multi-part card was split into 3 cards. The original `card-multi-1` kept its id, column, position, assignee, `preferredModel.codex` and its existing Activity entry. Its Description and Acceptance criteria now cover only CSV export, and it gained a dated "Split into multiple cards" entry naming `card-muue5kmz-1` and `card-muue5kmz-2`.
- The two new cards have ids that match their filenames, use the same column `col-b`, and sit at positions 1300 and 1600, between the original and the existing card, which stayed at 2000. Each has a filled Description and Acceptance criteria, an empty Activity, the copied assignee, and no run-settings keys. They have no `dependsOn`: the three slices are independent, so no self-dependencies or cycles.
- The single-slice card was defined in place, and no new cards were created.
- The real board was not touched (`git status` shows only the 3 intended files).
Criterion 9 is still open. A human needs to run "Fill in with AI" on a multi-part card in the Development Host and confirm the new cards appear on the board.
STATUS: BLOCKED: needs a human Development Host smoke test (criterion 9); everything else is implemented and verified

### 2026-10-04T22:35:58.000Z - Codex: remaining Development Host verification resumed
Only criterion 9 remains unmet. The current test sources and extension bundle rebuilt successfully with `npm run compile-tests` and `npm run compile`. Running the live definition flow in an isolated temporary workspace, then checking the resulting card files and board reload; no implementation is being repeated.

### 2026-10-04T22:42:02.000Z - Codex: Development Host smoke test passed
Ran the current development extension in the isolated workspace `C:\Users\darre\AppData\Local\Temp\mwnn-devhost-split-o3cmWe`, opened its board, and used the actual card-details "Fill in with AI" action with Anthropic Claude Code CLI (`sonnet`, workspace thinking level `low`). No project implementation was re-dispatched.

- The fixture "Add CSV board export, configurable keyboard shortcuts, and automatic archive cleanup" split into three independent slices. Original `card-muuei2cc-1` stayed in `col-smoke-backlog` at position 1000, kept its title, assignee, existing models, creation timestamp, and existing Activity, and now describes only CSV export.
- New cards `card-muuekhd0-1` (keyboard shortcuts, position 1333) and `card-muuekhd0-2` (archive cleanup, position 1667) have matching filenames/ids, the same valid column and assignee, non-empty Description and acceptance checklists, and empty Activity. Both ids appear in the original's dated split entry. The independent slices have no dependencies, and the entire fixture dependency graph is valid and acyclic.
- The neighbouring card stayed at 2000 with identical parsed metadata and content. Its only raw-file difference was a trailing blank line normalized by the extension's dispatch write before the agent's edits. The unrelated single-slice fixture stayed undefined at 3000; the earlier live CLI verification of the single-slice behavior remains applicable.
- The Development Host board automatically changed from 3 to 5 cards and displayed both new cards in the correct order. The host showed "Anthropic Claude Code CLI filled in ..." and its running indicator cleared. Final board state was confirmed through accessibility data and a screenshot.
- Validation passed: `npm run compile-tests`; `npm run compile`; `node --test dist-test/test/unit/aiCards.test.js` (16/16); `npm test` (579/579); `npm run lint`; `node 'C:\Users\darre\AppData\Local\Temp\mwnn-devhost-split-o3cmWe\verify-smoke.cjs'` (extension parser and card-contract assertions). Fixture and validation report are retained in that temporary workspace for inspection.
- Development Host launch: `code --new-window --disable-extensions --extensionDevelopmentPath 'E:\mwnn-kanban' 'C:\Users\darre\AppData\Local\Temp\mwnn-devhost-split-o3cmWe'`.

STATUS: DONE: criterion 9 passed; all acceptance criteria are checked and no verification remains for this card.
