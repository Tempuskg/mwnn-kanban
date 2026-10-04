---
id: card-mushzfv3-2
title: Prepare CI workflows for ubuntu-latest moving to Ubuntu 26
column: col-mqwk2njn-4
position: -44000
assignee: { kind: ai }
createdAt: 1791038340111
updatedAt: 1791039181572
---

## Description
The v0.0.13 release run (Actions run 37130023405) warned that the `ubuntu-latest` label migrates to Ubuntu 26 starting 2026-10-19 (actions/runner-images#14748). Every job in `.github/workflows/ci.yml` and `.github/workflows/release.yml` runs on `ubuntu-latest`. Check that install, compile, test, lint, VSIX packaging, and both publish steps work on Ubuntu 26 before the switch, for example with a temporary `ubuntu-26.04` run, or pin to `ubuntu-24.04` if anything breaks.

## Acceptance criteria
- [x] CI jobs have been run on an Ubuntu 26 runner image and pass, or the workflows are pinned to `ubuntu-24.04` with the reason recorded in Activity
- [x] `ci.yml` and `release.yml` use the same runner choice
- [x] Done before 2026-10-19, or the outcome of the first post-migration run is recorded

## Activity
### 2026-10-03T14:45:03.192Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-03 Claude Code - pinned runners to ubuntu-24.04
Replaced all four `runs-on: ubuntu-latest` entries (1 in `ci.yml`, 3 in `release.yml`) with `ubuntu-24.04`, so both workflows use the same runner.
Reason for pinning rather than testing on `ubuntu-26.04`: this session cannot trigger GitHub Actions runs, and the workflow files carry uncommitted edits (checkout/setup-node/artifact action bumps, Node 24) that have not run on any runner yet. Nothing was observed to break on Ubuntu 26; the pin is precautionary so the 2026-10-19 `ubuntu-latest` migration cannot affect releases.
Follow-up: when ready, trial `ubuntu-26.04` in a temporary CI run and move off the pin if it passes. The workflow edits are uncommitted and not pushed.
STATUS: DONE
