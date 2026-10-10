# Agent CLI model discovery

Usage Orchestrator writes one model report for each dispatch attempt to both
the card's Activity and the MWNN Agent CLI output. A report includes the
attempt id, timestamp, card id, CLI, stage, requested model and selection
source, then the actual model when provider evidence arrives. A model change
emitted later in the same attempt gets another report with the same attempt id.

The requested value and the observed value are separate. A card, AI Loop stage,
workspace model list, or escalation can supply a requested model argument. If
no layer supplies one, the CLI receives no model argument and the start report
records `source: CLI default`. The actual-model line is written only from the
running provider's metadata. A name in a setting or command line is never
treated as proof of the model the CLI used. Rejected or unapplied selections
remain visible as requested values, with their status called out separately.

## Provider evidence

Each dispatch has a private discovery session, so replacement CLIs and model
escalation retries cannot reuse another process's metadata.

| CLI | Evidence used | Limitations |
| --- | --- | --- |
| GitHub Copilot CLI | Explicit `Model:`, `Model used:`, `Selected model:`, or `Using model:` label in its normal non-silent programmatic output. The handoff leaves `--silent` off so the CLI can emit that metadata. | Output labels vary by CLI version and selected agent. If no recognized label is emitted, the log says Copilot did not expose an explicit model. Assistant prose and the requested argument are never searched for a model name. See the [Copilot CLI programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference). |
| OpenAI Codex CLI | `codex exec --json` provides the dispatch's `thread.started.thread_id`. The matching local rollout is read from `$CODEX_HOME/sessions/` or `~/.codex/sessions/`; `session_meta` and `turn_context` records are accepted only when their payload id matches that thread. The `model` or `model_slug` field is reported as it changes. | The JSON exec event stream may not include a model. Compressed `.jsonl.zst` rollouts are unsupported. Lookup is limited to the current and previous two date folders, 2,000 directory entries per day, 32 MiB per attempt, 1 MiB per poll, 256 KiB per JSONL record, and 500 ms per metadata operation. Polling lasts at most 120 seconds and stops on cancellation. A missing thread id, compressed rollout, scan limit, timeout, or absent field gets a specific unavailable reason. See the [Codex exec event schema](https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs). |
| Anthropic Claude Code | `--output-format stream-json` `system.init.model`, followed by any `assistant.message.model` or final `result.model` fields the CLI emits. | The stream schema can evolve. If the installed CLI emits no nonempty model field, the actual name is reported unavailable. See [Claude Code CLI usage](https://code.claude.com/docs/en/cli-usage). |
| Cursor Agent | `--output-format stream-json` `system.init.model`, followed by any `assistant.message.model` or final `result.model` fields the CLI emits. | The documented `system.init` model is the default-model evidence. If the installed CLI omits its model field, discovery reports that limitation and the card run continues. See [Cursor CLI output formats](https://docs.cursor.com/en/cli/reference/output-format). |

For Copilot, Claude Code, and Cursor Agent, the extension parses streaming
output as it arrives, including records split across chunks. Codex metadata is
polled from that attempt's matching rollout and checked once more at process
completion. Missing, malformed, unsupported, rejected, or cancelled discovery
never substitutes the requested name, fails a handoff, or advances a card.
When a process does not start, the report says that no model was used. A CLI
that the orchestrator skips receives no attempt or model report.
