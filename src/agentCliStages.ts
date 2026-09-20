/**
 * The AI loop's dispatch stages, split out of `agentCliHandoff` for the same
 * reason `agentCliProviders` was: configuration readers — the per-stage model
 * rules in `agentCliModels` — need to know *which* stages exist without pulling
 * in the spawn machinery, and `agentCliHandoff` must be able to depend on them
 * without a circular import. `agentCliHandoff` re-exports the type, so every
 * existing import site keeps working unchanged.
 *
 * Stage is the right key for per-stage policy because it is what the loop
 * already dispatches on. Column ids and column titles are not: titles are
 * user-editable free text and ids are per-board, so either would make a
 * workspace setting that silently stops matching when a board is renamed or
 * recreated.
 */

export const AGENT_CLI_HANDOFF_KINDS = [
  'implementation',
  'definition',
  'triage',
  'verification',
] as const;

export type AgentCliHandoffKind = (typeof AGENT_CLI_HANDOFF_KINDS)[number];

/** Narrow an unvalidated configuration key to a stage id. */
export function isAgentCliHandoffKind(value: unknown): value is AgentCliHandoffKind {
  return typeof value === 'string' && AGENT_CLI_HANDOFF_KINDS.some((kind) => kind === value);
}
