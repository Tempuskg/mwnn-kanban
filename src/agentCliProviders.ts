/**
 * Agent CLI provider identity, split out of `agentCliHandoff` so modules that
 * only need to know *which* CLIs exist — configuration readers, the model
 * catalog — do not pull in the spawn machinery, and so `agentCliHandoff` can
 * depend on them without a circular import. `agentCliHandoff` re-exports these,
 * so every existing import site keeps working unchanged.
 *
 * `cursor-other` (**Cursor Agent CLI Other**) is a first-class selectable
 * identity that shares Cursor Agent CLI's executable and path override with
 * `cursor`. It is the Other Models pool identity; `cursor` is the Auto /
 * Cursor-models pool identity.
 */

export const AGENT_CLI_PROVIDER_IDS = [
  'copilot',
  'codex',
  'claude-code',
  'cursor',
  'cursor-other',
] as const;

export type AgentCliProviderId = (typeof AGENT_CLI_PROVIDER_IDS)[number];

/** User-visible name for each selectable agent CLI identity. */
export const AGENT_CLI_LABELS: Record<AgentCliProviderId, string> = {
  copilot: 'GitHub Copilot CLI',
  codex: 'OpenAI Codex CLI',
  'claude-code': 'Anthropic Claude Code CLI',
  cursor: 'Cursor Agent CLI',
  'cursor-other': 'Cursor Agent CLI Other',
};

/**
 * Providers that own an executable / `agentCliPaths` key. `cursor-other`
 * reuses `cursor`'s path and spawn spec.
 */
export type AgentCliExecutableProviderId = Exclude<AgentCliProviderId, 'cursor-other'>;

/** Stable id for Cursor Agent CLI Other (Other Models pool). */
export const AGENT_CLI_CURSOR_OTHER_ID = 'cursor-other' as const;

/** @deprecated Prefer {@link AGENT_CLI_CURSOR_OTHER_ID}. */
export const AGENT_CLI_CURSOR_OTHER_STAGE_ID = AGENT_CLI_CURSOR_OTHER_ID;

/**
 * Stage settings use the same provider ids as dispatch selection (including
 * Cursor Agent CLI Other). Kept as an alias so existing stage readers stay
 * clear about their domain.
 */
export const AGENT_CLI_STAGE_PROVIDER_IDS = AGENT_CLI_PROVIDER_IDS;

export type AgentCliStageProviderId = AgentCliProviderId;

/** Narrow an unvalidated configuration key or stored value to a provider id. */
export function isAgentCliProviderId(value: unknown): value is AgentCliProviderId {
  return (
    typeof value === 'string' && AGENT_CLI_PROVIDER_IDS.some((provider) => provider === value)
  );
}

/** Narrow an unvalidated stage-settings key to a stage provider id. */
export function isAgentCliStageProviderId(value: unknown): value is AgentCliStageProviderId {
  return isAgentCliProviderId(value);
}

/** True for either Cursor Agent CLI identity (Auto or Other). */
export function isCursorAgentCliProvider(provider: AgentCliProviderId): boolean {
  return provider === 'cursor' || provider === 'cursor-other';
}

/**
 * The executable / path-override provider for a selectable identity.
 * `cursor-other` shares Cursor Agent CLI with `cursor`.
 */
export function agentCliExecutableProvider(
  provider: AgentCliProviderId,
): AgentCliExecutableProviderId {
  return provider === 'cursor-other' ? 'cursor' : provider;
}

/**
 * @deprecated Prefer {@link agentCliExecutableProvider}. Historically mapped
 * `cursor-other` onto the `cursor` executable identity for spawn/path.
 */
export function agentCliProviderForStageProvider(
  provider: AgentCliStageProviderId,
): AgentCliExecutableProviderId {
  return agentCliExecutableProvider(provider);
}
