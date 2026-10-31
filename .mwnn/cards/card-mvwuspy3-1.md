---
id: card-mvwuspy3-1
title: When you start a run with AI session but you don't select the model and then the model selection disappears you can no longer start that card you keep getting an error that the handoff process is already started
column: col-mqwk2njn-4
position: -105000
assignee: { kind: human }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6.1-sol
preferredModel.claude-code: sonnet
preferredModel.cursor-other: claude-opus-5-5-xhigh
thinkingLevel.copilot: high
thinkingLevel.codex: xhigh
thinkingLevel.claude-code: high
createdAt: 1793478508635
updatedAt: 1793487746881
---

## Description
If you start Run with AI or Fill in with AI on a card and then walk away before choosing, the card can stay locked. The provider picker or later prompt disappears without a selection. After that, every attempt on the card shows "A handoff for this card is already in progress. Please wait for it to finish." The lock lasts until the VS Code window is reloaded.

Likely mechanism (confirm while implementing): `runCardHandoff` in `src/extension.ts` holds the per-card lock from `createChatHandoffInFlight` (`src/chatHandoff.ts`) for the whole attempt. That covers the provider picker (`pickRunWithAiProvider`), the agent CLI run with its model-recovery prompts (`src/agentCliModelRecoveryUi.ts`), and chat delivery (`deliverPromptToChat`). The lock is released only when the attempt settles. Some awaited steps can stay pending after their UI is gone. Examples: a chat provider's open command that never returns, or the Codex non-modal "Prompt is present / Prompt is missing" and "Prompt is pasted" confirmations, which stay pending once the toast hides in the Notification Center. Any of these leaves the card locked. Today only `interview` holders can be restarted (`src/cardInterview.ts`). Run with AI and Fill in with AI holders cannot, and their chat delivery gets no abort signal, so one stuck delivery also blocks the shared `chatPromptDeliveries` queue for every card.

Scope:
- Find the step that stays pending.
- Release the lock immediately when any picker or input in these flows is dismissed.
- Let a stuck earlier attempt be recovered without a window reload, by reusing the existing lease/restart mechanism.
- Keep the protection against double dispatch while an agent CLI process is actually running.

This is an extension-host change only; no webview or message-protocol change is expected. AI loop dispatches are out of scope and must behave as they do today.

## Acceptance criteria
- [x] The exact awaited call that keeps the lock held after its picker or notification disappears is reproduced in a Development Host and recorded, with file and line, in this card's Activity.
- [x] Dismissing the Run with AI or Fill in with AI provider picker (Escape, clicking elsewhere, or another quick input replacing it) releases the card's lock. Starting the action again on the same card shows the picker again with no "already in progress" message, and the cancelled attempt writes no Activity entry.
- [x] Dismissing any model-recovery step (model pick, model input, thinking-level pick, settings-scope pick) releases the card's lock, writes no settings or card frontmatter, and lets the card be started again right away.
- [x] Suppose an earlier Run with AI or Fill in with AI attempt on a card is still pending with no agent CLI process running (for example, waiting on a chat provider command or a confirmation notification). Starting either action on that card then offers to restart, like the interview's "Restart interview" prompt, instead of the dead-end info message. Restart begins a fresh attempt; Wait or dismissing changes nothing.
- [x] Once a restart supersedes an attempt and its lease aborts, that attempt writes no Activity entry, records no handoff, and shows no further notifications. Its pending chat delivery leaves the `chatPromptDeliveries` queue, so later chat handoffs on this card and other cards are not stuck behind it.
- [x] While a card's agent CLI process is running, a second Run with AI or Fill in with AI on that card starts no second process, and its message points to the card's Stop action. Restart is never offered for, and never abandons, a running CLI process or an AI loop dispatch.
- [x] New unit tests cover four cases: a dismissed picker releases the lock; a pending non-interview holder can be restarted and its lease aborts; a superseded attempt writes nothing; a running CLI run is still refused. The existing interview restart tests in `test/unit/chatHandoff.test.ts` still pass.
- [x] `npm run compile-tests`, `npm run compile`, `npm test`, and `npm run lint` pass.
- [x] Development Host smoke test, part 1: start Run with AI on a Ready AI card, dismiss the picker, then start it again; the picker reappears.
- [x] Development Host smoke test, part 2: leave a chat-handoff confirmation unanswered until its toast hides, then start the card again; restart is offered, and the restarted run proceeds normally.

