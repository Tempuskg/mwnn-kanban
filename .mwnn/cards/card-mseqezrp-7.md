---
id: card-mseqezrp-7
title: Document the AI Verify loop option
column: col-mqwk2njn-1
position: 7000
assignee: { kind: ai }
dependsOn: [card-mseqezrp-5]
createdAt: 1785852411541
updatedAt: 1785852411541
---

## Description
Document the option for users: extend the AI loop section of `README.md` with `mwnn-kanban.aiLoopVerifyCards` — what the loop does in the Verify column when it is on, that a passing card is the only case in which the loop moves a card to Done, and that every other outcome assigns the card to a human with the reason recorded on the card.

Call out the channel difference honestly: on the CLI channel a run that ends without a verdict hands the card to a human, while a chat handoff that never writes a `VERIFY:` marker leaves the loop waiting (with a live elapsed-time progress line) until it is stopped.

Add the user-facing change to `CHANGELOG.md` under `[Unreleased]`.

## Acceptance criteria
- [ ] `README.md` documents `mwnn-kanban.aiLoopVerifyCards`, its default, and the routing of pass, fail, and cannot-verify outcomes
- [ ] The README states that a passing verification is the only case in which the loop moves a card into Done
- [ ] The README notes the chat-channel wait behaviour and the CLI-channel hand-back
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]`

## Activity
### 2026-08-04T14:06:51.541Z - Imported from plan
Import key: `ai-verify-loop-plan#docs` (source: AI Verify option plan, 2026-08-04 chat).
