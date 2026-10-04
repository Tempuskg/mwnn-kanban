---
id: card-mushzfv3-1
title: Upgrade GitHub Actions off deprecated Node 20
column: col-mqwk2njn-3
position: 1000
assignee: { kind: ai }
createdAt: 1791038340111
updatedAt: 1791038411178
---

## Description
The v0.0.13 release run (Actions run 37130023405) warned that Node.js 20 is deprecated on GitHub Actions runners: `actions/checkout@v4`, `actions/setup-node@v4`, and `actions/upload-artifact@v4` target Node 20 and are being forced onto Node 24. Bump these actions (and `actions/download-artifact@v4`) to their current major versions that run on Node 24 in `.github/workflows/ci.yml` and `.github/workflows/release.yml`. Also decide whether `node-version: 20` used for build/test should move to a supported LTS (22 or 24) and confirm the extension build and tests still pass on it.

## Acceptance criteria
- [x] `ci.yml` and `release.yml` use action majors that run on Node 24 (checkout, setup-node, upload-artifact, download-artifact)
- [x] `node-version` in both workflows is a supported LTS, or the reason for keeping 20 is recorded in Activity
- [ ] A CI run on the change completes with no Node 20 deprecation annotation
- [ ] Release workflow still packages one VSIX and publishes it to both VS Marketplace and Open VSX (verified on the next release or a dry run)

## Activity
### 2026-10-03T14:40:11.013Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-03 Claude Code
Bumped actions in `.github/workflows/ci.yml` and `release.yml` to Node 24 majors: checkout@v7, setup-node@v7, upload-artifact@v7, download-artifact@v8 (verified each `action.yml` declares `using: node24`). Moved `node-version` 20 -> 24 (LTS) in both workflows; locally on Node 24.11 `npm run compile-tests`, `npm run compile`, `npm test` pass (562/562). `package.json` engines left unchanged (extension still supports Node 20+ at runtime; only CI moved).
Unmet (need a pushed CI run / next release): no-deprecation-annotation check, and the dual-registry publish verification; both criteria left unchecked.
STATUS: BLOCKED: remaining two criteria require a pushed CI run and a release/dry run, which can't be done from this workspace
