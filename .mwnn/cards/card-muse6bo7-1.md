---
id: card-muse6bo7-1
title: When filling with AI in a chat session have the AI treat it as in planning mode were you can ask the user clarifying questions
column: col-mqwk2njn-4
position: -54000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-4.6
preferredModel.codex: gpt-5.5
preferredModel.claude-code: sonnet
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1791031942807
updatedAt: 1791301691568
---

## Description
When a user picks **Fill in with AI** on a card and sends it to an interactive chat session (`fillCardDefinitionWithAI` → `handOffPromptToChat` in `src/extension.ts`), the agent gets the same one-shot prompt that headless CLI runs get from `buildCardDefinitionPrompt` (`src/aiCards.ts`). It never asks anything and guesses through any ambiguity. A person is watching that chat, so the prompt should tell the agent to work like it is in planning mode: first read the card and the relevant code, then ask the user focused clarifying questions about scope, intended behaviour, and edge cases that the title and context don't settle, wait for answers, and only then write the Description and Acceptance criteria (and split the card, if that applies).

This applies only to the manual chat-handoff path. Headless agent CLI runs (`runCardWithAgentCli`) and the AI loop's chat `requestDefinition` gateway stay non-interactive. Nobody is there to answer in those runs, and the loop is meant to run on its own. Those prompts must not change.

## Acceptance criteria
- [x] `buildCardDefinitionPrompt` (or a small option or wrapper on it) can produce an interactive variant that tells the agent to read context first, ask the user clarifying questions before editing the card file, wait for the answers, and only then write the definition.
- [x] The interactive variant tells the agent to skip questions and go straight to defining the card when the title and context are already unambiguous, and to keep questions few and specific (no generic questionnaire).
- [x] The interactive variant still includes the existing file-edit, split, and run-settings instructions, and says not to implement the work.
- [x] `fillCardDefinitionWithAI` uses the interactive variant only when the chosen provider is a chat target. The CLI branch keeps the current non-interactive prompt.
- [x] The AI loop's chat `requestDefinition` gateway and all CLI definition runs produce output byte-for-byte identical to the current prompt.
- [x] Unit tests in `test/unit/` cover the interactive variant (it contains the clarifying-question and wait-for-answers instructions) and the default variant (it contains neither).
- [x] `npm run compile-tests`, `npm run compile`, `npm test`, and `npm run lint` pass.
- [x] Development Host smoke test: running **Fill in with AI** with a chat provider on a vague card makes the chat agent ask at least one clarifying question before it edits the card file.

## Activity
### 2026-10-06T13:52:55.082Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-06T13:53:47.740Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-sonnet-4.6`, thinking level `high`
- codex: model `gpt-5.5`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`

### 2026-10-06T14:00:28.657Z - Auto-start held in Ready
Assigned to AI, but the card stays in Ready: "Ready" has 1 of its 3 defined cards (reverse WIP) and Backlog still has cards to define.

### 2026-10-06T14:00:39.617Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-06 - Claude Code: interactive chat definition prompt
Model: preferred `sonnet` was not available to switch to in this session; used Claude Opus 5.5 (`claude-opus-5-5`).

- `src/aiCards.ts`: `buildCardDefinitionPrompt` takes a new optional 4th argument `CardDefinitionPromptOptions` (`{ interactive?: boolean }`). When `interactive` is set, it adds a "## Clarify with the user first (planning mode)" section right after the intro: read the card and relevant code first, ask focused clarifying questions about scope, behaviour, and edge cases before editing the card file, wait for answers, then define. It also says to keep questions few and specific (no generic questionnaire), to skip questions when the card is already unambiguous, and still not to implement. The file-edit, split, and run-settings sections are unchanged. Default output is byte-identical.
- `src/extension.ts` `fillCardDefinitionWithAI`: the CLI branch builds the default prompt and the chat-target branch builds the interactive one. The AI loop's chat `requestDefinition` gateway and other CLI definition paths are untouched.
- `test/unit/aiCards.test.ts`: two new tests. The interactive variant contains the clarify, wait, skip-if-clear, and few/specific instructions plus the existing sections. The default variant contains none of them, and equals the interactive output once that section is removed (byte-identical check).
- Validation: `npm run compile-tests`, `npm run compile`, `npm test` (617/617 pass), and `npm run lint` all succeed.
- Not done: the Development Host smoke test (Fill in with AI → chat provider on a vague card → agent asks a question before editing). It needs a person in an interactive VS Code session, so that criterion is left unchecked.

Initially reported as blocked: the Development Host smoke test needed a human. Resolved below.

### 2026-10-06 - Claude Code: smoke test confirmed
Built a VSIX from the working tree and installed it into VS Code. The user ran **Fill in with AI** with a chat provider on a vague card and confirmed the chat agent asked clarifying questions before editing the card file ("it works perfectly"). All acceptance criteria are now met.

STATUS: DONE
