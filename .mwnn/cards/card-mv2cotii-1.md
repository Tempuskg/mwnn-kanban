---
id: card-mv2cotii-1
title: Remove the AI guided interview checkbox and just have the start interview button if human is selected
column: col-mqwk2njn-4
position: -65000
assignee: { kind: human }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6.1-sol
preferredModel.claude-code: sonnet
preferredModel.cursor: Gemini 3.8 Flash
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1791634108266
updatedAt: 1791640379899
---

## Description
Today a Human card only offers **Start interview** after someone ticks an "AI-guided interview" checkbox in the card modal, which saves `interview: true` to the card. Remove that opt-in completely. Any Human-assigned card should offer Start interview directly, whenever the existing gates pass: Run With AI is enabled, the card is defined, and it is not in a done column.

Scope (removal of the flag, end to end):
- Webview (`media/board.js`, `media/board.css`): remove the checkbox, its help text and styles, `readInterview`, and the interview change detection in the save path. `isInterviewCard`/`canStartInterview` key off `assignee.kind === 'human'` only. Keep both entry points: the modal footer button and the card-tile icon button.
- Message protocol and host: remove the `setInterview` webview message, `BoardStore.setInterview`, and the `Card.interview` field in `src/types.ts`. Change `aiCards.ts` eligibility so it no longer requires the flag, and update its "not-interview" feedback text so it no longer mentions the checkbox.
- Serialization: stop writing `interview: true`. Tolerate a legacy `interview:` key on read by ignoring it, so it disappears on the card's next write. Drop the `interview` bullet from the board README contract in `boardStore.ts`.
- Update the unit tests that cover the flag (serialization, store, eligibility, interview run).

## Acceptance criteria
- [x] The card modal no longer shows an "AI-guided interview" checkbox or its help text for any assignee kind.
- [x] In the modal, a saved Human card that is defined and not in a done column shows the Start interview button whenever the assignee dropdown is set to Human and Run With AI is enabled. Switching the dropdown away from Human hides the button.
- [x] On the board, the card-tile Start interview icon appears for every defined, non-done Human card when Run With AI is enabled. It never appears on AI or unassigned cards.
- [x] The host eligibility check (`aiCards.ts`) accepts any defined, non-done Human card. It still rejects AI or unassigned cards with feedback text that does not mention a checkbox.
- [x] `Card.interview`, the `setInterview` webview message, and `BoardStore.setInterview` are removed. No source reference to them remains.
- [x] A card file that contains a legacy `interview: true` line loads without error. The line is dropped the next time the extension writes that card, and new writes never emit an `interview` key.
- [x] The board README contract written by `boardStore.ts` no longer documents the `interview` key.
- [x] Interview-related unit tests are updated, and `npm run compile-tests`, `npm run compile`, `npm test` and `npm run lint` pass.
- [x] Development Host smoke test: a Human card shows Start interview in the modal and on its tile with no checkbox, and clicking it opens the interview chat.

