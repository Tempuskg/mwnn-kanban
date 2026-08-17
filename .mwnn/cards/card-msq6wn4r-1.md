---
id: card-msq6wn4r-1
title: Add a copy card path to the card details ui
column: col-mqwk2njn-4
position: -21000
assignee: { kind: human }
createdAt: 1786545236763
updatedAt: 1786907445654
---

## Description
Add a copy-path action to the card details UI so users can copy the absolute filesystem path of the current card's backing Markdown file. The path must be resolved from the workspace folder, the configured board folder, and the card's id, making it directly usable outside the workspace without affecting existing card-detail editing behavior.

## Acceptance criteria
- [ ] The card details UI presents a clearly labeled copy-path action for the open card.
- [ ] Activating the action copies the absolute filesystem path of the open card's backing Markdown file to the system clipboard.
- [ ] The copied path is resolved from the workspace folder containing the board and the configured `mwnn-kanban.boardFolder`; it supports a non-default board folder and is not hard-coded to `.mwnn/`.
- [ ] The copied value is an absolute path in the host operating system's path format and identifies the existing `<card-id>.md` file under the board's `cards` directory.
- [ ] The action is operable by mouse and keyboard and exposes an accessible name.
- [ ] The UI provides observable success feedback after copying and a clear error message if clipboard access fails.
- [ ] Automated tests cover absolute path construction for default and non-default board folders, the copy action, and success and failure feedback without regressing existing card-details behavior.

## Activity
### 2026-08-12T14:34:19.194Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-08-12T17:20:24.740Z - OpenAI Codex CLI triage handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-12T17:21:36.991Z - Triage decision
AI can implement this repository-contained UI, configured-path construction, clipboard handling, accessibility, feedback, and automated testing work without credentials, external actions, or unresolved product decisions.

### 2026-08-12T17:23:55.787Z - AI loop advanced this card
Moved to "Implement".

### 2026-08-12T17:23:57.247Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-12T17:32:52.374Z - OpenAI Codex CLI implementation completed
Added a typed card-details copy-path action backed by the configured board folder and VS Code clipboard API, accessible in-dialog feedback, and focused regression coverage. The test compiler, production build, focused tests, full unit suite, and lint all pass; an interactive Development Host smoke test was unavailable because the Windows control pipe was not running.

STATUS: DONE

### 2026-08-12T17:34:01.539Z - AI loop advanced this card
Moved to "Verify".

### 2026-08-12T17:34:01.747Z - OpenAI Codex CLI verification handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-12T17:38:35.546Z - Verification
Static evidence confirms configured-folder path construction, the typed webview/host copy request, use of `vscode.env.clipboard.writeText`, a native button with an accessible name, and status/alert feedback. `npm run compile-tests`, `npm run compile`, focused copy-path tests (8/8), `npm test` (290/290), and `npm run lint` passed. The Windows app-control native pipe was unavailable, so an Extension Development Host smoke test could not confirm the rendered label, actual system clipboard result, mouse/keyboard operation, or visible feedback; those four criteria remain unchecked for human validation.

VERIFY: HUMAN: Extension Development Host unavailable; human must confirm the rendered UI, system clipboard result, mouse/keyboard operation, and visible feedback.

### 2026-08-12T17:39:34.403Z - AI loop handed verification to Human
The card remains in Verify and was reassigned to Human.
Why: Extension Development Host unavailable; human must confirm the rendered UI, system clipboard result, mouse/keyboard operation, and visible feedback.

### 2026-08-12T14:26:15.913-06:00 - Absolute card path implementation completed
Updated card-path resolution to combine the active workspace root, configured board folder, cards directory, and card id into an absolute path using the host operating system's native path format. Updated focused coverage for default and non-default board folders. `npm run compile-tests`, `npm run compile`, focused card-path tests (9/9), `npm test` (291/291), and `npm run lint` passed. The Computer Use native pipe remains unavailable, so the interactive Development Host smoke test still requires human verification.

STATUS: DONE
