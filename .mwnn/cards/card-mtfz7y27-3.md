---
id: card-mtfz7y27-3
title: Add MWNN Portofio dashboard button if user has purchase pro
column: col-mqwk2njn-4
position: -24000
assignee: { kind: human }
createdAt: 1788104447791
updatedAt: 1788126719832
---

## Description
Surface the Pro Portfolio dashboard from the MWNN Kanban sidebar view. Today
`mwnn-kanban-pro.openPortfolio` is only reachable from the command palette and
the "My Work" view title bar (see `package.json` menus, gated on
`mwnn-kanban.hasProLicense`), so licensed users have no obvious way into the
dashboard from the board surface they already use.

Add a "Portfolio" button to the sidebar webview in
[src/sidebarView.ts](src/sidebarView.ts), alongside the existing "Open Board",
"Import plan", and "Run AI loop" buttons. The button is rendered only when a
Pro licence is active (`hasProLicense()` in
[src/pro/upgrade.ts](src/pro/upgrade.ts), the same signal behind the
`mwnn-kanban.hasProLicense` context key); unlicensed users see the sidebar
exactly as it is today, with no extra control and no upsell button. Clicking it
posts a message to the extension host, which executes
`mwnn-kanban-pro.openPortfolio`.

Scope is the sidebar entry point and its licence gating only — no changes to the
Portfolio dashboard itself, and no new Pro features. Follow the existing shape of
this code: keep the presentation decision as pure, unit-testable logic (like
[src/boardButton.ts](src/boardButton.ts)) rather than embedding licence checks in
the webview HTML, and push visibility changes into the live webview via
`postMessage` so the button appears/disappears without reloading the view.

## Acceptance criteria
- [x] The sidebar webview renders a "Portfolio" button styled consistently with the existing secondary sidebar buttons, with a tooltip describing the Pro Portfolio dashboard.
- [x] The button is present only when a Pro licence (or live trial) is active; with no valid licence it is absent/hidden and leaves no empty control or leftover spacing, matching the existing `button[hidden]` handling.
- [x] Clicking the button sends a dedicated sidebar message (e.g. `openPortfolio`) to the extension host, which executes the `mwnn-kanban-pro.openPortfolio` command; the Portfolio dashboard opens.
- [x] The visibility decision derives from the same licence signal that backs the `mwnn-kanban.hasProLicense` context key, so palette/menu availability and the sidebar button never disagree.
- [x] Entering a licence key or clearing it updates the button in the already-open sidebar (via `postMessage`, no window reload or view re-open needed).
- [x] If the Pro module is not loaded so `mwnn-kanban-pro.openPortfolio` is not registered, clicking the button fails gracefully — a user-visible message rather than an unhandled rejection or silent no-op.
- [x] The no-workspace sidebar registration path in [src/extension.ts](src/extension.ts) still constructs without error and shows no broken Portfolio button.
- [x] Unit tests in `test/unit` cover the pure visibility/label logic (licensed → shown, unlicensed → hidden) and the sidebar message routing to `mwnn-kanban-pro.openPortfolio`; `npm run lint` and the test suite pass.
- [x] No secrets, licence keys, or licence payloads are exposed to the webview — only a boolean/mode value crosses the boundary.
- [x] README and CHANGELOG note the new Pro-only sidebar Portfolio button.

## Activity
### 2026-08-30T15:41:29.999Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-08-30T15:49:06.344Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-08-30T16:20:00.000Z - Implemented by Claude Code
Added a Pro-gated "Portfolio" button to the MWNN Kanban sidebar webview.

- New `src/portfolioButton.ts`: pure, vscode-free logic — `portfolioButtonMode({licensed})`
  (`visible`/`hidden`), the label/tooltip/`OPEN_PORTFOLIO_COMMAND` constants, and
  `openProPortfolio()` which runs `mwnn-kanban-pro.openPortfolio` and, when the Pro module
  is not loaded and the command is unregistered, shows a plain information message instead
  of rejecting.
- New `src/sidebarMessages.ts`: pure `routeSidebarMessage()` dispatch for all four sidebar
  messages (`openBoard`, `importPlan`, `runAiLoop`, `openPortfolio`), replacing the inline
  `isSidebarMessage` if/else chain so routing is unit-testable without an extension host.
- `src/pro/upgrade.ts`: `publishProLicenseContext()` now also records the published value and
  notifies listeners on change. Added `isProLicenseActive()` (sync read of the exact value
  behind `mwnn-kanban.hasProLicense`) and `onDidChangeProLicense()`, so the sidebar button and
  the palette/menu `when` clauses cannot disagree.
- `src/sidebarView.ts`: renders `<button id="portfolio" class="secondary" title="...">Portfolio</button>`
  last among the secondary buttons, with the `hidden` attribute when unlicensed (existing
  `button[hidden] { display: none; }` leaves no control or spacing). Clicking posts
  `{type:'openPortfolio'}`; a `portfolioButton` host->webview message toggles visibility live.
  Only the derived mode crosses the boundary — no key or licence payload.
- `src/extension.ts`: both sidebar registrations (workspace and no-workspace paths) wired with
  `openPortfolioDashboard`, `proLicenseStatus`, and `onDidChangeProLicense`.
- Tests: `test/unit/portfolioButton.test.ts` (visibility, label/tooltip, command routing,
  graceful unavailable path), `test/unit/sidebarMessages.test.ts` (message routing incl.
  malformed messages), `test/unit/proLicenseSignal.test.ts` (sync signal tracks the context
  key; enter-key fires one change; no spam on unchanged re-check; disposed listener stops).
- README Features bullet and CHANGELOG `[Unreleased] > Added` entry.

Verified: `npm run lint` clean, `npm test` 351/351 pass, `npm run compile` (webpack) succeeds.
Not exercised: opening the real dashboard in an Extension Development Host with a live Pro
package — the command dispatch itself is covered by unit tests.

STATUS: DONE
