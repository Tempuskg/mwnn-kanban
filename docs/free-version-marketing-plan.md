# Free Version Marketing Plan — MWNN Kanban

> **Status: approved by the maker on 2026-11-17. Week 1 starts Monday 2026-11-23.** Nothing has been applied, posted, or submitted yet. The listing values below were accepted as written and are applied in Weeks 1–2. Business figures stay in the private launch brief (`e:\mwnn-kanban-pro\docs\marketing\README.md`), never in this public file.

## Goal and budget

**Goal:** more installs and more active use of the free extension `darrenjmcleod.mwnn-kanban` on both the [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.mwnn-kanban) and [Open VSX](https://open-vsx.org/extension/darrenjmcleod/mwnn-kanban). The free install is the top of the funnel. Pro unlocks inside the same extension, so this plan never promotes a separate Pro listing.

**Primary audiences** (a subset of the launch brief's table):
1. **Developers who delegate cards to AI agents** (Copilot, Codex, Claude Code, Cursor) and want a board their agents can read and edit as Markdown files.
2. **Solo developers and indie makers** who want a Git-tracked board in the repo instead of a hosted tool.

**Budgets:** about **8 one-time setup hours**, then **no more than 2 recurring hours a week**, and **$0 required cash**. Each tactic below is free to run.

## How this relates to the 1.0 launch campaign

The Pro-led 1.0 launch (blog post, Show HN, r/vscode, dev.to, X, Bluesky, and LinkedIn threads, and Product Hunt) is owned by the private brief, and its posting cards are still in the Pro board's Backlog. This plan does **not** post, copy, reorder, or reschedule any of those launch posts. It complements them in two ways:
- **Weeks 1–2 fix the owned surfaces** (listings, README, GitHub repo) that launch traffic lands on, so they help whenever the launch goes out.
- **The routine is always on and free-led.** In any week a launch post goes out, skip that week's tip post. Launch replies count toward the 2-hour cap.

## Reused assets (no new asset production)

| Asset | Where | Reuse |
| --- | --- | --- |
| Launch brief and messaging guardrails | `e:\mwnn-kanban-pro\docs\marketing\README.md` | Rules for every word in this plan |
| Blog draft, "The free extension: your board, as files" and "Humans and AI agents on the same board" | `…\docs\marketing\blog-post.md` | Source angles for tip posts. Link to the published post, don't paste it |
| r/vscode and dev.to drafts (free-first framing, one brief Pro mention) | `…\docs\marketing\community-posts.md` | Tone model for replies in the routine |
| Shot list (privacy rules and capture setup) | `…\docs\marketing\shot-list.md` | Checklist before any screenshot goes public |
| `board-overview.png`, `board-ai-loop.png`, `card-detail-ai.png` | `e:\mwnn-kanban-pro\landing\` | README hero and listing images (free features only; Portfolio shots stay with the launch) |
| `CHANGELOG.md` entries | this repo | GitHub Release notes and the monthly "what changed" post |

## Listing audit (as of 1.0.18): values accepted, not yet applied

The maker accepted every proposed value below as written on 2026-11-17. They are applied in Weeks 1–2 (T1, T3), not before.

One VSIX feeds both registries, so changes to `package.json` and `README.md` reach both listings with the next release.

| Field | Current | Proposed |
| --- | --- | --- |
| `displayName` | `MWNN Kanban` | `MWNN Kanban: Markdown Board for AI Agents` (extension id unchanged) |
| `description` | "An in-editor MWNN Kanban board. No usage, board, or time data is transmitted." | "Kanban board in VS Code stored as one Markdown file per card in your repo. Assign cards to Copilot, Codex, Claude Code, or Cursor agents and run an AI board loop. Board and card records are not sent to MWNN." |
| `keywords` | `kanban, board, tasks, todo, productivity` | `kanban, kanban board, markdown, tasks, todo, project management, ai agents, copilot, codex, claude code, cursor, wip limit, git` |
| `categories` | `["Other"]` | `["AI", "Other"]` (check the categories `vsce` currently accepts before release) |
| README opening | Two badges, then one paragraph about MWNN, then a Features list whose last bullet is Pro-only | See below |
| GitHub description | "An in-editor Kanban board for the Methodology With No Name (MWNN), persisted per workspace." | "VS Code Kanban board stored as Markdown files in your repo, worked by you and your AI agents (Copilot, Codex, Claude Code, Cursor)." |
| GitHub website | empty | the VS Marketplace listing URL |
| GitHub topics | none | `vscode-extension`, `kanban`, `kanban-board`, `markdown`, `ai-agents`, `github-copilot`, `claude-code`, `codex`, `cursor`, `open-vsx`, `task-management` |

> ⚠️ Note: the current `description` ("No usage, board, or time data is transmitted") is broader than the approved privacy wording. AI handoffs go to the chat extension or agent CLI the user picks, under that provider's terms. The proposal uses only the approved claim that board and card records are not sent to MWNN.

**Proposed README opening** (keep the badges and the MWNN methodology link):
1. One-line hook: "A Kanban board that lives in your repo as Markdown files, built for work shared between you and your AI agents."
2. One hero image, `board-overview.png`, stored under `docs/readme/` (already excluded from the VSIX; `vsce` rewrites relative image links to the GitHub repository URL). Alt text describes the board.
3. Three "why" bullets: one Markdown file per card in `.mwnn/` with live reload; human and AI assignees with `Run Card with AI` and a cancellable AI board loop; WIP and Ready reverse-WIP limits.
4. Move the Pro-only Portfolio bullet to the end of Features and lead it with "Pro unlocks inside the same extension."

**Claim sources** (every claim above and in tip posts traces to one of these): README Features, Commands (`Import Plan`), AI Loop Providers, Board Files, and Privacy and network access sections; CHANGELOG 1.0.12 (Done-top ordering), 1.0.14 (independent verification), 1.0.16 (Codex sandbox setting), 1.0.17–1.0.18 (Cursor chat labels).

## Tactics

| # | Tactic | Channel | Concrete action | One-time | Recurring | Cash | Cadence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | Listing metadata | Both registries | Apply the audit's `package.json` values in the next release | 1 h | 0 | $0 | Once, then review yearly |
| T2 | README hero | Both registries, GitHub | Add the opening and hero image above, after a privacy check against the shot list | 2 h | 0 | $0 | Once |
| T3 | GitHub repo surface | GitHub | Set the description, website, and topics | 0.5 h | 0 | $0 | Once |
| T4 | Release notes | GitHub Releases | Create a Release per published version from its CHANGELOG entry; backfill 1.0.12–1.0.18 | 1 h | 15 min/release (~10 min/wk) | $0 | Each release |
| T5 | Tip-post bank | X, Bluesky, LinkedIn | Write 6 short free-feature tips from the claim sources, with one landing screenshot each; post one a fortnight | 1.5 h | 10 min/wk | $0 | Every 2 weeks |
| T6 | Answer where asked | r/vscode, Stack Overflow, GitHub Discussions and issues on agent CLIs, HN comments | Save searches ("vscode kanban", "markdown kanban", "AI agent task board"); reply only when the extension genuinely answers the question, disclose being the maker, mention Pro at most once | 0.5 h | 45 min/wk (20 min in monthly-review weeks) | $0 | Weekly |
| T7 | Issue responsiveness | GitHub issues | First reply within 2 working days; thank reporters and link the fixing release | 0 | 30 min/wk | $0 | Weekly |
| T8 | Curated lists | Public "awesome" lists for VS Code and AI coding agents | Open one pull request per list whose contribution rules the extension meets | 1 h | 0 | $0 | Once |
| T9 | Measurement | Existing counters only | Record the baseline, then run the monthly review | 0.5 h | ~10 min/wk (30 min/month + 5 min fortnightly referrers) | $0 | Monthly |

**Totals:** one-time 8 h. Recurring about 1 h 40 min a week on average, and no more than 2 h in any single week (the 2-hour cap is a hard weekly limit, not an average). Cash $0.

## Deliberately excluded

- **Paid ads and sponsored newsletters**: break the $0 budget, and the launch brief is organic only.
- **In-product rating or review prompts**: they nag users, and the guardrails forbid asking for reviews.
- **Asking for stars, reviews, or upvotes, or giving anything in return**: forbidden by the launch brief's guardrails. Invite people to try it and file issues instead.
- **Telemetry, analytics, UTM parameters, tracking links, or link shorteners**: they conflict with the privacy positioning. Plain canonical links only.
- **New video, landing page, or design work**: over budget. Reuse the captured screenshots.
- **Reposting Show HN, Product Hunt, or the launch threads**: owned by the launch campaign.
- **Cold DMs and posting in unrelated threads**: spammy, and it damages the maker's standing in the communities that matter.

## First four weeks

Week 1 starts on Monday 2026-11-23, the first Monday after the maker approved this plan on 2026-11-17.

**Week 1: owned surfaces (about 3 h)**
- [ ] Record the baseline counters: Marketplace installs, Open VSX downloads, GitHub stars, open issues, and the 14-day traffic referrers
- [ ] Set the GitHub repo description, website, and topics from the listing audit
- [ ] Check the three free-feature landing screenshots against the shot list's privacy rules and copy the approved ones into `docs/readme/`
- [ ] Rewrite the README opening with the hook, hero image, three "why" bullets, and relocated Pro bullet

**Week 2: listing release (about 2.5 h)**
- [ ] Apply the proposed `displayName`, `description`, `keywords`, and `categories` to `package.json` and ship them in the next release to both registries
- [ ] Backfill GitHub Releases for 1.0.12–1.0.18 from their CHANGELOG entries
- [ ] Set up the saved searches for the answer-where-asked routine

**Week 3: content bank (about 1.5 h, plus routine)**
- [ ] Write the six free-feature tip posts, each with its claim source and one landing screenshot, and check them against the guardrails
- Start the routine below.

**Week 4: lists and review (about 1 h, plus routine)**
- [ ] Open curated-list pull requests where the extension meets each list's rules
- [ ] Run the first monthly review and record keep-or-drop decisions

## Steady-state routine (from week 3, at most 2 h a week)

- **Weekly (about 75 min):** answer-where-asked sweep (45 min), issue replies (30 min). In a monthly-review week, cut the sweep to 20 min (about 50 min total) so the busiest week stays within 2 h.
- **Each release (15 min):** a GitHub Release from the CHANGELOG entry.
- **Every 2 weeks (20 min):** post the next tip from the bank, skipped in launch weeks; copy the GitHub traffic referrers, which GitHub keeps for only 14 days.
- **Monthly, first Monday (30 min):** the review below. Refill the tip bank from new CHANGELOG entries only when it runs out.

## Measurement and keep-or-drop rule

Only existing counters: VS Marketplace publisher hub reports (installs, page views), Open VSX download count, GitHub stars (read, never requested), issues opened, and GitHub traffic referrers. This plan adds no telemetry, analytics, UTM parameters, tracking links, or link shorteners anywhere.

**Monthly review:** record each counter's month-over-month change, plus which referrers and threads produced installs, issues, or conversation. **Keep-or-drop:** a recurring tactic stays if, across two consecutive monthly reviews, it shows any attributable signal (a referrer, an issue, or a reply thread) or costs no more than 15 minutes a week. Otherwise drop it and give its time to the tactic with the strongest signal. Record each decision in a short dated note in the private brief's folder, not in this public file.