## Activity
### 2026-10-31T20:29:36.623Z - Usage Orchestrator chose Anthropic Claude Code CLI
Stage: definition. Anthropic Claude Code CLI reports 52% remaining, resetting 2026-11-02T08:59:00.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-31T20:29:37.351Z - Usage Orchestrator dispatch dispatch-mvwuu6yv-1 started
Card: card-mvwuspy3-1 ("When you start a run with AI session but you don't select the model and then the model selection disappears you can no longer start that card you keep getting an error that the handoff process is already started"). CLI: Anthropic Claude Code CLI. Stage: definition.
Requested model: "opus" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the definition stage: opus.
AI loop stage thinking level rule for the definition stage: max.

### 2026-10-31T20:29:39.430Z - Usage Orchestrator dispatch dispatch-mvwuu6yv-1 model observed
Card: card-mvwuspy3-1. CLI: Anthropic Claude Code CLI. Stage: definition.
Actual model: "claude-opus-5-5" (source: Claude Code stream-json system.init.model; attempt: dispatch-mvwuu6yv-1).

### 2026-10-31T20:33:49.538Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-5.5`, thinking level `high`
- codex: model `gpt-6.1-sol`, thinking level `xhigh`
- claude-code: model `sonnet`, thinking level `high`
- cursor-other: model `claude-opus-5-5-xhigh`

