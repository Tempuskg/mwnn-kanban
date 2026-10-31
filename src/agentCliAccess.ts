import {
  AGENT_CLI_EXECUTABLE_PROVIDER_IDS,
  agentCliExecutableProvider,
  type AgentCliExecutableProviderId,
  type AgentCliProviderId,
} from './agentCliProviders';

export type AgentCliAccessSettings = Record<string, unknown>;

/** A missing or malformed provider value preserves the historical allow-all behavior. */
export function readAgentCliProviderSetting(
  value: unknown,
  provider: AgentCliExecutableProviderId,
): boolean | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const setting = (value as AgentCliAccessSettings)[provider];
  return typeof setting === 'boolean' ? setting : undefined;
}

/** Cursor Agent CLI Other shares the `cursor` executable's access decision. */
export function isAgentCliProviderAllowed(
  provider: AgentCliProviderId,
  allowedProviders: readonly AgentCliExecutableProviderId[],
): boolean {
  return allowedProviders.includes(agentCliExecutableProvider(provider));
}

/** Return every executable CLI not explicitly disabled. */
export function readAgentCliAllowedProviders(
  value: unknown,
): readonly AgentCliExecutableProviderId[] {
  return AGENT_CLI_EXECUTABLE_PROVIDER_IDS.filter(
    (provider) => readAgentCliProviderSetting(value, provider) !== false,
  );
}

/**
 * The user's acknowledgement that no enabled CLI can incur an extra usage
 * charge. It defaults to acknowledged and is never re-prompted; only an
 * explicit `false` withdraws it.
 */
export function readAgentCliNoExtraChargesAcknowledged(value: unknown): boolean {
  return value !== false;
}

/** Withdrawing the no-extra-charges acknowledgement disables every CLI for dispatch. */
export function effectiveAgentCliAllowedProviders(
  allowedProviders: readonly AgentCliExecutableProviderId[],
  noExtraChargesAcknowledged: boolean,
): readonly AgentCliExecutableProviderId[] {
  return noExtraChargesAcknowledged ? allowedProviders : [];
}

/** Write one scope's setting while preserving untouched values in that scope. */
export function setAgentCliProviderSetting(
  value: unknown,
  provider: AgentCliExecutableProviderId,
  allowed: boolean,
): AgentCliAccessSettings {
  const current = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as AgentCliAccessSettings
    : {};
  return { ...current, [provider]: allowed };
}
