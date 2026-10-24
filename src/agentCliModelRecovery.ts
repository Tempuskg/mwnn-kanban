/**
 * Recover from a model-not-found failure on Define with AI / Run with AI.
 *
 * Pure policy (no `vscode`): classify which failures are recoverable, which
 * settings scope a write may target, and how to patch one scope's
 * `agentCliModels` / `agentCliThinkingLevels` without touching the other.
 * The QuickPick UI and the configuration writes live in the extension host.
 */
import {
  BUNDLED_AGENT_CLI_MODELS,
  BUNDLED_AGENT_CLI_THINKING_LEVELS,
} from './agentCliDiscovery';
import {
  AGENT_CLI_LABELS,
  AGENT_CLI_THINKING_FLAGS,
  type AgentCliHandoffFailure,
  type AgentCliProviderId,
} from './agentCliHandoff';
import {
  agentCliModelsFor,
  type AgentCliModelCatalog,
  type AgentCliModelSource,
} from './agentCliModels';
import {
  makeAgentCliSettingsDefault,
  type AgentCliSettingsEdit,
} from './agentCliSettingsEditor';

/** VS Code settings scope the recovery UI may write. */
export type AgentCliRecoveryScope = 'workspace' | 'user';

/**
 * What the user confirmed in the recovery GUI. Applied as one atomic write to
 * the chosen scope, then used to re-dispatch the same define/run.
 */
export interface AgentCliModelRecoverySelection {
  readonly model: string;
  /** Absent when the CLI does not accept a thinking level, or the user kept the CLI default. */
  readonly thinkingLevel?: string;
  readonly scope: AgentCliRecoveryScope;
}

/** Context the recovery UI needs to present options for one failed CLI. */
export interface AgentCliModelRecoveryRequest {
  readonly provider: AgentCliProviderId;
  readonly providerLabel: string;
  readonly rejectedModel: string;
  /** Which layer supplied the refused model; card-sourced refusals also update the card. */
  readonly source: AgentCliModelSource;
  readonly detail: string;
  readonly modelSuggestions: readonly string[];
  readonly thinkingSuggestions: readonly string[];
  readonly thinkingSupported: boolean;
  readonly workspaceAvailable: boolean;
}

/** Whether confirming recovery should also rewrite the card's preferred model. */
export function recoveryUpdatesCardFrontmatter(source: AgentCliModelSource): boolean {
  return source === 'card';
}

/**
 * Only a classified model-name refusal is recoverable. Usage limits, auth,
 * network, missing evidence, and generic process failures stay on their
 * existing paths and must not open the recovery GUI.
 */
export function isRecoverableModelRejection(
  result: { readonly failure?: AgentCliHandoffFailure },
): boolean {
  return result.failure === 'model-rejected';
}

/** Scopes the GUI may offer. Workspace requires an open folder. */
export function availableRecoveryScopes(
  workspaceAvailable: boolean,
): readonly AgentCliRecoveryScope[] {
  return workspaceAvailable ? ['workspace', 'user'] : ['user'];
}

/**
 * Maps a recovery scope to the VS Code configuration target and the
 * `inspect()` field that holds that scope's own value. Writes always read and
 * update only that field so the other scope is never copied or overwritten.
 */
export function recoveryScopeWriteTarget(scope: AgentCliRecoveryScope): {
  readonly configurationTarget: 'Workspace' | 'Global';
  readonly inspectField: 'workspaceValue' | 'globalValue';
} {
  return scope === 'workspace'
    ? { configurationTarget: 'Workspace', inspectField: 'workspaceValue' }
    : { configurationTarget: 'Global', inspectField: 'globalValue' };
}

/** Whether this CLI accepts a thinking-level argument on its command line. */
export function providerSupportsThinkingLevel(provider: AgentCliProviderId): boolean {
  return AGENT_CLI_THINKING_FLAGS[provider] !== undefined;
}

/**
 * Model names the recovery picker offers for one CLI: the curated
 * `agentCliModels` list for that provider (same source as Manage Agent CLI
 * Models), then any bundled names not already listed, with the refused name
 * removed so the user is not invited to re-pick the failure.
 */
export function modelRecoverySuggestions(
  provider: AgentCliProviderId,
  catalog: AgentCliModelCatalog,
  rejectedModel?: string,
): readonly string[] {
  const merged: string[] = [...agentCliModelsFor(catalog, provider)];
  for (const name of BUNDLED_AGENT_CLI_MODELS[provider]) {
    if (!merged.includes(name)) {
      merged.push(name);
    }
  }
  return rejectedModel === undefined
    ? merged
    : merged.filter((name) => name !== rejectedModel);
}

/**
 * Thinking-level names the recovery picker offers: configured suggestions for
 * that provider, then bundled names. Empty when the CLI does not accept a
 * level (Cursor Agent CLI).
 */
export function thinkingRecoverySuggestions(
  provider: AgentCliProviderId,
  configured: readonly string[] = [],
): readonly string[] {
  if (!providerSupportsThinkingLevel(provider)) {
    return [];
  }
  const merged: string[] = [...configured];
  for (const name of BUNDLED_AGENT_CLI_THINKING_LEVELS[provider]) {
    if (!merged.includes(name)) {
      merged.push(name);
    }
  }
  return merged;
}

export interface AgentCliModelRecoveryWrites {
  readonly models: AgentCliSettingsEdit;
  readonly thinkingLevels?: AgentCliSettingsEdit;
}

/**
 * Build the scoped settings patches for a confirmed recovery. Only the chosen
 * provider's keys change; every other provider key in the same scope is copied
 * through. Thinking is omitted when the user did not pick a level.
 */
export function buildModelRecoveryWrites(
  provider: AgentCliProviderId,
  selection: Pick<AgentCliModelRecoverySelection, 'model' | 'thinkingLevel'>,
  modelsValue: unknown,
  thinkingValue: unknown,
): AgentCliModelRecoveryWrites {
  const models = makeAgentCliSettingsDefault(
    modelsValue,
    'models',
    provider,
    selection.model,
  );
  if (selection.thinkingLevel === undefined) {
    return { models };
  }
  return {
    models,
    thinkingLevels: makeAgentCliSettingsDefault(
      thinkingValue,
      'thinkingLevels',
      provider,
      selection.thinkingLevel,
    ),
  };
}

/** Human-readable scope label for QuickPick items and status messages. */
export function recoveryScopeLabel(scope: AgentCliRecoveryScope): string {
  return scope === 'workspace' ? 'Workspace' : 'User';
}

/** Title used by the recovery QuickPick chain. */
export function modelRecoveryTitle(provider: AgentCliProviderId): string {
  return `Choose a model ${AGENT_CLI_LABELS[provider]} accepts`;
}
