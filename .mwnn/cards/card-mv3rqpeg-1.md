---
id: card-mv3rqpeg-1
title: When viewing the cards dependencies allow the user to click on a dependency and open that card
column: col-mqwk2njn-4
position: -74000
assignee: { kind: human }
preferredModel.copilot: claude-haiku-4.5
preferredModel.codex: gpt-6-luna
preferredModel.claude-code: haiku
preferredModel.cursor: Gemini 3.8 Flash
thinkingLevel.copilot: medium
thinkingLevel.codex: medium
thinkingLevel.claude-code: medium
createdAt: 1791719856664
updatedAt: 1791725990079
---

## Description
In the card details modal, the Dependencies field shows each dependency as a chip with the dependency's title and a × remove button (`renderDependencyControls` in `media/board.js`). The chips can't be clicked yet. Make the title part of each chip a link-style button that opens that dependency's card details, so the user can move through a dependency chain without closing the modal and finding the card on the board.

Navigating away must not lose edits. If the current card's form has unsaved changes, opening the dependency goes through the same unsaved-changes prompt the modal already uses when it closes (`requestClose` / `renderUnsavedChangesPrompt`). This covers both the unsaved dependency list and changes to other fields. This is a webview-only change. It reuses `openCardDetails(cardId)` and needs no new host message. A "back to the previous card" history stack is out of scope.

## Acceptance criteria
- [x] In the card details modal, the title of each dependency chip is a clickable `<button type="button">`, separate from the × remove button. It is keyboard-focusable, activates with Enter or Space, and has a tooltip/aria-label such as `Open card "<title>"`.
- [x] With no unsaved changes, clicking a dependency title closes the current card's modal and opens the dependency's card details in its place.
- [x] With unsaved changes on the current card, clicking a dependency title shows the existing unsaved-changes prompt. Saving persists the edits, then opens the dependency. Discarding drops the edits, then opens the dependency. Cancelling stays on the current card with the edits intact.
- [x] A dependency added in the current editing session but not yet saved counts as an unsaved change for the rule above, and its chip is clickable too.
- [x] Clicking the × remove button still only removes the dependency and does not navigate.
- [x] Blocked vs. unblocked chip styling is unchanged, and the clickable title has a visible hover/focus state that works in light, dark, and high-contrast themes.
- [x] If the dependency card no longer exists when clicked (e.g. it was deleted by an external edit), nothing navigates and the modal stays open with no error.
- [x] `npm run compile`, `npm test`, and `npm run lint` pass. A Development Host smoke test confirms navigation through a two-level dependency chain (A → B → C) and the unsaved-changes path.

## Activity
### 2026-10-11T11:58:03.942Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-11T11:58:39.945Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-haiku-4.5`, thinking level `medium`
- codex: model `gpt-6-luna`, thinking level `medium`
- claude-code: model `haiku`, thinking level `medium`
- cursor: model `Gemini 3.8 Flash`

### 2026-10-11T12:03:09.153Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-11 Claude Code: implemented clickable dependency chips
Model note: the card prefers `haiku`, but this session could not switch models; the work was done with `claude-opus-5-5`.

- `media/board.js`: each dependency chip title is now a `<button type="button" class="card-dep-open">` with title/aria-label `Open card "<title>"`, separate from the × remove button. `renderCardDetails` generalizes `requestClose` into `requestLeave(next, focusOnDismiss)`, so opening a dependency goes through the existing `cardFormHasChanges` / `renderUnsavedChangesPrompt` flow (Save → persist then open, Discard → drop then open, Cancel → stay with edits, focus returns to the clicked chip). Unsaved added/removed dependencies already count via `getDependencies`. A dependency missing at click time does nothing; if it disappears while the prompt is open, the modal just closes after save/discard. No new host message.
- `media/board.css`: `.card-dep-open` adds a link-coloured, underlined hover/focus state plus a `--vscode-focusBorder` outline, using theme tokens only. Blocked/unblocked chip borders are unchanged.
- Validation: `npm run compile` passed, `npm test` passed (783/783), `npm run lint` was clean.
- Still to do by a human: a Development Host smoke test. (1) Make cards A→B→C. Open A, click B, then click C in B's modal. (2) Edit A's title, click B, and check Cancel keeps the edit, Discard drops it and opens B, and Save persists it and opens B. (3) Check hover/focus visibility in light, dark and high-contrast themes.
Initially reported as blocked: Development Host smoke test (A→B→C navigation, unsaved-changes path, theme hover/focus check) needed a human; resolved in interview.

### 2026-10-11T12:47:15.374Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-11 Claude Code (interview): automated validation re-run
Verified evidence: on the current working tree (`media/board.js`, `media/board.css` modified), `npm run compile` exited 0, `npm test` passed 783/783 (0 fail), and `npm run lint` exited 0 with no findings.

