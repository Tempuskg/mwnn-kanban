---
id: card-msm4mkov-1
title: Allow human to edit activity section
column: col-mqwk2njn-4
position: -18000
assignee: { kind: human }
createdAt: 1786299543103
updatedAt: 1786301771155
---

## Description
Allow a person to view and edit a card's Activity content from the card-editing interface, without requiring direct changes to the underlying Markdown file. The edited Activity must use the existing card persistence flow while preserving its Markdown formatting and all unrelated card data.

## Acceptance criteria
- [x] The card-editing interface shows the card's complete current Activity content in an editable multiline field, including a usable empty state when no Activity exists.
- [x] A human can add, change, or remove Activity text and save the card successfully.
- [x] Saved Activity text, including line breaks and Markdown, is still present after closing and reopening the card and after the board reloads from disk.
- [x] Cancelling or closing the editor without saving leaves the Activity content unchanged.
- [x] Saving an Activity edit does not alter the card's frontmatter, Description, Acceptance criteria, or other fields unless the user also changed those editable fields.
- [x] Existing Activity entries and workflow markers remain unchanged unless the user deliberately edits them.
- [x] Automated tests cover loading existing Activity text, saving an edit, preserving it through serialization, and discarding an unsaved edit.

## Activity
### 2026-08-09T18:19:16.333Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-08-09T18:25:06.630Z - OpenAI Codex CLI triage handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-09T18:26:08.213Z - Triage decision
AI can implement this bounded webview, persistence, serialization, and testing change; the card leaves no product decision or external implementation step unresolved.

### 2026-08-09T18:26:30.508Z - AI loop advanced this card
Moved to "Implement".

### 2026-08-09T18:26:31.060Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-09 - OpenAI Codex CLI implementation completed
Added an editable multiline Activity field with save/discard handling, routed Activity replacement through the shared webview/store persistence flow, preserved Markdown headings and unrelated card data during serialization, and added focused protocol, editor-draft, operation, store, and serialization tests. `npm run compile`, `npm test` (274 tests), and `npm run lint` pass. Interactive Development Host smoke testing was unavailable because no Windows UI or browser runtime was connected.
STATUS: DONE

### 2026-08-09T18:40:25.999Z - AI loop advanced this card
Moved to "Verify".

### 2026-08-09T18:40:26.172Z - OpenAI Codex CLI verification handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-09 - OpenAI Codex CLI verification
Verified the current workspace with `npm run compile-tests`, `npm run compile`, 76 focused Activity-related tests, the full 274-test suite, and `npm run lint`; all passed. Source and test evidence confirms the typed Activity message/store path, existing and empty draft loading, edit and clear operations, Markdown and workflow-marker serialization, unchanged frontmatter and unrelated sections, disk reload, and the unsaved-discard helper. Criteria 1-4 remain unchecked because no VS Code Development Host interaction was available to confirm the rendered field's usability and the real save, reopen, close, and cancel flows.
VERIFY: HUMAN: A Development Host interaction is required to confirm the Activity editor UI and real save, reopen, close, and cancel behavior.

### 2026-08-09T18:45:17.182Z - AI loop handed verification to Human
The card remains in Verify and was reassigned to Human.
Why: A Development Host interaction is required to confirm the Activity editor UI and real save, reopen, close, and cancel behavior.

Verified Activity editor UI
