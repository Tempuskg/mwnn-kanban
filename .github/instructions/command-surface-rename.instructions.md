---
name: "Command Surface Rename"
description: "Use when renaming MWNN Kanban commands, command-palette entries, view/menu titles, configuration keys, or related UX wording. Covers package.json contributions, webview message types, tests, docs, plans, and AI control files."
---

# Command Surface Rename

- Decide up front whether the rename applies to command-palette commands, view and menu titles, configuration keys, webview message types, docs, tests, and AI control files.
- Inventory at minimum: `package.json` `contributes` declarations (commands, views, menus, configuration), `src/extension.ts`, the board panel and messaging modules, the shared message-protocol types, nearby tests, `README.md`, `wiki/`, plans, and repository-local AI control files.
- Renaming a configuration key or a webview message type is a breaking change for the other side of the protocol or for persisted state. Ask before removing the old key; default to keeping aliases, fallbacks, or migration shims until explicit removal is requested.
- When reusing a previously removed or renamed name, compare the old and new semantics explicitly and ask before repurposing it for different behavior. State which aliases remain and which were removed.
- After edits, run one stale-reference sweep across both the old and new names before reporting done.
- Prefer focused validation: touched-file diagnostics first, then `npm run compile-tests` or `npm run compile` for changed TypeScript surfaces, then relevant tests, then a Development Host smoke test when the rename changes user-facing command or board flows.
- Defer repo-wide README, wiki, and changelog sweeps until names and UX are stable unless the request explicitly includes docs or an append-only log requires immediate updates.
- In the closeout, state which surfaces were renamed, which aliases remain, and what was validated.