### 2026-10-11 Claude Code (interview): A → B → C navigation smoke test
- Q: Have you run the Development Host smoke test for A → B → C dependency-chain navigation (open A, click B's title, then click C's title in B's modal)?
- A: "Yes it worked"
- Source: reported by the user in interview chat, 2026-10-11 (user-reported, not independently verified).

### 2026-10-11 Claude Code (interview): unsaved-changes path smoke test
- Q: After editing card A's title and clicking a dependency title, did Cancel keep the edit on A, Discard drop the edit and open B, and Save persist the edit and open B?
- A: "yes"
- Source: reported by the user in interview chat, 2026-10-11 (user-reported, not independently verified).

### 2026-10-11 Claude Code (interview): theme hover/focus check
- Q: Did the dependency title show a visible hover and keyboard-focus state in light, dark and high-contrast themes, with blocked/unblocked chip styling unchanged?
- A: "In light mode I can't see any hover difference"
- Source: reported by the user in interview chat, 2026-10-11 (user-reported). Light-theme hover is reported as not visible, so this criterion is not met. Dark, high-contrast, keyboard focus and blocked/unblocked styling are not yet answered.

### 2026-10-11 Claude Code (interview): dark-theme hover check
- Q: In dark mode, does hovering a dependency title show a visible change (colour shift and/or underline)?
- A: "Yes"
- Source: reported by the user in interview chat, 2026-10-11 (user-reported, not independently verified).

### 2026-10-11 Claude Code (interview): high-contrast hover check
- Q: In a high-contrast theme, does hovering a dependency title show a visible change?
- A: "In high contrast dark yes light no"
- Source: reported by the user in interview chat, 2026-10-11 (user-reported). High Contrast Dark hover is visible; High Contrast Light hover is not. Together with the light-theme answer above, hover feedback fails in both light themes.

### 2026-10-11 Claude Code (interview): keyboard focus check
- Q: When you Tab onto a dependency title, does it show a visible focus outline? (yes / no, naming failing themes / not tested)
- A: "yes"
- Source: reported by the user in interview chat, 2026-10-11 (user-reported, not independently verified). No failing theme was named.

### 2026-10-11 Claude Code (interview): blocked/unblocked chip styling check
- Q: Do the blocked and unblocked dependency chips still look as they did before?
- A: "yes"
- Source: reported by the user in interview chat, 2026-10-11 (user-reported). Consistent with verified evidence: `git diff -- media/board.css` adds only `.card-dep-open` rules and leaves the `.card-chip-dep-blocked` / `.card-chip-dep-unblocked` styles untouched.

### 2026-10-11 Claude Code (interview): summary
- Met: criteria 1–5 and 7 (already checked by the implementing agent; not re-tested in this interview). Criterion 8 is now checked. Compile, test (783/783) and lint are verified evidence from this interview's re-run. The Development Host A → B → C navigation and unsaved-changes path (Cancel/Discard/Save) are user-reported as working.
- Open: criterion 6. Blocked/unblocked styling is unchanged (user-reported, consistent with the diff), and keyboard focus is visible (user-reported). Hover feedback on the dependency title is visible in Dark and High Contrast Dark but **not visible in Light or High Contrast Light** (user-reported).
- Unresolved exception: the `.card-dep-open:hover` style in `media/board.css` needs a follow-up fix so hover is visible in both light themes, then a light-theme re-check by a human. No card move or assignee change was made.

### 2026-10-11T13:32:02.653Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-11 Claude Code: light-theme hover fix
Model note: the card prefers `haiku`, but this session could not switch models; the work was done with `claude-opus-5-5`.

- `media/board.css`: `.card-dep-open:hover` now also gets a `--vscode-toolbar-hoverBackground` highlight (falling back to `--vscode-list-hoverBackground`), an offset underline, and a dashed `--vscode-contrastActiveBorder` outline. That variable is only set by high-contrast themes, so the outline is transparent elsewhere. The title button has 2px horizontal padding so the highlight reads. Focus and blocked/unblocked styles are unchanged.
- Validation: `npm run compile` passed, `npm test` passed (783/783), `npm run lint` was clean.
- Still to do by a human: reload the Development Host (or reinstall the build), open a card that has dependencies, and hover a dependency title in Light Modern and High Contrast Light, then spot-check Dark and High Contrast Dark. If hover is visible in all four, check criterion 6, reword this marker to a plain note, and append `STATUS: DONE`.
Initially reported as blocked: light / high-contrast-light hover visibility needed a human visual re-check; resolved in interview.

### 2026-10-11T13:33:52.099Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-11 Claude Code (interview): Light Modern hover re-check after fix
- Context: the working tree (including the `.card-dep-open:hover` fix in `media/board.css`) was packaged and installed locally as a test VSIX at the user's request. Verified: the VSIX contains the fixed hover rule and the Pro package.
- Q: In Light Modern, is there now a visible change when you hover a dependency title?
- A: "yes"
- Source: reported by the user in interview chat, 2026-10-11 (user-reported, not independently verified).

### 2026-10-11 Claude Code (interview): High Contrast Light hover re-check after fix
- Q: In High Contrast Light, is there now a visible change when you hover a dependency title?
- A: "yes"
- Source: reported by the user in interview chat, 2026-10-11 (user-reported, not independently verified).

### 2026-10-11 Claude Code (interview): closing summary
- Criterion 6 is now checked. Hover is visible in Light Modern and High Contrast Light after the fix (user-reported). Dark and High Contrast Dark hover were reported visible before the fix (user-reported). The fix only adds hover styling, so those answers still apply. Keyboard focus is visible (user-reported). Blocked/unblocked styling is unchanged (user-reported; verified from the diff, which leaves `.card-chip-dep-blocked` / `.card-chip-dep-unblocked` alone).
- All 8 acceptance criteria are checked. Criteria 1–5 and 7 were checked by the implementing agent. For criterion 8, compile, test and lint are verified evidence, and the A → B → C chain and unsaved-changes smoke tests are user-reported. No unresolved exceptions remain.
- The two earlier `STATUS: BLOCKED` markers were reworded to plain notes. The card was not moved and its assignee was not changed; column moves follow the board's WIP rules.
STATUS: DONE