### 2026-10-31T22:09:42.781Z - Usage Orchestrator chose Anthropic Claude Code CLI
Stage: implementation. Anthropic Claude Code CLI reports 52% remaining, resetting 2026-11-02T08:59:00.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-31T22:09:43.640Z - Usage Orchestrator dispatch dispatch-mvwyexg8-2 started
Card: card-mvwuspy3-1 ("When you start a run with AI session but you don't select the model and then the model selection disappears you can no longer start that card you keep getting an error that the handoff process is already started"). CLI: Anthropic Claude Code CLI. Stage: implementation.
Requested model: "sonnet" (source: the card's preferred model; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: sonnet.
Card thinking level: high.

### 2026-10-31T22:09:45.599Z - Usage Orchestrator dispatch dispatch-mvwyexg8-2 model observed
Card: card-mvwuspy3-1. CLI: Anthropic Claude Code CLI. Stage: implementation.
Actual model: "claude-sonnet-5-5" (source: Claude Code stream-json system.init.model; attempt: dispatch-mvwyexg8-2).

### 2026-10-31T22:40:00.000Z - Implementation by Claude Code (claude-sonnet-5-5)
Fix: Run with AI and Fill in with AI now take the per-card lock as a restartable `card` holder, reusing the interview lease/restart mechanism.

- `src/chatHandoff.ts`: new `card` holder kind; `ChatHandoffLease.setProcessRunning`; `ChatHandoffInFlight.processRunning`; `restart` refuses (`started: false`, nothing aborted) while a holder reports a running CLI process.
- `src/cardRunHandoff.ts` (new): `runRestartableCardHandoff` - runs under the lock; when busy it shows the Stop-pointing message if a CLI process runs, the old busy message for non-card holders (AI loop, interview), or offers "Restart" for a pending `card` holder, re-checking after the offer closes.
- `src/runWithAi.ts`: `runCardWithAgentCli` takes a `lease`; it sets process-running only around the actual CLI run, and after the provider resolve, orchestrator probe, Ready auto-start and model-recovery prompt it stops silently (no Activity, no settings/card writes, no notifications, no launch) if the lease was aborted.
- `src/agentCliModelRecoveryUi.ts`: `promptAndApplyModelRecovery` takes the signal and writes no settings after an abort. Dismissing any recovery step already returns undefined before any write.
- `src/extension.ts`: `runRestartableCardRun` wires the restart prompt; both actions check `lease.signal` after the provider pick and chat delivery, pass the signal to `handOffPromptToChat` (so an abandoned delivery leaves the `chatPromptDeliveries` queue), and pass the lease into the CLI run. The AI loop still uses the unchanged `runCardHandoff`.
- Tests: `test/unit/cardRunHandoff.test.ts` (dismissed picker releases lock; pending card holder restart aborts lease; superseded attempt writes nothing and leaves the queue; running CLI refused with no restart offer; process starting during the offer; AI loop/interview holders not restartable), `test/unit/agentCliModelRecoveryUi.test.ts` (each recovery step dismissed writes nothing; aborted attempt writes nothing), additions to `test/unit/chatHandoff.test.ts` and `test/unit/runWithAi.test.ts`. Existing interview restart tests still pass.
- Validation: `npm run compile-tests`, `npm run compile`, `npm test` (1093 pass, 0 fail), `npm run lint` all pass. CHANGELOG `[Unreleased]` updated.

Awaited calls that can stay pending after their UI is gone (identified by code reading, NOT yet reproduced in a Development Host): `src/extension.ts:2506` (`await vscode.window.showInformationMessage(... 'Prompt is present', 'Prompt is missing')`), `src/extension.ts:2525` (`await vscode.window.showWarningMessage(... 'Prompt is pasted')`), and the provider open commands at `src/extension.ts:2483`, `2491`, `2545`. Each holds the card lock (and the shared `chatPromptDeliveries` queue) until it settles.

Not done (needs a person in a Development Host): reproduce the pending call above (criterion 1), and smoke tests parts 1 and 2. Steps:
1. Part 1: F5 Development Host, enable "Run With AI", open a Ready AI card, choose Run with AI, press Escape at the provider picker, run it again; the picker must reappear with no "already in progress" message.
2. Part 2: use a Codex chat target whose automatic verification is unavailable, choose Run with AI and leave "Prompt is present / Prompt is missing" unanswered until the toast hides into the Notification Center; run the card again. A "Restart" / "Wait" warning must appear; choose Restart and confirm the new run proceeds, and that answering the old toast later records nothing. Note which call from the list above was pending, with its line, in this card.
3. Also confirm that while a Run with AI CLI process is running, starting the card again shows the Stop message and no restart offer.
If wanted, I can package and install the working-tree build for this test.

Initially reported as blocked: Development Host reproduction and both smoke tests (criteria 1, 9, 10) needed a person to run them; resolved by the user-reported Development Host confirmations below.

### 2026-10-31T22:15:50.978Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-31T22:16:18.870Z - AI-guided interview started in Codex (ChatGPT)
Opened an interview chat in Codex (ChatGPT). Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-31 - Codex coworking preflight (verified evidence)
- Sources read: this saved card, `AGENTS.md`, `.github/copilot-instructions.md`, the applicable card-authoring, repo-validation and extension-release instructions, `.mwnn/columns.json`, `.vscode/launch.json`, `.vscode/tasks.json`, and the implementation/test files named above. The workspace instructions are accessible and applied. This is an extension-host verification session; implementation is already present and is not being dispatched again.
- Board evidence: `col-mqwk2njn-3` is Implement (`in-progress`), with no WIP limit; this card has no `dependsOn` or schedule. Its Human assignee, column, position and acceptance checkboxes are preserved.
- Verified evidence from current source: `src/extension.ts:2506` awaits the Codex "Prompt is present / Prompt is missing" notification; `src/extension.ts:2525` awaits "Prompt is pasted". These remain code-inspection candidates, not a Development Host reproduction. `src/cardRunHandoff.ts` offers restart for pending card holders and refuses it for a running process or another holder kind; the card actions pass the lease signal through chat delivery.
- Verified evidence from commands: `npm run compile-tests` and `npm run compile` pass. `node --test --test-reporter=dot dist-test/test/unit/cardRunHandoff.test.js dist-test/test/unit/chatHandoff.test.js dist-test/test/unit/runWithAi.test.js dist-test/test/unit/agentCliModelRecoveryUi.test.js` passes, including interview restart coverage. `npm run lint` passes.
- Verification exception: this session's `npm test` rerun exits 1 because a test fixture's `git init` cannot write `.git/config` under the sandbox temporary directory (Permission denied). This does not replace the earlier recorded full-suite pass, and no new full-suite pass is claimed.
- Session summary: criteria 2-8 retain their existing checked state; focused automated evidence was rechecked as above. Criteria 1, 9 and 10 remain open. Native VS Code UI control is unavailable in this session, so Development Host observations require the person. No human smoke-test result or sign-off has been supplied. The existing blocked marker remains unchanged. Next: observe picker dismissal/retry in the Development Host; a working-tree VSIX can also be packaged and installed if requested under the local test-install rule.

### 2026-10-31 - Coworking answer: provider picker smoke test (user-reported)
- Question: "In the F5 Development Host, on a Ready AI card, choose Run with AI, press Escape at the provider picker, then choose Run with AI again: does the picker reappear without the 'already in progress' error?"
- Answer: "Yes" — reported by the user in coworking chat, 2026-10-31. This is human smoke-test confirmation, not independently observed UI evidence.
- Criterion 9 is now checked based on that confirmation. Session summary: criteria 2-9 are met per the saved evidence; criteria 1 (exact pending-call reproduction) and 10 (hidden notification/restart smoke test) remain open. The earlier full-suite sandbox verification exception remains recorded. Assignee, column and existing STATUS lines are unchanged.

### 2026-10-31 - Coworking answer: hidden confirmation offers restart (user-reported)
- Question: "For part 2, start Run with AI using Codex chat and leave 'Prompt is present / Prompt is missing' unanswered until the toast hides, then start the same card again: does it offer Restart?"
- Answer: "Yes" — reported by the user in coworking chat, 2026-10-31. The Development Host observation is user-reported, not independently observed by Codex.
- Source correlation (verified evidence from the source read during preflight): that specific confirmation is awaited at `src/extension.ts:2506`, `const answer = await vscode.window.showInformationMessage(...)`, inside `deliverPromptToChat`. The user's reproduction identifies this notification as still pending after the toast hides; retry offers Restart while the earlier attempt holds the card lease. Criterion 1 is checked based on the human reproduction plus this verified file/line correlation.
- Session summary: criteria 1-9 are met per recorded evidence. Criterion 10 remains unchecked until choosing Restart is confirmed to let the fresh attempt proceed normally. The earlier full-suite sandbox verification exception remains recorded; no new test pass is claimed. Human assignee, column and existing STATUS lines remain unchanged.

### 2026-10-31 - Coworking answer: restarted attempt proceeds (user-reported)
- Question: "After choosing Restart, does the fresh attempt proceed normally without reloading VS Code?"
- Answer: "Yes" — reported by the user in coworking chat, 2026-10-31. This is human Development Host confirmation, not independently observed UI evidence.
- Criterion 10 is checked based on this answer and the preceding restart-offer confirmation. All ten original acceptance criteria are checked. Final verification is resolving the previously recorded sandbox-only full-suite exception before closing the card; assignee and column remain unchanged.

### 2026-10-31 - Coworking closing verification
- Verified evidence: `npm test | Select-Object -Last 12`, rerun outside the sandbox to allow temporary Git fixtures, exits 0: 1093 tests passed, 0 failed, 0 skipped. This resolves the earlier sandbox-only verification exception. Compile-tests, compile, focused handoff tests and lint passed earlier in this session.
- Acceptance review: criterion 1 is supported by the user's hidden-notification reproduction and verified source mapping to `src/extension.ts:2506`; criteria 2-7 by the saved implementation and passing focused tests; criterion 8 by the successful validation commands; criteria 9-10 by the user's explicit Development Host confirmations. Human observations remain labelled user-reported, distinct from verified source and command evidence.
- Closing summary: all ten original criteria are checked; none remain open and no unresolved exception remains. Only this card was edited during coworking; no linked tables or JSON artifacts were changed. The original blocked marker is superseded above. Human assignee, Implement column and position are preserved; no board move or release was performed.
STATUS: DONE
