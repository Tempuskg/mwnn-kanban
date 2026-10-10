---
id: card-mv2euuu4-1
title: "Have \"fill with AI\" start in the existing extension chat box instead of creating a new tab window"
column: col-mqwk2njn-4
position: -66000
assignee: { kind: ai }
preferredModel.copilot: claude-haiku-4.5
preferredModel.codex: gpt-6.1-sol
preferredModel.claude-code: sonnet
preferredModel.cursor: auto
thinkingLevel.copilot: medium
thinkingLevel.codex: medium
thinkingLevel.claude-code: medium
createdAt: 1791637749148
updatedAt: 1791643511811
---

## Description
Handing a card to Claude Code (Fill with AI, chat-mode Run with AI, and Import plan) currently calls `claude-vscode.editor.open(undefined, prompt)` from `handOffPromptToChat` in src/extension.ts. Claude Code treats that as an interactive open, so every handoff spawns a new editor tab. Instead, the handoff should land in Claude Code's existing sidebar chat as a **new conversation** prefilled with the prompt.

Installed Claude Code (2.1.296) supports this natively: `editor.open(sessionId, initialPrompt, _, _, fullEditor, { programmatic: 'honor-preferred-location' })` routes to `activateInSidebar` and focuses the sidebar when the user's Claude Code preferred location is the sidebar and the session is not already open in a panel. Otherwise it opens a panel tab, which honors the user's own Claude Code setting. The fix passes that options argument on the positional delivery path, so all Claude Code chat handoffs behave consistently. The current sidebar conversation is never reused or pasted into.

Out of scope: Copilot (`{ query }`) and Codex (clipboard and sidebar) handoffs, CLI and AI-loop runs, and a `chatProviderCommands` override that points at `claude-vscode.primaryEditor.open` (that command always opens a panel by design).

## Acceptance criteria
- [x] For a `positional` target using `claude-vscode.editor.open`, the handoff invokes it with no session id, the prompt as the initial prompt, and `{ programmatic: 'honor-preferred-location' }` as the options argument (6th positional). Unused middle arguments are passed as `undefined`.
- [ ] With Claude Code's preferred location set to the sidebar, Fill with AI on a card opens a new, prompt-prefilled conversation in the existing Claude Code sidebar and creates no new editor tab. Any previous sidebar conversation remains intact in session history.
- [ ] With Claude Code's preferred location set to the editor or panel, the handoff still opens a prefilled panel tab, as it does today.
- [x] Run with AI (chat provider = Claude Code) and Import plan (Claude Code) use the same sidebar routing, because they share `handOffPromptToChat`.
- [x] A `claude-vscode.primaryEditor.open` target (via `chatProviderCommands` override) keeps its current behavior and does not receive the options argument.
- [x] Copilot and Codex handoff behavior is unchanged.
- [x] The definition-handoff Activity entry and the "Handed … to Claude Code" notification are still written only after a successful handoff. The `describeChatHandoffTarget` picker text for positional delivery no longer promises a new "window" (e.g. "Opens Claude Code chat pre-filled with the card prompt").
- [x] Unit tests cover the positional argument shape (sidebar options passed for `editor.open`, not for `primaryEditor.open`). `npm run compile-tests`, `npm test`, and `npm run lint` pass.
- [ ] Development Host smoke test: with the Claude Code sidebar open on an existing conversation, Fill with AI starts a new prefilled sidebar conversation and no new tab appears.

## Activity
### 2026-10-10T13:53:43.723Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-10T13:59:11.846Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-haiku-4.5`, thinking level `medium`
- codex: model `gpt-6.1-sol`, thinking level `medium`
- claude-code: model `sonnet`, thinking level `medium`
- cursor: model `auto`

### 2026-10-10T14:01:34.203Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-10 - Claude Code: implemented sidebar routing
Added `positionalHandoffArgs` in src/chatHandoff.ts. `claude-vscode.editor.open` now receives `(undefined, prompt, undefined, undefined, undefined, { programmatic: 'honor-preferred-location' })`, and `primaryEditor.open` still receives `(undefined, prompt)`. `handOffPromptToChat` in src/extension.ts spreads these arguments, so Fill with AI, Run with AI, and Import plan all share the new routing. The Copilot and Codex paths, plus the Activity and notification ordering, are unchanged. The picker text now reads "Opens Claude Code chat pre-filled with the card prompt". Added unit tests in test/unit/chatHandoff.test.ts. compile-tests, compile, npm test (771/771 passing), and lint all pass. Ran on Opus 5.5: the requested model `sonnet` could not be selected from inside this session.
Smoke test still needed in a Development Host (F5). (1) Set Claude Code's preferred location to the sidebar, open an existing sidebar conversation, and run Fill with AI on a card. Expect a new prefilled sidebar conversation, no new editor tab, and the old conversation still in history. (2) Set the preferred location to the editor or panel and repeat. Expect a prefilled panel tab.
STATUS: BLOCKED: Development Host smoke test (sidebar vs. panel routing) needs a human
