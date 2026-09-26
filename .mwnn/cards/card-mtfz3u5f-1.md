---
id: card-mtfz3u5f-1
title: Add Rabbit  for PR requests
column: col-mqwk2njn-4
position: -35000
assignee: { kind: human }
createdAt: 1788104256099
updatedAt: 1790434954433
---

## Description
Configure Rabbit as the designated handler for pull-request (PR) requests. The slice covers the supported intake and routing path, plus the acknowledgement and status signals needed to show whether Rabbit received, completed, or could not process a request.

## Acceptance criteria
- [x] Rabbit is declared as the owner or handler for PR requests in the supported workflow configuration.
- [ ] Submitting a PR request through the supported intake path assigns it to Rabbit and preserves the request details.
- [ ] The requester can see an acknowledgement and a final completed, blocked, or failed status for the request.
- [ ] Invalid or unprocessable PR requests are surfaced with an actionable reason instead of being silently dropped.
- [ ] Repeatable verification covers successful routing and at least one blocked or failed request, and existing non-PR request routing remains unchanged.

## Activity
### 2026-08-30T15:47:35.726Z - Anthropic Claude Code CLI definition handoff started
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.

### 2026-09-12T15:43:37.491Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-09-12T15:44:48.815Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-09-12T15:53:03.027Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-09-12 - Codex implementation preflight
Confirmed the card is in Implement and has no prior completion evidence. Read the repository instructions and inspected PR CI and AI handoff routing. No Rabbit integration exists yet; checking CodeRabbit's supported repository configuration and intake/status behavior before implementing the unmet criteria.

### 2026-09-12 - CodeRabbit configuration verified
Interpreted Rabbit as CodeRabbit for GitHub PR reviews. Added `.coderabbit.yaml` with automatic review routing, visible progress/skipped reasons, failure reporting, and summaries in walkthrough comments. Validated the file against CodeRabbit's published Draft 2020-12 JSON schema. Added the supported intake, recovery actions, and repeatable live success/draft-blocked verification in `CONTRIBUTING.md`. Live acceptance evidence is still outstanding: the repository currently has no open PR, and its sole historical PR has no Rabbit comments.

### 2026-09-12 - Codex local implementation complete; live integration verification blocked
Added the CodeRabbit PR configuration and contributor intake/status/recovery guide, disabled CodeRabbit issue enrichment/planning/automatic labeling to preserve non-PR workflows, and excluded `.coderabbit.yaml` from the VSIX. Existing extension providers, message protocols, and CI remain unchanged.

Validation passed: official CodeRabbit Draft 2020-12 schema validation (including rejection of a wrong boolean type and malformed YAML); `npm run compile-tests`; `npm run compile`; `node --test dist-test/test/unit/runWithAi.test.js dist-test/test/unit/chatHandoff.test.js dist-test/test/unit/boardLoop.test.js` (87 passed); `npm test` (351 passed); `npm run lint`; scoped `git diff --check`.

Only the configuration ownership criterion is checked. The remaining criteria require observed GitHub App behavior: receipt, preserved request details, completion, and an actionable skipped/failed outcome. Local schema and regression checks do not establish those facts. The read-only GitHub check found only closed PR #1, with no Rabbit comments; App installation/access could not be established. No live PR or review-request comment was submitted. A repository administrator must confirm/enable CodeRabbit access to `Tempuskg/mwnn-kanban`, then run or authorize the disposable-PR verification documented in `CONTRIBUTING.md`. Record the PR URL, head SHA, and Rabbit responses here before checking the remaining criteria. No extension/webview behavior changed, so a Development Host smoke test was not required for the local configuration change.

STATUS: BLOCKED: Need repository administrator confirmation of CodeRabbit App access and live PR verification of successful and blocked review requests.

### 2026-09-19 - CodeRabbit repository setup reported
The MWNN Kanban repository was added to CodeRabbit. Live PR verification remains outstanding: confirm the app is active for this repository and record a successful review request plus a blocked or failed request with their PR URLs and Rabbit responses before checking the remaining criteria.
