---
id: card-mrjayz9y-1
title: Sometimes have to pass to AI twice
column: col-mqwk2njn-4
position: 3000
assignee: { kind: ai }
createdAt: 1783952018710
updatedAt: 1783955306829
---

## Description
Make the card-to-Codex handoff reliable on the first attempt. A single handoff action should open or activate Codex and deliver the complete generated card prompt to the intended new-chat composer, even when Codex is not already open or is still initializing, so the user never has to repeat the action.

## Acceptance criteria
- [x] Invoking the Codex handoff once for an eligible card opens or activates Codex and places the complete generated card prompt in the intended new-chat composer without requiring a second invocation.
- [x] The first handoff succeeds when Codex is initially closed, already open on another conversation, or still initializing after its command is invoked.
- [x] One handoff action produces at most one new conversation, one prompt insertion, and one corresponding handoff entry in the card's Activity section.
- [x] Repeated activation while the same handoff is still in progress does not paste or dispatch the prompt twice.
- [x] If Codex cannot be opened or the prompt cannot be delivered, the user receives a clear failure message with retry guidance and the handoff is not reported as successful.
- [x] Automated regression tests cover the initial readiness/timing failure, successful delivery on the first attempt, duplicate prevention, and the visible failure path.

## Activity
### 2026-07-13T14:15:18.035Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-07-13T14:47:25.773Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-07-13T14:59:27.8733363Z - Completed by Codex (ChatGPT)
Made Codex handoffs activate the provider, prepare its sidebar, wait for the new composer, and paste the complete prompt exactly once. Added per-card in-flight locking, visible retry failure handling without a success Activity entry, inactive-provider discovery, and regression tests for timing, first-attempt delivery, duplicates, and open/paste failures. Verified with `npm.cmd run compile`, `npm.cmd run compile-tests`, `npm.cmd test` (144 passing), and `npm.cmd run lint`.
