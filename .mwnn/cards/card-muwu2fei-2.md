---
id: card-muwu2fei-2
title: Read GitHub Copilot remaining usage for the usage orchestrator
column: col-mqwk2njn-2
position: 3000
createdAt: 1791300499578
updatedAt: 1791300499578
dependsOn: [card-muwsfaoh-1]
---

## Description
Feed GitHub Copilot's quota into the usage-snapshot contract from
`card-muwsfaoh-1`, so the orchestrator ranks Copilot by its real remaining
usage and reset date instead of the averaged value it gets as an "unknown" CLI.

Documented source: the Copilot SDK's `account.getQuota` returns the remaining
percentage and reset date
(https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing).
`/usage` shows session consumption only, so it is not the remaining-allowance
signal. The SDK talks to the locally installed Copilot CLI; whether reading the
quota needs a new runtime dependency, and its bundling and package-size impact,
is decided as part of this card.

## Acceptance criteria
- [ ] A Copilot usage source returns the snapshot contract (remaining percentage and reset date) from `account.getQuota`, through the locally installed Copilot CLI resolved the same way as dispatch (honoring `mwnn-kanban.agentCliPaths`).
- [ ] A quota reported as unlimited is treated as 100% remaining with no reset time.
- [ ] Not signed in, an unsupported CLI version, missing fields, a malformed or hostile response, an error, or a timeout yields "unknown" with a reason, never an error or a failed dispatch, and any started process or session is closed within the timeout.
- [ ] The extension makes no direct network requests; any new runtime dependency is bundled by the existing build and included in the packaged VSIX.
- [ ] README documents the Copilot source alongside the Codex source.
- [ ] `node:test` coverage over `dist-test/` uses fixture responses for a normal quota, an unlimited quota, a missing reset date, a signed-out account, and malformed input.
- [ ] `npm run compile-tests`, `npm test`, `npm run compile`, and `npm run lint` pass, and a Development Host smoke test shows Copilot ranked by reported (not imputed) usage.

## Activity
