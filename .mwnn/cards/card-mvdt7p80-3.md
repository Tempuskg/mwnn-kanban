---
id: card-mvdt7p80-3
title: "in interview mode don't ask questions you can answer or do yourself. it is more than an interview, more like a coworking session."
column: col-mqwk2njn-4
position: -82000
assignee: { kind: human }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6.1-sol
preferredModel.claude-code: sonnet
preferredModel.cursor: auto
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1792326990960
updatedAt: 1792340749794
---

## Description
Make the AI-guided interview on Human cards work like a coworking session instead of a questionnaire. Right now `buildCardInterviewPrompt` in src/aiCards.ts tells the agent to "ask, listen and record" and to "not implement the work". As a result it asks the person things it could find out from the workspace, and it asks them to do steps the agent could do itself. Change the prompt so that, for each unresolved item, the agent first tries to answer it from the card, the linked artifacts, the repository, and read-only commands, and does any in-scope workspace step it can do safely (look something up, draft, verify, update a linked artifact). It records what it found or did, with the source, as verified evidence. It only asks the person for what needs them: decisions, preferences, approvals or sign-off, knowledge that isn't in the workspace, and anything outward-facing, destructive or hard to undo.

Keep the existing safeguards: one question per message, never invent answers, never ask for credentials or customer records, keep user-reported facts separate from verified ones, never bulk-check criteria, follow the STATUS marker rules, and don't move the card or change its assignee. Also update the "Start interview" tooltip in media/board.js so it describes the new behaviour. Renaming the interview surfaces (the button label, the `startCardInterview` message type, function names, docs) is out of scope.

## Acceptance criteria
- [x] The prompt from `buildCardInterviewPrompt` calls the session a coworking session with the person. Before each question, it tells the agent to try to answer the item itself from the card, the linked artifacts, the repository, and read-only commands, and never to ask for something it can find out on its own.
- [x] The prompt tells the agent to do in-scope, safe workspace steps itself instead of asking the person to do them. Outward-facing, destructive or hard-to-undo actions still need the person's explicit go-ahead first.
- [x] The prompt limits questions to things only the person can supply: decisions, preferences, approval or sign-off, and facts not available in the workspace. When the agent has a finding the person should confirm, it states the finding and its source instead of asking an open-ended question.
- [x] The prompt tells the agent to append a dated Activity entry for every fact it found or step it did, giving the source (file path, command or artifact). Those facts are labelled verified evidence, and answers from the person stay labelled user-reported.
- [x] The existing safeguards are still in the prompt: one question per message; never invent or guess answers; never ask for credentials, passwords, account numbers or customer records; never bulk-check criteria; leave human sign-off to the person; the STATUS: DONE / BLOCKED rules; and no card move or assignee change.
- [x] The "Start interview" button tooltip in media/board.js says the AI does what it can itself and asks only for what it needs from you. The button label and the `startCardInterview` message stay the same.
- [x] test/unit/cardInterviewRun.test.ts asserts the new rules (self-answer before asking, do safe steps yourself, ask only for human-only input, record agent findings with their source as verified evidence). All existing safeguard assertions still pass, updated only where the wording deliberately changed.
- [x] `npm run compile-tests`, `npm run compile`, `npm test` and `npm run lint` pass.
- [x] Development Host smoke test: start an interview on a Human card in a non-done column, where one criterion can be answered from a workspace file and another needs a human decision. The agent looks up the first and records it with its source without asking, and asks one question only for the second.

## Activity
### 2026-10-18T15:59:22.057Z - Anthropic Claude Code CLI definition handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the definition stage: opus.
AI loop stage thinking level rule for the definition stage: xhigh.

