---
id: card-muyrib7f-2
title: Run and resume Human card interviews one question at a time
column: col-mqwk2njn-4
position: -64000
assignee: { kind: human }
createdAt: 1791417134139
updatedAt: 1791635835030
dependsOn: [card-muyrib7f-1]
---

## Description
After the companion card adds the saved interview choice, make running an interview-enabled Human card open an interactive AI conversation. Expose "Start interview" in card details and the board card actions, and support starting again from saved progress. The card stays assigned to Human throughout; ordinary Human cards retain their existing manual workflow.

Use the existing interactive chat provider handoff and per-card duplicate-dispatch guard in src/extension.ts and src/chatHandoff.ts. Build a dedicated interview prompt alongside the card prompts in src/aiCards.ts, including the exact workspace/card path. The current runCardWithAISelection only accepts AI cards and offers both chat and headless CLI execution; an interview needs an interactive provider where the user can reply. Do not send it through the implementation CLI/AI-loop route, which can change the assignee and check acceptance criteria on completion. Keep interview cards outside unattended AI-loop dispatch.

The prompt must read the saved card, linked sources and applicable repository-local AI instructions before asking anything. Reuse recorded answers, identify the next unresolved item, split multipart questions, ask exactly one question and wait for the answer. After each answer, append its source and date to Activity, update only the relevant linked fact/baseline artifacts, and reread the saved changes before asking the next question. Distinguish zero, none, unknown and an explicit skip; do not fill missing answers by inference. Ask for system names and owners instead of credentials, account numbers or customer records. Preserve unrelated facts and historical Activity. A restarted chat resumes from these durable records without requiring a provider-specific conversation id.

Before declaring the interview complete, compare the original acceptance criteria with the recorded answers, reread changed artifacts, check agreement between linked tables and parse any changed JSON. Unknown or skipped items satisfy criteria only when the criteria allow them. Keep unresolved exceptions explicit and distinguish user-reported information from verified evidence. Apply the repository's normal verification, dependency and column/WIP rules before any status transition. A successful launch alone is never evidence of completion.

Design reference: E:/101245880sasktatchewanltd/CLAUDE.md, "Fact-card interviews" and "Completion". Ship the procedure in MWNN's reusable interview prompt; using the feature must not require that sibling repository.

## Acceptance criteria
- [x] A defined Human card with the saved interview choice exposes a working Start interview action; the host rereads current eligibility, retains Human ownership and prevents duplicate launches or accidental re-dispatch of a completed card.
- [x] Launch offers supported interactive chat providers and delivers the interview prompt through the existing handoff flow; cancellation, no available provider or delivery failure produces actionable feedback without recording a successful start or changing completion state.
- [x] The interview prompt carries the exact card/workspace paths, respects local AI instructions, reuses saved answers, asks one unresolved question at a time and waits for each reply.
- [x] Each reply is recorded with source/date and reflected in the relevant linked facts before the next question; a new chat resumes from saved progress and preserves distinct zero/none/unknown/skip answers and unrelated content.
- [x] Completion instructions require acceptance evidence and focused artifact validation, preserve unresolved exceptions and honor required human verification; chat launch or an implementation terminal marker cannot bulk-check criteria or finish the interview card.
- [ ] Focused prompt/dispatch tests cover eligible and ineligible cards, cancellation/failure, duplicate launch, partial progress and completion safeguards; a Development Host smoke test demonstrates two answers followed by close/reopen/resume, with ordinary AI runs and the unattended AI loop still behaving as before.

## Activity
### 2026-10-09T22:12:20.546Z - AI loop advanced this card
Moved to "Ready".

### 2026-10-09T22:20:36.553Z - AI loop advanced this card
Moved to "Implement".

### 2026-10-09T22:20:39.966Z - Usage Orchestrator chose Anthropic Claude Code CLI
Stage: implementation. Anthropic Claude Code CLI reports 56% remaining, resetting 2026-10-10T01:20:00.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-09T22:20:40.619Z - Usage Orchestrator dispatch dispatch-mv1j49pn-2 started
Card: card-muyrib7f-2 ("Run and resume Human card interviews one question at a time"). CLI: Anthropic Claude Code CLI. Stage: implementation.
Requested model: "opus" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: opus.
AI loop stage thinking level rule for the implementation stage: medium.

### 2026-10-09T22:20:42.621Z - Usage Orchestrator dispatch dispatch-mv1j49pn-2 model observed
Card: card-muyrib7f-2. CLI: Anthropic Claude Code CLI. Stage: implementation.
Actual model: "claude-opus-5-5" (source: Claude Code stream-json system.init.model; attempt: dispatch-mv1j49pn-2).

