---
id: card-mwlgz03b-1
title: Create a low effort low cost marketing plan for the free version
column: col-mqwk2njn-4
position: -119000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6-luna
preferredModel.claude-code: sonnet
preferredModel.cursor-other: claude-opus-5-5-medium
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1794966941495
updatedAt: 1794970488120
---

## Description
Write a short marketing plan for the **free** MWNN Kanban extension (`darrenjmcleod.mwnn-kanban` on the VS Marketplace and Open VSX) that a solo maker can keep running on about two hours a week and no cash. This card only produces the plan. It changes no listing, posts nothing, and creates no cards.

The free extension is the top of the funnel, since Pro unlocks inside the same install. A full, Pro-led 1.0 launch campaign already exists in the private Pro repo. Its brief and messaging guardrails, the blog, community, social, and Product Hunt drafts, and the shot list are in `e:\mwnn-kanban-pro\docs\marketing\`, and the captured screenshots are in `e:\mwnn-kanban-pro\landing\`. Its posting cards are still in the Pro board's Backlog. This plan is the always-on, free-led complement to that one-off launch. It fixes the owned surfaces people land on first, then sets up a small recurring routine that reuses existing material instead of making new assets.

Gaps to audit, as of 1.0.18:
- One VSIX feeds both registry listings, so both listing pages show the README, which has no screenshot or GIF.
- `package.json` has `categories: ["Other"]` and five generic keywords. Its description ("An in-editor MWNN Kanban board. No usage, board, or time data is transmitted.") says nothing about AI agents or Markdown cards.
- The public GitHub repo has no topics, and its description doesn't mention the Markdown-file board or AI agents.

Write the plan to `docs/free-version-marketing-plan.md`, beside the repo's other plans. `docs/**` is excluded from the VSIX, so the plan won't ship. The repo is public, so keep private business data out and link to the private brief instead.

## Acceptance criteria
- [x] `docs/free-version-marketing-plan.md` exists, opens by marking itself a draft for the maker's review, and stays at about 150 lines or fewer by linking to existing drafts instead of copying them
- [x] It states the goal (more installs and active use of the free extension on both the VS Marketplace and Open VSX), names one or two primary audiences, and sets explicit budgets: total one-time setup hours, no more than 2 recurring hours a week, and $0 required cash spend
- [x] Every tactic lists its channel, concrete action, one-time and recurring effort, cash cost, and cadence, and the totals fit the budgets. Deliberately excluded tactics, at least paid ads and in-product rating or review prompts, are listed with the reason
- [x] A listing audit covers the current `package.json` `displayName`, `description`, `keywords`, and `categories`, the README's opening section, and the GitHub repo description and topics, and proposes concrete replacement values for each, aimed at the chosen audiences, without applying them
- [x] It names each existing asset it reuses (launch drafts, shot list, landing screenshots, `CHANGELOG.md` entries) and explains how it relates to the pending 1.0 launch campaign without duplicating or rescheduling those launch posts
- [x] It gives a week-by-week schedule for the first four weeks and a steady-state routine after that, and writes each one-time action as its own `- [ ]` item that `MWNN Kanban: Import Plan` could turn into one card
- [x] It follows the launch brief's messaging guardrails. Pro is mentioned only as unlocking inside the same extension, privacy claims use the approved wording, and the plan never asks for stars, reviews, or upvotes or offers anything in return for them. Every feature claim traces to the current README or CHANGELOG
- [x] Measurement uses only counters that already exist (Marketplace publisher hub reports, Open VSX downloads, GitHub stars, issues, and traffic referrers), with a monthly review and a keep-or-drop rule per tactic. The plan adds no telemetry, analytics, UTM parameters, tracking links, or link shorteners anywhere
- [x] Apart from this card's own Activity, the plan file is the only change. It contains no private business data (Polar orders, revenue, Founders spot counts, license or customer details). No source, `package.json`, `README.md`, `CHANGELOG.md`, or `e:\mwnn-kanban-pro` files change, no cards are created, and nothing is posted or submitted to an external site

## Activity
### 2026-11-18T01:56:32.533Z - Usage Orchestrator chose Anthropic Claude Code CLI
Stage: definition. Anthropic Claude Code CLI reports 91% remaining, resetting 2026-11-18T04:09:00.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-18T01:56:34.865Z - Usage Orchestrator dispatch dispatch-mwlh059t-1 started
Card: card-mwlgz03b-1 ("Create a low effort low cost marketing plan for the free version"). CLI: Anthropic Claude Code CLI. Stage: definition.
Requested model: "opus" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the definition stage: opus.
AI loop stage thinking level rule for the definition stage: max.

### 2026-11-18T01:56:38.236Z - Usage Orchestrator dispatch dispatch-mwlh059t-1 model observed
Card: card-mwlgz03b-1. CLI: Anthropic Claude Code CLI. Stage: definition.
Actual model: "claude-opus-5-5" (source: Claude Code stream-json system.init.model; attempt: dispatch-mwlh059t-1).

### 2026-11-18T02:01:53.152Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **light**.

- copilot: model `claude-sonnet-5.5`, thinking level `high`
- codex: model `gpt-6-luna`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`
- cursor-other: model `claude-opus-5-5-medium`

### 2026-11-18T02:16:57.049Z - Auto-started in Implement
Assigned to AI in Ready; moved to Implement automatically.

### 2026-11-18T02:17:06.793Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-11-17 Claude Code: marketing plan drafted
Model note: the card prefers `sonnet`; this session could not switch models and ran on Claude Opus 5.5 (`claude-opus-5-5`).
Wrote `docs/free-version-marketing-plan.md` (117 lines, marked draft for review). It covers the goal, two audiences, and budgets: 8 h setup, about 1 h 45 min a week, $0. It has a listing audit with proposed `displayName`, `description`, `keywords`, `categories`, README opening, GitHub description, website, and topics (none applied), and nine tactics with channel, effort, cost, and cadence. Excluded tactics are listed with reasons. It names the reused launch drafts, shot list, landing screenshots, and CHANGELOG entries, and states how it relates to the pending launch without rescheduling it. It includes a four-week schedule of `- [ ]` one-time items, a steady-state routine, and measurement from existing counters with a monthly keep-or-drop rule. It flags that the current `package.json` description is broader than the approved privacy wording. No other repo, Pro repo, or external changes were made, and no cards were created.
STATUS: DONE
