---
title: "Command UI Surfaces"
type: analysis
created: 2026-10-10
updated: 2026-10-10
sources:
  - package.json
  - src/extension.ts
  - src/sidebarView.ts
  - src/sidebarMessages.ts
  - src/boardPanel.ts
  - src/pro/upgrade.ts
  - media/board.js
tags:
  - vscode-api
  - ux
  - webview
  - configuration
related:
  - wiki/index.md
---

# Command UI Surfaces

This page records which `package.json` `contributes.commands` entries should have a visible UI control in addition to the Command Palette. It is an audit only (card `card-mv2h1yip-1`): no source, manifest, or webview code was changed. Each button worth adding has its own follow-up Backlog card.

The audit was taken from the working tree on 2026-10-10: 31 commands, 19 `mwnn-kanban.*` and 12 `mwnn-kanban-pro.*`.

## Surfaces in scope

| Surface | Where it is declared | What it does today |
|---|---|---|
| **Board webview** | `media/board.js` → `src/boardPanel.ts` messages | Column add, rename, reorder, delete, and limits. Card editing, the Run with AI button, the interview, and zoom. |
| **Sidebar view** (`mwnn-kanban.sidebar`, webview) | `src/sidebarView.ts`, `src/sidebarMessages.ts` | Open/Focus Board, Import plan, AI Loop play/pause/stop, and a Portfolio button when licensed. |
| **Sidebar view title** | `package.json` `menus.view/title` | Agent CLI Models (gear). |
| **My Work view title/inline** (`mwnn-kanban.myWork`, tree, Pro) | `package.json` `menus.view/title`, `menus.view/item/context` | Title: Portfolio, Rescan, and Open Timesheet; overflow: Correct Last Session, Export Timesheet (`timesheet`), Export Review Digest (`reports`), Set Allocation Targets (`settings`). Card inline: Start Timer, Stop Timer, Start Focus Session. |
| **Editor title** | — | Nothing is contributed today. |

`mwnn-kanban-pro.*` commands are registered by the separate Pro module, which `src/pro/loader.ts` loads at runtime. Their menu entries live in this repo's `package.json`, but any context keys that depend on Pro state (timer or focus session running) must be set by the Pro module.

## Decision table

Decision values: **add button** (a new visible control is worth adding), **keep as-is** (already has a suitable surface), and **palette only** (deliberately left without a button).

"Gating `when`" is the `menus.commandPalette` clause, and "—" means always visible. For the license key, `hasProLicense` is short for `mwnn-kanban.hasProLicense`. For the setting, `enableRunWithAI` is short for `config.mwnn-kanban.enableRunWithAI`.

