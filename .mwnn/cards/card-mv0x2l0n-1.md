---
id: card-mv0x2l0n-1
title: When running usage orchestrator have the selected model name logged
column: col-mqwk2njn-4
position: -62000
assignee: { kind: human }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.claude-code: opus
preferredModel.cursor: Claude Opus 5.5
thinkingLevel.copilot: high
thinkingLevel.claude-code: xhigh
createdAt: 1791547410407
updatedAt: 1791583489775
---

## Description
Extend Usage Orchestrator dispatch reporting so both card Activity and the MWNN Agent CLI output identify the chosen CLI, stage, requested model and its source, and the actual model used. Cover every AI Loop stage and individual Run Card with AI handoffs, including replacement CLIs and escalated retries.

For Copilot, Codex, Claude Code, and Cursor Agent, discover the actual model from authoritative startup/session metadata or supported CLI introspection. This includes internally selected defaults when no model argument is supplied, and concrete models behind aliases or automatic selection when exposed. Record discoveries as they become available, distinguishing requested values from observed models. If the installed CLI cannot expose a name, record a specific unavailable reason and let the work proceed. Preserve existing usage ranking, model-selection precedence, prompts, cancellation, and card-file completion evidence.

## Acceptance criteria
- [x] Each orchestrated dispatch attempt records its timestamp, card identity, CLI, stage, and model information in both card Activity and MWNN Agent CLI output; the existing selection rationale and usage ranking remain available.
- [x] An explicitly selected model is logged exactly as passed to the chosen CLI, with its source (card override, stage preference, provider default, or escalation). Requested names, aliases, and rejected or unapplied selections are distinguished from a confirmed actual model.
- [x] Provider-specific discovery is implemented for Copilot, Codex, Claude Code, and Cursor Agent using authoritative CLI/session evidence. A run with no configured model logs the concrete model name when the installed CLI exposes it; aliases and automatic selection likewise report the concrete name when exposed. Discovery sources and any provider/version limitations are documented.
- [x] A discovered model is recorded in both destinations as soon as the evidence becomes available, including metadata emitted during startup or at completion. Each discovery identifies its source and dispatch attempt; reported model changes within an attempt are attributed to that same attempt.
- [x] Unsupported discovery, missing or malformed metadata, timeouts, and cancellation produce an explicit actual-model-unavailable reason rather than a guessed name. Additional introspection is bounded and cancellable; discovery failure alone does not fail, delay indefinitely, or advance the card, and does not overwrite a known requested model.
- [x] Re-ranking, credit fallback, and model escalation report the model for each new attempt without reusing another CLI or attempt's metadata. Skipped CLIs and processes that never start are not reported as having used a model; existing secret redaction, prompt delivery, and completion evidence remain intact.
- [x] Focused automated tests cover all four provider discovery adapters, configured and CLI-default models, alias/automatic selection, delayed and chunked metadata, unavailable or malformed metadata, timeout/cancellation, rejected selections, and provider switches or escalated retries. Tests verify matching Activity/output records and unchanged dispatch outcomes when discovery fails.
- [ ] A Development Host smoke test exercises Usage Orchestrator through the AI Loop and Run Card with AI, using at least two installed CLIs and both an explicit model and a CLI-default model. Activity and MWNN Agent CLI output agree with authoritative model evidence; any discovery limitation is visibly explained.

## Activity
### 2026-10-09T12:04:09.393Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-10-09T12:33:36.081Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-5.5`, thinking level `high`
- codex: model `gpt-6.1-sol`, thinking level `max`
- claude-code: model `opus`, thinking level `xhigh`
- cursor: model `Claude Opus 5.5`

### 2026-10-09T12:38:58.496Z - Usage Orchestrator chose OpenAI Codex CLI
Stage: implementation. OpenAI Codex CLI reports 99% remaining, resetting 2026-10-16T12:19:08.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-09T12:38:58.997Z - OpenAI Codex CLI implementation handoff started
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.
Card preferred model: gpt-6.1-sol.
Card thinking level: max.

### 2026-10-09T12:39:03.739Z - OpenAI Codex CLI implementation handoff failed
OpenAI Codex CLI rejected the card's preferred model "gpt-6.1-sol": ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account."}}. The card was not advanced; set a model name OpenAI Codex CLI accepts on the card, or clear the card's preferred model to use that CLI's default.

