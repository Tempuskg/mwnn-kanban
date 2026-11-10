---
id: card-mw8h6jsj-3
title: Fail the release check when node_modules Pro differs from the published package
column: col-mqwk2njn-4
position: -112000
assignee: { kind: ai }
createdAt: 1794181233331
updatedAt: 1794183421196
---

## Description
Free 1.0.10 passed every local test while the shipped VSIX was broken. `node_modules/@tempuskg/mwnn-kanban-pro` held a local build of unreleased Pro changes, still labelled 1.0.5, whereas CI's `npm ci` installed the real published 1.0.5. Local validation therefore tested code that never shipped.

Add a pre-release check, for example a `scripts/` check run before packaging or as part of the release instructions, that compares the installed Pro package with what `package-lock.json` resolves. At minimum it compares the version, and ideally the `dist/index.js` content against the lockfile `integrity` of the published tarball. Then document the check in `.github/instructions/vscode-extension-release.instructions.md`. CI is not affected, since `npm ci` always installs the lockfile tarball.

## Acceptance criteria
- [x] A command exits non-zero when the installed `@tempuskg/mwnn-kanban-pro` does not match the published tarball the lockfile resolves, and exits zero after a clean `npm ci`
- [x] The release instructions say to run it before tagging a release
- [x] It makes no network calls beyond the npm registry fetch that `npm ci` and `npm pack` already make, and needs no token beyond the existing `.npmrc`
- [x] `npm run compile-tests`, `npm test`, and `npm run lint` pass

## Activity
### 2026-11-09T00:10:20.310Z - Usage Orchestrator chose Cursor Agent CLI
Stage: implementation. Cursor Agent CLI reports 71% remaining, resetting 2026-11-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-09T00:10:21.095Z - Usage Orchestrator dispatch dispatch-mw8i8v8n-1 started
Card: card-mw8h6jsj-3 ("Fail the release check when node_modules Pro differs from the published package"). CLI: Cursor Agent CLI. Stage: implementation.
Requested model: "auto" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: auto.

### 2026-11-09T00:10:24.166Z - Usage Orchestrator dispatch dispatch-mw8i8v8n-1 model observed
Card: card-mw8h6jsj-3. CLI: Cursor Agent CLI. Stage: implementation.
Actual model: "Auto" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mw8i8v8n-1).

### 2026-11-08 - Cursor Agent
Added `scripts/check-pro-package.cjs` and `npm run check:pro-package`: compares installed Pro version and `dist/index.js` to the lockfile-resolved published tarball (`npm pack` + integrity). Documented as a before-tag step in `.github/instructions/vscode-extension-release.instructions.md`. Verified exit 0 on current install, exit 1 after tampering `dist/index.js`. `npm run compile-tests`, `npm test` (1121/1121), and `npm run lint` passed.
STATUS: DONE

### 2026-11-09T00:14:12.880Z - MWNN independent verification started

### 2026-11-09T00:14:13.176Z - Cursor Agent CLI implementation handoff failed
Missing or invalid verification inputs. Configure .mwnn/verification.json, with a check mapping for every acceptance criterion, before dispatch.
