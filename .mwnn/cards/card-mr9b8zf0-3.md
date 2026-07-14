---
id: card-mr9b8zf0-3
title: import plan from supplied file path
column: col-mqxta6ho-4
position: 0
assignee: { kind: human }
createdAt: 1783347823692
updatedAt: 1784036858803
---

## Description
Keep the existing handoff-to-AI workflow. When a user wants to import a plan, they provide the plan's local file path to the AI through that handoff; the AI reads the file and imports the plan into well-formed MWNN Backlog cards. Do not add a separate extension-side plan parser or import workflow.

## Acceptance criteria
- [ ] The existing handoff-to-AI flow remains the entry point for plan import; no separate extension-side plan parser or import UI is introduced.
- [ ] The user can give the AI a workspace-relative or absolute local file path, and the handoff clearly instructs the AI to read that file and import its actionable work into the MWNN board.
- [ ] The AI creates one well-formed Backlog card for each outstanding actionable item, with a unique matching filename/frontmatter `id`, a concise title, a non-empty Description, and concrete Acceptance criteria.
- [ ] The AI avoids duplicate cards when importing the same plan again and reports the import result or any inaccessible or invalid path clearly to the user.

## Activity
### 2026-07-13T22:52:12.175Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-07-13T22:55:26.024Z - AI loop placed this card in Ready
The definition was just filled in; moved to "Ready" to wait for a human to review the Description and Acceptance criteria before implementation starts.

### 2026-07-13T22:55:27.526Z - AI loop triage
The AI judged this card doable by an agent and assigned it to AI.
Why: The implementation involves reading a file, processing its content, and creating cards based on defined criteria, which can be automated.

### 2026-07-13T23:01:00.493Z - AI loop advanced this card
Moved to "Implement".

### 2026-07-14T12:12:26.560Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-14T12:38:14.627Z - Scope clarified
Keep the existing AI handoff and pass the supplied local file path to the AI so it can read and import the plan directly; do not build a separate extension-side importer.

### 2026-07-14T13:30:28.114Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-14 - Codex implementation
Updated the existing Import Plan handoff to collect only a workspace-relative or absolute local path and pass it to the AI without extension-side reading or parsing. Added AI guidance for invalid-path reporting, Backlog card validity, stable idempotent matching, and import result counts, plus focused prompt coverage. Compile, focused tests, and lint pass; the full suite still has the pre-existing `test/unit/planImporter.test.ts` failure because `utils.importCards` is missing.