### 2026-10-09T14:00:27.937Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-10-09T14:28:05Z - Usage Orchestrator model reporting implemented
Added per-attempt requested/actual model reporting to card Activity and MWNN Agent CLI output, with isolated provider discovery for Copilot, Codex, Claude Code, and Cursor Agent. Added bounded Codex rollout lookup, unavailable reasons, discovery documentation, and focused tests for defaults, aliases, metadata changes, fallback and escalation attempts, and discovery failures.

Validation passed: `npm run compile-tests`, `npm run compile`, focused model-discovery/handoff/orchestrator tests, `npm test` (720 tests), and `npm run lint`.

Development Host smoke remains unverified. The available CUA bridge reported no desktop apps and does not expose native app methods (`cua.getApp` and `cua.listApps` are unavailable). Manual smoke steps: open this workspace in VS Code and press F5; run **Run Card with AI** with Usage Orchestrator on a test card with an explicit model; run the AI Loop with Usage Orchestrator on a second card with no card, stage, or workspace model configured; exercise a second installed CLI. Compare each attempt's Activity and MWNN Agent CLI output against the CLI's startup/session model evidence. A local VSIX can be packaged and installed for that test if needed.

STATUS: BLOCKED: Development Host smoke test needs a human with VS Code desktop access.

### 2026-10-09T17:16:53Z - Local VSIX packaged and installed
Packaged the working tree as `mwnn-kanban-usage-model-smoke-20261009.vsix` (version 0.0.15) with the declared `@tempuskg/mwnn-kanban-pro` runtime files, then installed it through the VS Code CLI. Verified the VSIX contains the Pro package manifest, runtime entry point, and four runtime media assets; restored the workspace dependency junction after packaging.

The Development Host smoke test remains outstanding. Reload VS Code and exercise the AI Loop and Run Card with AI using two installed CLIs, both explicit and CLI-default models, then compare card Activity and MWNN Agent CLI output with CLI/session evidence.

STATUS: BLOCKED: Development Host smoke test still needs a human to run it in the VS Code desktop.

### 2026-10-09T17:21:37.306Z - Usage Orchestrator chose OpenAI Codex CLI
Stage: verification. OpenAI Codex CLI reports 89% remaining, resetting 2026-10-16T12:19:08.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-09T17:21:38.109Z - Usage Orchestrator dispatch dispatch-mv18fp6l-1 started
Card: card-mv0x2l0n-1 ("When running usage orchestrator have the selected model name logged"). CLI: OpenAI Codex CLI. Stage: verification.
Requested model: "gpt-6-luna" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started OpenAI Codex CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the verification stage: gpt-6-luna.
AI loop stage thinking level rule for the verification stage: max.

### 2026-10-09T17:21:47.468Z - Usage Orchestrator dispatch dispatch-mv18fp6l-1 actual model unavailable
Card: card-mv0x2l0n-1. CLI: OpenAI Codex CLI. Stage: verification.
Actual model unavailable: the CLI rejected the requested model before reporting a model that it used. The requested model selection, if any, remains recorded separately. Attempt: dispatch-mv18fp6l-1.

### 2026-10-09T17:21:48.083Z - OpenAI Codex CLI verification handoff failed
OpenAI Codex CLI rejected the AI loop stage model rule for the verification stage "gpt-6-luna": {"type":"item.completed","item":{"id":"item_1","type":"error","message":"Model metadata for `gpt-6-luna` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."}}. The card was not advanced; set a model name OpenAI Codex CLI accepts for "verification" / "codex" in mwnn-kanban.agentCliStageModels, or remove that CLI's stage entry to fall back to mwnn-kanban.agentCliModels and the CLI's default.

### 2026-10-09T17:21:49.378Z - AI loop handed verification to Human
The card remains in Verify and was reassigned to Human.
Why: The AI verification hand-off could not be started.
Verification focus: Investigate this specific AI-verification result before sign-off: The AI verification hand-off could not be started.
Human verification procedure:
1. Independently verify every acceptance criterion against the current workspace; do not rely only on the AI's completion claim.
2. Review the implementation and all existing Activity context, then run every relevant automated check and every applicable manual or visual check.
3. Record each check performed and its result in Activity, with concrete evidence for the corresponding acceptance criterion.
4. Move the card to Done only when every acceptance criterion passes.
5. If any criterion fails or cannot be verified, leave the card in Verify and document the failed or unverified criteria, evidence, and required follow-up in Activity.
