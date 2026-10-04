---
id: card-mttembfa-2
title: "When card is in Ready column if user alligns to AI have the card move to In Progress column when done, and if card is done move to Verify column."
column: col-mqwk2njn-4
position: -49000
assignee: { kind: human }
preferredModel.copilot: gpt-5.3-codex
preferredModel.codex: gpt-5.5
preferredModel.claude-code: sonnet
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1788916372822
updatedAt: 1791155205815
---

## Description
Make the board move a card through the flow on its own once a person hands it to AI. Two steps:

1. **Start.** When a card in the Ready column (`role: ready`) gets an AI assignee, either because the user changes its assignee to AI in the board UI (the `setAssignee` message in `src/boardPanel.ts`) or because the user starts an implementation run on it with Run with AI (`runCardWithAgentCli` in `src/runWithAi.ts`), the card moves to the In Progress column (`role: in-progress`, titled "Implement" on this board).
2. **Finish.** When the AI's implementation run ends with `STATUS: DONE`, the card moves to the Verify column. Run with AI already does this through `parkFinishedCardInVerify`: it checks off the criteria, moves the card to Verify and reassigns it to Human. This card keeps that step working for cards that reached In Progress through step 1.

The automatic move follows the same rules as a manual or loop move. It respects the In Progress `wipLimit`. It respects unmet `dependsOn` (a blocked card cannot advance past Ready). It goes through the Ready reverse-WIP admission check that the loop uses (`canAdvanceIntoColumn` / `canStartImplementation` in `src/boardLoop.ts`). If the move is refused, the card stays in Ready with its AI assignee, and the reason is logged in Activity instead of being dropped silently. Cards outside Ready, and assignee changes to Human or to nobody, do not move automatically.

## Acceptance criteria
- [x] Setting the assignee of a Ready-column card to `{ kind: ai }` from the board moves it to the end of the In Progress column, and a dated Activity entry records the automatic move.
- [x] Starting an implementation run with Run with AI on a Ready-column card moves it to In Progress before the agent is dispatched. A definition run (`kind: 'definition'`) does not move the card.
- [x] When the In Progress column is at its `wipLimit`, when the card has unfinished `dependsOn` cards, or when Ready reverse-WIP admission refuses the start, the card stays in Ready, keeps its AI assignee, and gets an Activity entry giving the reason. No error is thrown and no state goes inconsistent.
- [x] Assigning AI to a card in any column other than Ready (Backlog, In Progress, Verify, Done, custom) does not change its column. Assigning Human or clearing the assignee on a Ready card does not move it either.
- [x] A card moved to In Progress by this feature, whose implementation run ends with `STATUS: DONE`, ends up in the Verify column (role `verify`, or a custom column whose title contains "Verify") with its criteria checked and its assignee set to Human. If there is no Verify column, or Verify is at its WIP limit, the card stays in In Progress, which matches the current park behavior.
- [x] A run that does not finish (`STATUS: BLOCKED`, cancelled, failed) leaves the card in In Progress.
- [x] The automatic move is written through the board store (`moveCard`), so the card file's `column`/`position` frontmatter is updated on disk and the open board reloads to show the new column.
- [x] Unit tests cover: assign-to-AI from Ready moves the card; a WIP or dependency refusal keeps it in Ready; non-Ready columns and non-AI assignees are left alone; the Run with AI start move followed by the DONE → Verify park. `npm run compile-tests`, `npm test` and `npm run lint` pass.
- [x] Development Host smoke test: in the board webview, assigning AI to a Ready card shows it in Implement right away, and finishing a Run with AI implementation shows it in Verify.

## Activity
### 2026-10-04T22:48:25.082Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-04T22:49:24.216Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `gpt-5.3-codex`, thinking level `high`
- codex: model `gpt-5.5`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`

### 2026-10-04T22:51:07.593Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-04T23:05:00.000Z - Claude Code: implemented Ready auto-start
- Added `autoStartAiCardFromReady` in src/boardLoop.ts. It moves an AI-assigned Ready card to the end of the In Progress column through `moveCard` and logs "Auto-started in <column>". It uses the loop's admission rules: unfinished `dependsOn`, the In Progress WIP limit, and Ready reverse-WIP admission (`canStartImplementation` now shares `describeImplementationAdmission`). When a rule refuses the move, the card stays in Ready with its AI assignee and gets an "Auto-start held in Ready: <reason>" entry. Other columns, Human or unassigned cards, and boards with no In Progress column are left alone.
- src/boardPanel.ts: the `setAssignee` handler calls the auto-start when the new assignee is AI.
- src/runWithAi.ts: an implementation run on a Ready card first assigns the card to AI and moves it to In Progress (refreshing the board), then dispatches. A refused move still runs the card. Definition runs do not move cards. The existing DONE park moves the card to Verify; BLOCKED, cancelled, or failed runs leave it in In Progress.
- Tests: new test/unit/readyAutoStart.test.ts, plus 4 Run with AI cases in test/unit/runWithAi.test.ts. `npm run compile-tests`, `npm test` (594/594), `npm run lint` and `npm run compile` pass.
- Not done: the Development Host smoke test needs a person to try it in the board webview. Only the CLI Run with AI path auto-starts. The chat-extension Run with AI handoff in src/extension.ts is unchanged.
- Model: the card prefers `sonnet`, but this session could not switch models, so it ran on Claude Opus 5.5 (`claude-opus-5-5`).
STATUS: BLOCKED: Development Host smoke test (assign AI to a Ready card -> Implement; finish a Run with AI implementation -> Verify) needs a human

### 2026-10-04T23:05:03.000Z - Codex: remaining Development Host smoke test passed
- Continued only the previously unverified Development Host criterion. Launched the current repository bundle in an actual VS Code Extension Development Host against the isolated `.vscode-test/ready-auto-start-smoke` workspace, using Ready reverse-WIP 3, Implement WIP limit 1, and a custom Verify column matching this board's roles.
- In the board webview, changed `Assign AI smoke` from Human to AI. The card immediately appeared in Implement; its on-disk frontmatter changed to `column: col-smoke-implement` and Activity recorded `Auto-started in Implement`.
- Clicked the card's Run with AI action and selected the Claude Code CLI provider configured to a controlled local fixture. The real subprocess verified that the card was in Implement when dispatched. After the fixture appended `STATUS: DONE` and exited, the webview displayed the card in Verify with Human and Done badges. The saved card had `column: col-smoke-verify`, a checked acceptance criterion, `assignee: { kind: human }`, and `Run with AI parked in Verify` Activity.
- This smoke test exercised the actual webview, extension host, CLI launch, filesystem persistence, and completion handling. CLI completion was simulated locally; no live AI service was called. Evidence: `.vscode-test/ready-auto-start-smoke/evidence.json` and `card-smoke-assign-dispatch.json`.
- Validation passed: `npm run compile-tests`, `npm run compile`, `node --test --test-reporter=dot dist-test/test/unit/readyAutoStart.test.js dist-test/test/unit/runWithAi.test.js` (46 tests), `npm test` (594/594), and `npm run lint`.
- Checked the last acceptance criterion and moved this card to Verify, assigned to Human for review. The prior smoke-test blocker is resolved.
STATUS: DONE
