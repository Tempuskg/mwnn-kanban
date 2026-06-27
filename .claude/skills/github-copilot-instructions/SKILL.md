---
name: github-copilot-instructions
description: "Imported repository guidance from .github/copilot-instructions.md. Use when working in this repository and the original guidance is relevant."
---

Follow this imported repository guidance from `.github/copilot-instructions.md` when the task overlaps with its original scope.

## Instructions
- Treat the guidance below as repository-specific instructions for this project.
- Apply it together with higher-priority system, developer, and repo instructions already in effect.
- Preserve the intent of the source guidance while adapting it to the current task.

## Imported guidance

See `.github/copilot-instructions.md` for the full MWNN Kanban project overview, AI execution rules, language/build, code style, architecture patterns, file organization, testing, commands, and commit/PR conventions. Key points:

- VS Code extension in TypeScript (strict mode), bundled with webpack, published as `darrenjmcleod.mwnn-kanban`.
- Distinguish extension-host (Node + `vscode`) from webview (DOM) surfaces; they communicate only via `postMessage` against a shared discriminated-union message protocol.
- Use factory functions + `Deps` injection, discriminated unions, and type guards for runtime validation of persisted/posted data.
- End every implementation reply with `Status`, `Changed files`, `Commands run`, `Results`, `Blockers`, `Unverified`, and `Next step`.
- Default to PowerShell on Windows; omit absent optional keys under strict optional-property typing.