## Activity
### 2026-10-10T12:37:38.112Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-10T12:38:51.574Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-5.5`, thinking level `high`
- codex: model `gpt-6.1-sol`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`
- cursor: model `Gemini 3.8 Flash`

### 2026-10-10T13:09:33.865Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.
- 2026-10-10 Claude Code (claude-opus-5-5; the card's preferred `sonnet` was not selectable in this session): removed the AI-guided interview opt-in end to end.
  - Webview: dropped the checkbox, help text, CSS, `readInterview`, and the save-path/change-detection for the flag in `media/board.js`/`media/board.css`. `isInterviewCard` is now `assignee.kind === 'human'`; the modal button tracks only the assignee dropdown, and the tile icon shows for every defined, non-done Human card when Run With AI is on.
  - Host: removed `Card.interview`, the `setInterview` message and validator (`src/types.ts`), the `boardPanel.ts` handler, `BoardStore.setInterview` and `utils.setInterview`, plus clone/duplicate/assignee-clear handling. `aiCards.ts` eligibility accepts any defined, non-done Human card; the not-interview text is now "Only a Human card can start an interview. Assign the card to Human first."
  - Serialization: never writes `interview`; a legacy `interview:` key is ignored on read and drops out on the next write. Removed the `interview` bullet from the board README contract. Updated the Unreleased CHANGELOG entry.
  - Tests: rewrote `test/unit/cardInterview.test.ts` (Human-only eligibility, no key written, legacy key tolerated and dropped through the store, README omits the key, `setInterview` rejected) and updated `test/unit/cardInterviewRun.test.ts`. `npm run compile-tests`, `npm run compile`, `npm test` (769/769) and `npm run lint` pass. The modal and tile criteria were checked by reading the code, not in a running board.
  - Still open: the Development Host smoke test. Steps: F5 to start the Development Host, enable `mwnn-kanban.enableRunWithAI`, open the board, open a defined Human card outside Done, and confirm there is no checkbox and that Start interview is in the modal footer and on the tile. Switch the dropdown to AI and confirm the button goes away. Click Start interview and confirm the interview chat opens.
Initially reported as blocked: Development Host smoke test needed a human (steps above); all code and automated validation was done. Resolved below by the interview of 2026-10-10.

### 2026-10-10T13:40:22.645Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.
- 2026-10-10 Interview Q1 (smoke test, modal): "With Run With AI enabled, did the Human card's modal show Start interview in the footer with no AI-guided interview checkbox?" Answer: "With AI selected the modal has no interview mentions." Source: reported by the user in interview chat, 2026-10-10 (user-reported, not verified). Note: this covers the modal with the assignee dropdown set to AI (no checkbox, no button). The modal with Human selected, the tile icon, and opening the chat have not been reported yet.
- 2026-10-10 Interview Q2 (smoke test, modal with Human): "With the assignee dropdown set back to Human in that same modal, does a Start interview button appear in the footer, still with no checkbox?" Answer: "When I switch to human there is no checkbox and no start interview in the footer." Source: reported by the user in interview chat, 2026-10-10 (user-reported, not verified). Result: smoke test FAILED for the modal button as observed. Note from code reading: `media/board.js` shows the modal button only when the *saved* card is Human, defined and not done, Run With AI is on, and the dropdown is Human, so switching an unsaved AI card to Human would not show it. Confirming the saved assignee next.
- 2026-10-10 Interview Q3 (smoke test, saved assignee): "When you opened the modal, was the card already saved as Human, or saved as AI with only the dropdown changed?" Answer: "Saved as ai." Source: reported by the user in interview chat, 2026-10-10 (user-reported, not verified). Result: the Q2 observation is how the code is meant to behave (an unsaved switch to Human does not show the button), so it is not a failure of the criterion as written. The saved-Human case is still untested.
- 2026-10-10 Interview Q4 (smoke test, saved Human modal): "After saving the card as Human and reopening the modal, does Start interview appear in the footer with no checkbox?" Answer: "Yes". Source: reported by the user in interview chat, 2026-10-10 (user-reported, not verified). Modal part of the smoke test passes as reported. Still to report: the tile icon, and whether clicking Start interview opens the interview chat.
- 2026-10-10 Interview Q5 (smoke test, tile icon): "On the board, does that Human card's tile show the Start interview icon button?" Answer: "Yes". Source: reported by the user in interview chat, 2026-10-10 (user-reported, not verified). Still to report: whether clicking Start interview opens the interview chat.
- 2026-10-10 Interview Q6 (smoke test, opening the chat): "When you click Start interview (modal or tile), does the interview chat open?" Answer: "Yes". Source: reported by the user in interview chat, 2026-10-10 (user-reported, not verified).

### 2026-10-10 - Interview summary
- Smoke-test criterion met based on what the user reported (Q1-Q6): no checkbox for either assignee; Start interview shows in the modal for a saved, defined, non-done Human card and on its tile; clicking it opens the interview chat. The first Q2 result came from a card still saved as AI, which by design shows no button (Q3), so it is not a defect.
- The other eight criteria were already met from the earlier implementation run (compile, test 769/769, lint, code reading). That evidence is unchanged.
- All nine criteria are now checked. No open criteria and no unresolved exceptions.
- I did not move the card or change its assignee; it stays in Implement for the normal flow to advance.
STATUS: DONE
