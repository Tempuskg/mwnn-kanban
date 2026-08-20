---
id: card-mszd3kkh-1
title: "add support for \"gh copilot\" cli"
column: col-mqwk2njn-4
position: -22000
assignee: { kind: ai }
createdAt: 1787099833313
updatedAt: 1787170072525
---

## Description
Extend the existing GitHub Copilot CLI provider so both the AI loop and the per-card **Run with AI** action can launch the current agentic Copilot CLI through GitHub CLI (`gh copilot`) when the standalone `copilot` executable is unavailable. Treat `gh copilot` as an alternate launcher for the same provider, preserving the existing handoff prompt, workspace context, completion evidence, cancellation, and failure handling. This support is for the modern `gh copilot` passthrough command, not the retired `github/gh-copilot` suggestion/explanation extension.

## Acceptance criteria
- [x] Without a configured Copilot path, the existing GitHub Copilot CLI provider prefers an available standalone `copilot` executable and falls back to a supported `gh copilot` command; the provider picker does not show a duplicate Copilot option.
- [x] The `mwnn-kanban.agentCliPaths["copilot"]` override remains highest priority and can identify either a standalone Copilot executable or a GitHub CLI executable, including a full path containing spaces.
- [x] The `gh` launcher receives the `copilot` subcommand, safely forwards the existing non-interactive Copilot flags, receives the complete multi-line MWNN handoff prompt without truncation, and runs from the active workspace root.
- [x] Definition, triage, implementation, and verification handoffs launched through `gh copilot` use the same card-evidence checks and board transitions as handoffs launched through `copilot`.
- [x] A missing `gh`, a `gh` version without the modern `copilot` command, an installation or authentication failure, a start failure, or a nonzero exit produces an actionable error and never falsely completes or advances the card.
- [x] Cancelling an active `gh copilot` handoff terminates the launched process tree and leaves the card and AI loop in the same recoverable state as cancellation of the standalone Copilot CLI.
- [x] Automated tests cover launcher precedence, configured paths, exact command/argument/stdin/cwd construction, successful handoffs, unsupported or missing launchers, unsuccessful exits, and cancellation, including Windows paths with spaces.
- [x] User-facing settings/help documentation explains that the Copilot provider supports both `copilot` and the modern `gh copilot` passthrough, distinguishes it from the retired `gh-copilot` extension, and compilation, focused tests, the full test suite, and lint pass.

## Activity
### 2026-08-19T19:49:18.777Z - Definition requested from Codex (ChatGPT)
Asked Codex (ChatGPT) to fill in the Description and Acceptance criteria for this card.

### 2026-08-19T19:57:00.500Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-08-19T20:04:57.124Z - Codex implementation completed
Added standalone-first Copilot launcher resolution with a validated modern `gh copilot` fallback, shared handoff/error/cancellation behavior, regression coverage, and user-facing documentation. `npm run compile-tests`, `npm run compile`, focused tests, the full 335-test suite, and `npm run lint` all passed.
STATUS: DONE
