---
id: card-mtq8s6j0-1
title: When defining a card with AI have the AI breakup into multiple cards if warranted
column: col-mqwk2njn-1
position: 4000
preferredModel.copilot: claude-sonnet-4.6
preferredModel.codex: gpt-5.5
preferredModel.claude-code: sonnet
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1788725170188
updatedAt: 1791151198307
---

## Description
Extend the AI card-definition prompt/handoff (all definition paths: vscode.lm and agent-CLI file-mediated handoff) so that when a card's title/context covers more than one independently deliverable slice, the AI splits it into multiple cards instead of writing one oversized definition. The original card keeps the first slice (its id, column, and position stay put) and gets its Description/Acceptance criteria narrowed to that slice; each additional slice becomes a new well-formed card file in the same column, positioned right after the original, following the MWNN Card Authoring contract. Real prerequisites between the slices are expressed with `dependsOn`. Cards that are already a single coherent slice are defined in place exactly as today.

## Acceptance criteria
- [ ] The definition prompt instructs the AI to judge whether the card warrants splitting, and to split only into genuinely independent deliverables (not sequential steps of one change).
- [ ] When split, the original card file keeps its id, frontmatter, run-settings keys, and existing Activity, and its Description/Acceptance criteria cover only its own slice.
- [ ] Each new card has a unique `card-<base36>-<n>` id matching its filename, a valid column id (same as the original), ascending positions after the original without renumbering existing cards, non-empty Description and Acceptance criteria, and an empty Activity.
- [ ] New cards carry `dependsOn` only for real prerequisites; no self-dependencies or cycles are produced.
- [ ] The original card's Activity gets a dated entry listing the ids of the cards split from it.
- [ ] Completion detection for the definition handoff still succeeds when extra cards were created, and the board reloads to show them.
- [ ] A card that does not warrant splitting is defined in place with no new cards created.
- [ ] Unit tests cover the prompt text including the split guidance; `npm run compile-tests` and `npm test` pass.
- [ ] Development Host smoke test: defining a clearly multi-part card produces multiple valid cards on the board.

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
