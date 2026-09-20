/**
 * Agent CLI provider identity, split out of `agentCliHandoff` so modules that
 * only need to know *which* CLIs exist — configuration readers, the model
 * catalog — do not pull in the spawn machinery, and so `agentCliHandoff` can
 * depend on them without a circular import. `agentCliHandoff` re-exports these,
 * so every existing import site keeps working unchanged.
 */

export const AGENT_CLI_PROVIDER_IDS = ['copilot', 'codex', 'claude-code', 'cursor'] as const;

export type AgentCliProviderId = (typeof AGENT_CLI_PROVIDER_IDS)[number];

/** Narrow an unvalidated configuration key or stored value to a provider id. */
export function isAgentCliProviderId(value: unknown): value is AgentCliProviderId {
  return (
    typeof value === 'string' && AGENT_CLI_PROVIDER_IDS.some((provider) => provider === value)
  );
}