### 2026-10-09 - Claude Code: Start interview implemented
Added the AI-guided interview run path. `src/aiCards.ts`: `findInterviewCardSelection` (eligible only for a defined Human card with `interview: true` outside a done column), `describeInterviewIneligibility`, the reusable `buildCardInterviewPrompt` (exact workspace root + card path; reads card, linked sources and local AI instructions first; reuses recorded answers; one question per message and waits; records each answer with source/date in Activity and only the relevant linked artifacts; rereads before the next question; keeps zero/none/unknown/skipped distinct with no inference; asks for system names/owners, never credentials; resumes from files with no conversation id; completion needs per-criterion evidence, no bulk-checking, JSON/table validation, explicit exceptions, user-reported vs verified, human sign-off and repo verification/WIP rules; no STATUS marker) and `formatInterviewStartEntry`. New `src/cardInterview.ts` `startCardInterview` runs under the shared per-card in-flight guard, rereads saved state before and after the chat picker, offers interactive chat providers only (never CLI/AI loop), and appends a start note only after delivery succeeds; cancel / no provider / delivery failure give feedback and change nothing. Host wiring in `src/extension.ts` (`startCardInterviewSelection`, `pickInterviewChatProvider`), `src/boardPanel.ts` and the `startCardInterview` message in `src/types.ts`; webview `media/board.js` shows a "Start interview" card action and details-footer button. Also fixed the clipboard-only chat hand-off path, which reported success without copying the prompt or opening the chat. Human cards stay outside the AI loop (covered by a test).
Tests: `test/unit/cardInterviewRun.test.ts` (eligibility incl. done/AI/undefined/missing, protocol, prompt content, launch keeps Human/criteria, cancel/unavailable/failure, re-read after picker, duplicate launch, partial-progress resume, AI loop untouched). `npm run compile-tests`, `npm run compile`, `npm test` (773/773), `npm run lint` all green.
Remaining: Development Host smoke test. Steps: F5 a Development Host; open a defined Human card with "AI-guided interview" checked in a non-Done column; click Start interview (card action or details footer), pick Claude Code/Copilot/Codex; answer two questions and confirm both are appended to Activity with source/date; close the chat, click Start interview again and confirm it resumes at question three without re-asking; confirm assignee stays Human and no criteria are checked; confirm Run with AI on an AI card and the AI loop still behave as before.
STATUS: BLOCKED: Development Host smoke test (two answers, close/reopen/resume) needs a human

### 2026-10-09T23:49:47.459Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-09 - Interview Q1: prior smoke-test steps
Q: Apart from this interview chat, have any Development Host smoke-test steps (two answers, close, reopen, resume) already been performed, and which?
A: none (no smoke-test steps performed outside this chat).
Source: reported by the card's human owner in interview chat, 2026-10-09. User-reported, not verified evidence.

### 2026-10-09 - Interview Q2: launch environment
Q: Was this interview chat opened via Start interview from a Development Host (F5) window or from an installed build of the extension?
A: installed build.
Source: reported by the card's human owner in interview chat, 2026-10-09. User-reported, not verified evidence.

### 2026-10-09 - Interview Q3: smoke-test environment decision
Q: Does a smoke test performed in the installed build count toward the "Development Host smoke test" criterion, or must it be repeated in an F5 Development Host?
A: installed build counts and replaces F5.
Source: decided by the card's human owner in interview chat, 2026-10-09. User-reported decision.
Smoke-test progress: two answers (Q1, Q2) recorded in this chat with source/date. Next step: close this chat, click Start interview again, and confirm the new chat resumes at the next unresolved item without re-asking Q1-Q3.

### 2026-10-09 - Interview paused for close/reopen resume check
Criteria met: 1-5 (checked earlier from implementation evidence; unchanged by this interview).
Criterion 6 remains open. Focused tests are verified evidence (773/773 per the implementation entry above). Smoke test: two answers recorded (user-reported), and the human owner accepted the installed build in place of F5. Still to do: close/reopen/resume, plus confirming that ordinary Run with AI and the unattended AI loop behave as before.
Unresolved exceptions: none. No criteria checked and no column or assignee change in this session.

### 2026-10-09T23:53:11.849Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-09 - Interview resumed after close/reopen
This chat was opened by Start interview after the pause above. It resumed from the saved card file alone: Q1-Q3 and the installed-build decision were read from Activity and not re-asked; the next unresolved item is whether ordinary Run with AI and the unattended AI loop still behave as before. The resume is observed by this chat; the human owner has not yet confirmed it.

### 2026-10-09 - Interview Q4: ordinary Run with AI regression check
Q: In the installed build, have you used Run with AI on an ordinary AI-assigned card since this feature went in, and did it behave as before (same chat/CLI provider choice, card handled the same way on completion)?
A: Yes.
Source: reported by the card's human owner in interview chat, 2026-10-09. User-reported, not verified evidence.