| Command id | Title | Current UI surface(s) | Gating `when` | Decision | Target surface · visible when | Rationale | Card |
|---|---|---|---|---|---|---|---|
| `mwnn-kanban.openBoard` | Open Board | Sidebar view button (Open/Focus, hidden while the board is focused) | — | keep as-is | — | The entry point is already prominent and state-aware. | — |
| `mwnn-kanban.addColumn` | Add Column | Board webview "+ Add column" | — | keep as-is | — | Board header and empty state already cover it. | — |
| `mwnn-kanban.renameColumn` | Rename Column | Board webview column header | — | keep as-is | — | Inline column control already exists. | — |
| `mwnn-kanban.deleteColumn` | Delete Column | Board webview column control (host modal confirm in `boardPanel.ts`) | — | keep as-is | — | Destructive, but it is already surfaced and confirmed on the extension host. | — |
| `mwnn-kanban.setColumnLimits` | Set Column Limits | Board webview column control | — | keep as-is | — | Inline column control already exists. | — |
| `mwnn-kanban.runCardWithAI` | Run Card with AI | Board webview card button (AI-assigned, defined card) | `enableRunWithAI` | keep as-is | — | The per-card button already exists and is setting-gated. | — |
| `mwnn-kanban.runBoardLoop` | Run Board with AI Loop | Sidebar view ▶ Play | `enableRunWithAI` | keep as-is | — | Host-driven enablement (`aiLoopControls`) already matches the loop state. | — |
| `mwnn-kanban.pauseBoardLoop` | Pause AI Loop | Sidebar view ❚❚ Pause | `enableRunWithAI` | keep as-is | — | Same as Play. | — |
| `mwnn-kanban.stopBoardLoop` | Stop AI Loop | Sidebar view ■ Stop | `enableRunWithAI` | keep as-is | — | Same as Play. | — |
| `mwnn-kanban.stopCardRun` | Stop Card AI Run | palette only | `enableRunWithAI` | **add button** | **Board webview**, on the card's "&lt;provider&gt; running" chip · visible when `enableRunWithAI` and that card has a live CLI run | The board already shows which card is running, but stopping it needs the palette. The command aborts *all* runs, so the button must abort only that card's run. | [card-mv2ik8oc-1](../.mwnn/cards/card-mv2ik8oc-1.md) |
| `mwnn-kanban.importPlan` | Import Plan | Sidebar view "Import plan" button | `enableRunWithAI` | keep as-is | — | Already surfaced. See the gating mismatch under [Duplicates and conflicts](#duplicates-and-conflicts). | — |
| `mwnn-kanban.populateAgentCliModels` | Populate Agent CLI Models and Thinking Levels | palette only | — | palette only | — | One-off discovery that seeds settings. The Agent CLI Models panel is the UI home for model management. | — |
| `mwnn-kanban.manageAgentCliModels` | Manage Agent CLI Models and Thinking Levels | palette only | — | palette only | — | A quick-pick alternative to the Agent CLI Models panel. A second button would duplicate the gear. | — |
| `mwnn-kanban.openAgentCliModels` | Agent CLI Models | Sidebar view title (gear, `navigation@1`) | — | keep as-is | — | Already surfaced. The board's model-picker link should route here instead of raw settings (see conflicts). | [card-mv2ik8oc-5](../.mwnn/cards/card-mv2ik8oc-5.md) |
| `mwnn-kanban.resetBoard` | Reset Board | palette only (host modal confirm) | — | palette only | — | **Destructive and rare.** It deletes every card file. No button, so it cannot be clicked by accident. If one is ever added, it must keep the extension-host modal confirm, because webviews cannot use `window.confirm`. | — |
| `mwnn-kanban.upgradeToPro` | Get MWNN Kanban Pro | palette only (has a `$(star-full)` icon but no menu) | `!hasProLicense` | **add button** | **Sidebar view title**, `navigation@2` · visible when `view == mwnn-kanban.sidebar && !mwnn-kanban.hasProLicense` | Pro features are hard to discover otherwise. The icon is already declared, and the button disappears once licensed. | [card-mv2ik8oc-2](../.mwnn/cards/card-mv2ik8oc-2.md) |
| `mwnn-kanban.enterProLicenseKey` | Enter Pro License Key | palette only (also offered from the upgrade flow) | — | **add button** | **Sidebar view title overflow (…)**, group `pro@2` · visible when `view == mwnn-kanban.sidebar && !mwnn-kanban.hasProLicense` | Buyers need an obvious place to paste the key. An overflow item is low-noise. | [card-mv2ik8oc-2](../.mwnn/cards/card-mv2ik8oc-2.md) |
| `mwnn-kanban.clearProLicenseKey` | Clear Pro License Key | palette only (host modal confirm) | — | palette only | — | **Destructive and rare.** Clearing revokes Pro features. No button. If one is ever added, it must keep the existing host `showWarningMessage` modal. | — |
| `mwnn-kanban.showProLicenseStatus` | Show Pro License Status | palette only | — | **add button** | **Sidebar view title overflow (…)**, group `pro@1` · always visible on `view == mwnn-kanban.sidebar` | Lets users check trial or license state without knowing the command name. It is harmless and read-only. | [card-mv2ik8oc-2](../.mwnn/cards/card-mv2ik8oc-2.md) |
| `mwnn-kanban-pro.openPortfolio` | Open Portfolio | My Work view title (`navigation@1`), sidebar view Portfolio button | `hasProLicense` | keep as-is | — | Surfaced twice by design (see duplicates). | — |
| `mwnn-kanban-pro.rescanProjects` | Rescan Projects | My Work view title (`navigation@2`) | `hasProLicense` | keep as-is | — | Standard refresh affordance. | — |
| `mwnn-kanban-pro.startTimer` | Start Timer | My Work card inline (`inline@1`) | `hasProLicense` | keep as-is (fix visibility) | — | Surfaced, but shown even while a timer is already running (see conflicts). | [card-mv2ik8oc-4](../.mwnn/cards/card-mv2ik8oc-4.md) |
| `mwnn-kanban-pro.stopTimer` | Stop Timer | My Work card inline (`inline@2`) | `hasProLicense` | keep as-is (fix visibility) | — | Surfaced, but shown even when no timer is running (see conflicts). | [card-mv2ik8oc-4](../.mwnn/cards/card-mv2ik8oc-4.md) |
| `mwnn-kanban-pro.correctLastSession` | Correct Last Session | palette only | `hasProLicense` | **add button** | **My Work view title overflow (…)**, group `timesheet@1` · visible when `view == mwnn-kanban.myWork && mwnn-kanban.hasProLicense` | A natural follow-up right after Stop Timer in the same view. | [card-mv2ik8oc-3](../.mwnn/cards/card-mv2ik8oc-3.md) |
| `mwnn-kanban-pro.openTimesheet` | Open Timesheet (renamed from "Correct Timesheet") | palette only (`$(table)` icon declared) | `hasProLicense` | **add button** | **My Work view title**, `navigation@3` · visible when `view == mwnn-kanban.myWork && mwnn-kanban.hasProLicense` | The timesheet is the main output of time tracking, so it deserves a primary icon next to Portfolio. | [card-mv2ik8oc-3](../.mwnn/cards/card-mv2ik8oc-3.md) |
| `mwnn-kanban-pro.exportTimesheet` | Export Timesheet | palette only (`$(export)` icon declared) | `hasProLicense` | **add button** | **My Work view title overflow (…)**, group `timesheet@2` · visible when `view == mwnn-kanban.myWork && mwnn-kanban.hasProLicense` | Periodic task, so overflow keeps the title bar uncluttered. | [card-mv2ik8oc-3](../.mwnn/cards/card-mv2ik8oc-3.md) |
| `mwnn-kanban-pro.exportReviewDigest` | Export Review Digest | palette only (`$(notebook)` icon declared) | `hasProLicense` | **add button** | **My Work view title overflow (…)**, group `reports@1` · visible when `view == mwnn-kanban.myWork && mwnn-kanban.hasProLicense` | Periodic reporting task that is currently undiscoverable. | [card-mv2ik8oc-3](../.mwnn/cards/card-mv2ik8oc-3.md) |
| `mwnn-kanban-pro.showAiUsage` | Show AI Provider Usage | palette only (`$(dashboard)` icon declared) | `hasProLicense` | **add button** | **Sidebar view title**, `navigation@2` · visible when `view == mwnn-kanban.sidebar && mwnn-kanban.hasProLicense` | Usage and credit belong beside the AI Loop controls it informs. The slot never overlaps "Get Pro", whose `when` is the opposite. | [card-mv2ik8oc-2](../.mwnn/cards/card-mv2ik8oc-2.md) |
| `mwnn-kanban-pro.startFocusSession` | Start Focus Session | My Work card inline (`inline@3`) | `hasProLicense` | keep as-is | — | Already surfaced per card. | — |
| `mwnn-kanban-pro.stopFocusSession` | Stop Focus Session | palette only | `hasProLicense` | **add button** | **My Work view title**, `navigation@0` · visible when `view == mwnn-kanban.myWork && mwnn-kanban.hasProLicense && mwnn-kanban-pro.focusSessionActive` | A session can be started with one click but can only be stopped from the palette. Needs a Pro-side context key. | [card-mv2ik8oc-4](../.mwnn/cards/card-mv2ik8oc-4.md) |
| `mwnn-kanban-pro.setAllocationTargets` | Set Allocation Targets | palette only (`$(settings-gear)` icon declared) | `hasProLicense` | **add button** | **My Work view title overflow (…)**, group `settings@1` · visible when `view == mwnn-kanban.myWork && mwnn-kanban.hasProLicense` | A rare configuration action, so overflow rather than primary. Its gear icon would be confusing in the title bar beside Agent CLI Models. | [card-mv2ik8oc-3](../.mwnn/cards/card-mv2ik8oc-3.md) |

Totals: 31 commands, with 11 add button, 16 keep as-is, and 4 palette only.

## Destructive and rarely used commands

| Command | Decision | Confirmation |
|---|---|---|
| `mwnn-kanban.resetBoard` | **No button**, palette only | Already a host modal (`showWarningMessage(..., { modal: true }, 'Reset')`). Any future button must route to the command and keep that modal. |
| `mwnn-kanban.clearProLicenseKey` | **No button**, palette only | Already a host modal in `src/pro/upgrade.ts`. Same rule applies. |
| `mwnn-kanban.deleteColumn` | Keep the existing board button | The host modal in `src/boardPanel.ts` (`case 'deleteColumn'`) already covers it. |
| `mwnn-kanban.stopCardRun` (new board button) | Add button | Aborting a run is recoverable (the card can be rerun), so no confirm is required. If a confirm is wanted, it must be a host-side modal. |
| `mwnn-kanban.populateAgentCliModels`, `manageAgentCliModels` | Palette only | Rare. The Agent CLI Models panel is the UI. |

Webviews in this extension cannot use `window.confirm`, `alert`, or `prompt`, because they are no-ops. Any confirmation for a webview-triggered destructive action must come from the extension host.

## Duplicates and conflicts

> ⚠️ Note: **Open Portfolio has two surfaces.** It appears in the My Work view title and as a sidebar view Portfolio button, both license-gated. This is an acceptable intentional duplicate, because the sidebar is the always-visible entry point. Keep both, and do not add a third.

> ⚠️ Note: **Three Agent CLI model commands overlap.** `populateAgentCliModels`, `manageAgentCliModels` (quick pick), and `openAgentCliModels` (panel) all manage the same settings. Only the panel has a button. Consider folding populate into the panel and retiring the quick pick later. No change is proposed here.

> ⚠️ Note: **The board model picker bypasses the Agent CLI Models panel.** The board's "Configure model lists in settings…" link (`openModelSettings` in `media/board.js`, handled in `src/boardPanel.ts`) opens raw `workbench.action.openSettings`, while the sidebar gear opens the dedicated panel. The same intent leads to two different destinations. Follow-up: [card-mv2ik8oc-5](../.mwnn/cards/card-mv2ik8oc-5.md).

> ⚠️ Note: **Start Timer and Stop Timer are both always shown.** The two inline actions on every My Work card are gated only on `viewItem == mwnn-kanban.card`, so both appear whether or not a timer is running. Follow-up: [card-mv2ik8oc-4](../.mwnn/cards/card-mv2ik8oc-4.md).

> ⚠️ Note: **Import Plan gating does not match.** The palette entry requires `config.mwnn-kanban.enableRunWithAI`, but the sidebar "Import plan" button (`src/sidebarView.ts`) is always enabled, while the loop buttons beside it respect the setting. A product decision is needed: either gate the button or drop the palette `when`. No card was created because this is not an add-button decision.

> ⚠️ Note: **Timesheet titles were inconsistent (resolved).** `mwnn-kanban-pro.openTimesheet` was titled "Correct Timesheet", which overlapped `correctLastSession` and hid the "open" intent. The user chose to rename it to "Open Timesheet" in [card-mv2ik8oc-3](../.mwnn/cards/card-mv2ik8oc-3.md); the command id is unchanged. The Pro extension that registers the command should use the same title if it declares one.

> ⚠️ Note: **Stop Card AI Run scope does not match the board.** `stopCardRun` aborts every active card CLI run, but the board shows runs per card. The board button must abort only its own card's run.

## Follow-up cards

| Card | Surface | Commands |
|---|---|---|
| [card-mv2ik8oc-1](../.mwnn/cards/card-mv2ik8oc-1.md) | Board webview | `stopCardRun` (per-card) |
| [card-mv2ik8oc-2](../.mwnn/cards/card-mv2ik8oc-2.md) | Sidebar view title | `upgradeToPro`, `showAiUsage`, `showProLicenseStatus`, `enterProLicenseKey` |
| [card-mv2ik8oc-3](../.mwnn/cards/card-mv2ik8oc-3.md) | My Work view title | `openTimesheet`, `correctLastSession`, `exportTimesheet`, `exportReviewDigest`, `setAllocationTargets` |
| [card-mv2ik8oc-4](../.mwnn/cards/card-mv2ik8oc-4.md) | My Work inline and title | `stopFocusSession`, plus state-aware `startTimer`/`stopTimer` |
| [card-mv2ik8oc-5](../.mwnn/cards/card-mv2ik8oc-5.md) | Board webview | Route the model-picker settings link to `openAgentCliModels` |
