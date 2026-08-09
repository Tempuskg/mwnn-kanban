# Copilot Instructions for MWNN Kanban

## Project Overview

MWNN Kanban is a VS Code extension that provides an in-editor Kanban board for managing tasks and work-in-progress. It is written in TypeScript, bundled with webpack, and published under the `darrenjmcleod` publisher. The board UI is rendered in a VS Code webview; board state is persisted to workspace storage and/or a workspace file.

## AI Execution Rules

- Before designing or implementing UI behavior, verify which surface is in play: extension host (Node) code vs. webview (browser) code. They run in separate contexts and communicate only via `postMessage`. Do not assume Node APIs (`fs`, `vscode`) are available inside the webview, and do not assume DOM APIs are available in the extension host.
- Analysis recommendations may target only repository-local AI control files: `AGENTS.md`, `.github/copilot-instructions.md`, and when present `CLAUDE.md`, `*.instructions.md`, `*.prompt.md`, `*.agent.md`, `SKILL.md`, and similar local AI instruction files. For gap-only AI-control-file analysis, compare against the current contents of the relevant local files, not just their paths. If relevant file contents are missing from context, mark the comparison partial. If evidence is insufficient, say so instead of recommending source, test, build, or general documentation changes.
- Every implementation reply must end with: `Status: completed|partial|blocked`, `Changed files`, `Commands run`, `Results`, `Blockers`, `Unverified`, and `Next step`. Use `Status: completed` only when the full in-scope request is done. If any explicitly requested in-scope item remains undone, use `Status: partial` and list the remainder. A no-edit implementation turn must be marked `partial` or `blocked`.
- In `Changed files`, `Commands run`, and `Results`, use literal repo-relative paths and exact commands in backticks. Do not leave empty bullets or rely on editor links.
- Assume strict optional-property typing. Omit absent optional keys instead of passing `undefined`.
- Use plain relative file paths in summaries and handoffs; do not rely on rendered anchor text.
- When public documentation already shows that a supported API or command is unavailable, stop command-id hunting and choose the documented fallback.
- When the user asks about publishing, use the repo's synchronized release flow: build one VSIX and publish that exact artifact to both Visual Studio Marketplace and Open VSX. Never add or use a per-registry selector, and treat a release as incomplete unless both publication jobs succeed. On Windows, default to PowerShell syntax unless the user explicitly asks for `cmd` or bash.
- Do not read unrelated prompt or policy files unless the active task explicitly depends on them.

## Language & Build

- TypeScript with **strict mode** (`strict`, `noImplicitAny`, `noImplicitReturns`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Target: ES2022, module system: Node16.
- Bundled via webpack (`dist/extension.js`). Webview assets bundled separately. Tests compiled to `dist-test/`.
- Node.js 20+, VS Code engine `^1.93.0`.

## Code Style

- Use ES module syntax (`import`/`export`). Prefer Node.js prefixed imports: `import * as fs from 'node:fs/promises'`.
- Import the vscode API as: `import * as vscode from 'vscode'` (extension host only — never in webview code).
- No `any` types without justification. Use `void` operator for intentionally-ignored promise returns.
- Follow ESLint rules: `curly`, `eqeqeq`, `no-throw-literal`; `@typescript-eslint/strict` config.
- Import naming: camelCase or PascalCase only.
- Define the extension-host ⇄ webview message protocol as discriminated-union types in a shared module so both sides type-check against the same contract.

## Architecture Patterns

- **Factory functions** for module initialization: `createBoardStore()`, `createBoardPanel()`, etc.
- **Dependency injection** via `Deps` interfaces (e.g., `BoardStoreDeps`). Factories accept `overrides: Partial<Deps>` for testing.
- **Discriminated unions** for variant types (e.g., webview messages, card states).
- **Type guards** for runtime validation of persisted and posted data (e.g., `isBoardState()`).
- Types centralized in `src/types.ts`; pure utilities in `src/utils.ts`.
- Configuration via `vscode.workspace.getConfiguration('mwnn-kanban')`.
- Persist board state through a single store module; validate on load and migrate older shapes rather than trusting stored JSON.

## File Organization

- `src/` — extension-host source (one module per domain: `boardStore`, `boardPanel`, `webviewMessaging`, etc.)
- `src/webview/` — webview UI source (board rendering, drag-and-drop, no vscode/Node imports)
- `test/unit/` — unit tests (Node.js built-in test runner: `suite()`, `test()`)
- `test/suite/` — integration tests (VS Code extension host)
- `test/fixtures/` — test fixture files
- `media/` — static webview assets (CSS, icons)
- `wiki/` — LLM-maintained project wiki (see `AGENTS.md`)
- `raw/` — immutable source documents

## Testing

- Unit tests use the **Node.js built-in test runner** (`node:test`), not Mocha/Jest.
- Test helpers use factory functions (e.g., `createBoard()`, `createCard()`) to build test data.
- File system tests use `fs.mkdtemp()` with cleanup.
- Run: `npm run compile-tests && npm test`.

## Commands

- `npm run compile` — build the extension
- `npm run compile-tests` — compile tests to `dist-test/`
- `npm test` — run unit tests
- `npm run lint` — ESLint check
- `npm run package` — production bundle

## Commit & PR Conventions

- Commit messages use conventional commit prefixes: `chore:`, `feat:`, `fix:`, `docs:`, `test:`.
- Update `CHANGELOG.md` under the `[Unreleased]` section for user-facing changes.
- Both `npm run lint` and `npm test` must pass before committing.