### 2026-10-18T16:00:25.658Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-sonnet-5.5`, thinking level `high`
- codex: model `gpt-6.1-sol`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`
- cursor: model `auto`

### 2026-10-18T16:01:57.865Z - Usage Orchestrator chose Anthropic Claude Code CLI
Stage: implementation. Anthropic Claude Code CLI reports 27% remaining, resetting 2026-10-19T08:59:00.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-18T16:01:58.443Z - Usage Orchestrator dispatch dispatch-mve0jx63-1 started
Card: card-mvdt7p80-3 ("in interview mode don't ask questions you can answer or do yourself. it is more than an interview, more like a coworking session."). CLI: Anthropic Claude Code CLI. Stage: implementation.
Requested model: "sonnet" (source: the card's preferred model; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: sonnet.
Card thinking level: high.

### 2026-10-18T16:02:00.900Z - Usage Orchestrator dispatch dispatch-mve0jx63-1 model observed
Card: card-mvdt7p80-3. CLI: Anthropic Claude Code CLI. Stage: implementation.
Actual model: "claude-sonnet-5-5" (source: Claude Code stream-json system.init.model; attempt: dispatch-mve0jx63-1).

### 2026-10-18 Claude Code - implementation
Rewrote `buildCardInterviewPrompt` in `src/aiCards.ts` as a coworking session: new "Do it yourself first" section (self-answer from card, artifacts, repo, read-only commands; do safe in-scope steps; explicit go-ahead for outward-facing/destructive actions; record findings with source as verified evidence) and a narrowed "Asking" section (human-only input, state-finding-and-source for confirmation). Existing safeguards kept. Updated the modal "Start interview" tooltip in `media/board.js` (label and `startCardInterview` unchanged). Added a coworking assertions test in `test/unit/cardInterviewRun.test.ts`; noted the change in `CHANGELOG.md`.
Validation: `npm run compile-tests`, `npm run compile`, `npm test` (812 pass, 0 fail) and `npm run lint` all pass.
Development Host smoke test not run (needs interactive VS Code). Steps: package/install the working-tree build, open a Human card in a non-done column with one criterion answerable from a workspace file and one needing a human decision, click Start interview; expect the agent to look up and record the first with its source without asking, then ask one question only for the second.
Initially reported as blocked: Development Host smoke test (last acceptance criterion) needs a manual run; all other criteria met and checked. Resolved in interview below.

### 2026-10-18T16:08:00.130Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-18 Claude Code - interview: verified evidence check
Verified evidence (checked in interview chat, 2026-10-18): `src/aiCards.ts:499-548` holds the coworking wording ("You are running a coworking session with the person", "## Do it yourself first", self-answer from card/artifacts/repo/read-only commands, record findings with source as verified evidence). `media/board.js:1309` holds the new Start interview tooltip ("The AI does what it can itself and asks only for what it needs from you"). Source: grep of the working tree.
Verified evidence: the interview prompt that opened this chat still used the old wording ("ask, listen and record", "do not implement the work"), so the VS Code instance running the board is not on the working-tree build. The Development Host smoke test therefore has not been run against the change yet. Remaining open criterion: Development Host smoke test (needs the person).

### 2026-10-18 Claude Code - interview: install go-ahead
Question: Package the working-tree build and install it into VS Code (replacing the installed version) for the smoke test? Answer: "Yes" (user-reported, interview chat, 2026-10-18).

### 2026-10-18 Claude Code - interview: working-tree build installed
Verified evidence: packaged the working tree with `npx --yes @vscode/vsce package --out "$env:TEMP\mwnn-kanban-test.vsix"` (22 files, 283.06 KB; archive contains `extension/node_modules/@tempuskg/mwnn-kanban-pro/`) and installed it with `code --install-extension <vsix> --force` (reported successful). The build is version 1.0.2, the same as the current release, plus the uncommitted changes. It was not published and the version was not bumped. Smoke test still pending: it needs the person to reload the window and run it.

### 2026-10-18 Claude Code - interview: smoke-test card drafted
Verified evidence: created throwaway Human card `.mwnn/cards/card-mve0twvm-1.md` in Backlog (`col-mqwk2njn-1`, non-done). It has one criterion answerable from `package.json` (current version) and one that needs a human decision (patch vs minor bump), as the smoke-test criterion requires.

### 2026-10-18 Claude Code - interview: smoke test result and summary
Question: Did the agent look up the version without asking and ask only the patch-or-minor question? Answer: "Yes" (user-reported, interview chat, 2026-10-18).
Corroborating verified evidence: `.mwnn/cards/card-mve0twvm-1.md` Activity shows the agent recorded the version `1.0.2` from `package.json` labelled verified evidence without asking, and then asked one question (patch vs minor), which it recorded as user-reported.
Summary: all nine acceptance criteria are met. Criteria 1-8 are met by the implementation evidence and validation already recorded above, re-checked by grep earlier in this interview. Criterion 9 (Development Host smoke test) is met by the user-reported result plus the smoke-test card's Activity. No unresolved exceptions. Card not moved and assignee unchanged; moving it to Verify/Done is left to the column rules and the person. The throwaway smoke-test card `card-mve0twvm-1` is still on the board.
STATUS: DONE
