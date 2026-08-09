---
id: card-mseqezrp-7
title: Document the AI Verify loop option
column: col-mqwk2njn-4
position: 32000
assignee: { kind: ai }
createdAt: 1785852411541
updatedAt: 1786232554022
dependsOn: [card-mseqezrp-5]
---

## Description
Document the option for users: extend the AI loop section of `README.md` with `mwnn-kanban.aiLoopVerifyCards` — what the loop does in the Verify column when it is on, that a passing card is the only case in which the loop moves a card to Done, and that every other outcome assigns the card to a human with the reason recorded on the card.

Call out the channel difference honestly: on the CLI channel a run that ends without a verdict hands the card to a human, while a chat handoff that never writes a `VERIFY:` marker leaves the loop waiting (with a live elapsed-time progress line) until it is stopped.

Add the user-facing change to `CHANGELOG.md` under `[Unreleased]`.

## Acceptance criteria
- [x] `README.md` documents `mwnn-kanban.aiLoopVerifyCards`, its default, and the routing of pass, fail, and cannot-verify outcomes
- [x] The README states that a passing verification is the only case in which the loop moves a card into Done
- [x] The README notes the chat-channel wait behaviour and the CLI-channel hand-back
- [x] `CHANGELOG.md` has an entry under `[Unreleased]`

## Activity
### 2026-08-04T14:06:51.541Z - Imported from plan
Import key: `ai-verify-loop-plan#docs` (source: AI Verify option plan, 2026-08-04 chat).

### 2026-08-08T23:32:41.712Z - AI loop advanced this card
Moved to "Ready".

### 2026-08-08T23:32:41.956Z - AI loop advanced this card
Moved to "Implement".

### 2026-08-08T23:32:42.135Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-08T23:37:25.230Z - Codex documentation update
Documented the default-off AI Verify loop option, pass/fail/cannot-verify routing, the pass-only move to Done, and the different no-verdict behavior for CLI and chat handoffs. Added the user-facing Unreleased changelog entry. Focused documentation assertions passed, and `git diff --check -- README.md CHANGELOG.md` reported no whitespace errors.

STATUS: DONE

### 2026-08-08T23:38:39.192Z - AI loop advanced this card
Moved to "Verify".

### 2026-08-08T23:38:39.352Z - OpenAI Codex CLI verification handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.

### 2026-08-08 - Codex verification
Verified all four criteria against the current workspace. `README.md` documents `mwnn-kanban.aiLoopVerifyCards` with its `false` default, pass-only movement to Done, human assignment with recorded reasons for all non-passing outcomes, and the CLI no-verdict hand-back versus chat's cancellable elapsed-time wait. `CHANGELOG.md` includes the user-facing entry under `[Unreleased]`; `package.json` and the loop implementation/tests corroborate the documented behavior. `git diff --check -- README.md CHANGELOG.md`, `npm run compile-tests`, `npm run compile`, 120 focused tests, `npm test` (268 passed), and `npm run lint` all passed.

VERIFY: PASS

### 2026-08-08T23:42:33.964Z - AI loop verified this card
AI verification passed; moved to "Done".
