/** Host-side settings bridge. Injected inspect/update functions keep it testable. */
import {
  AGENT_CLI_LABELS,
  AGENT_CLI_PROVIDER_IDS,
  AGENT_CLI_STAGE_PROVIDER_IDS,
  agentCliExecutableProvider,
  type AgentCliStageProviderId,
} from './agentCliProviders';
import { AGENT_CLI_HANDOFF_KINDS } from './agentCliStages';
import {
  addAgentCliSettingsEntry,
  agentCliSettingsEntries,
  clearAgentCliSettingsProvider,
  makeAgentCliSettingsDefault,
  removeAgentCliSettingsEntry,
  removeAgentCliSettingsStage,
  setAgentCliSettingsStage,
  type AgentCliSettingsEdit,
  type AgentCliSettingsValue,
} from './agentCliSettingsEditor';
import { mergeAgentCliStagePreferences, readAgentCliStageModels, stageAgentCliModel } from './agentCliModels';
import {
  classifyCursorModelPool,
  type CursorUsagePoolId,
} from './cursorModelPool';
import {
  isAgentCliSettingsPanelMessage,
  type AgentCliSettingsPanelProvider,
  type AgentCliSettingsPanelState,
  type AgentCliSettingsScope,
} from './types';

export const AGENT_CLI_PANEL_SETTINGS = [
  'agentCliModels', 'agentCliThinkingLevels', 'agentCliStageModels', 'agentCliStageThinkingLevels',
] as const;
export type AgentCliPanelSetting = (typeof AGENT_CLI_PANEL_SETTINGS)[number];

export interface AgentCliSettingsInspection {
  readonly globalValue?: unknown;
  readonly workspaceValue?: unknown;
  readonly defaultValue?: unknown;
}

export interface AgentCliSettingsPanelDeps {
  readonly workspaceAvailable: () => boolean;
  readonly inspect: (key: AgentCliPanelSetting) => AgentCliSettingsInspection | undefined;
  readonly update: (key: AgentCliPanelSetting, value: AgentCliSettingsValue, scope: AgentCliSettingsScope) => PromiseLike<void>;
  readonly post: (state: AgentCliSettingsPanelState) => void;
  readonly suggestions: readonly Pick<AgentCliSettingsPanelProvider,
    'id' | 'label' | 'suggestedModels' | 'suggestedThinkingLevels' | 'thinkingApplied'>[];
}

function owns(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && Object.hasOwn(value, key);
}

export function createAgentCliSettingsPanelController(deps: AgentCliSettingsPanelDeps): {
  readonly handle: (message: unknown) => Promise<void>;
  readonly refresh: () => void;
} {
  let scope: AgentCliSettingsScope = deps.workspaceAvailable() ? 'workspace' : 'user';
  let error: string | null = null;
  // Serialize messages so rapid edits cannot race two reads of the same setting.
  let pending = Promise.resolve();

  const raw = (key: AgentCliPanelSetting): unknown => {
    const inspection = deps.inspect(key);
    return scope === 'workspace' ? inspection?.workspaceValue : inspection?.globalValue;
  };
  const inherited = (key: AgentCliPanelSetting): unknown => {
    const inspection = deps.inspect(key);
    if (scope === 'user') {
      return inspection?.defaultValue;
    }
    // VS Code merges object keys across scopes. A User provider/stage wins
    // over the extension default, but never becomes an editable Workspace value.
    const defaults = inspection?.defaultValue;
    const global = inspection?.globalValue;
    if (key === 'agentCliStageModels' || key === 'agentCliStageThinkingLevels') {
      return mergeAgentCliStagePreferences(defaults, global);
    }
    return {
      ...(typeof defaults === 'object' && defaults !== null ? defaults : {}),
      ...(typeof global === 'object' && global !== null ? global : {}),
    };
  };
  const refresh = (): void => {
    const workspaceAvailable = deps.workspaceAvailable();
    if (!workspaceAvailable) {
      scope = 'user';
    }
    const models = raw('agentCliModels');
    const levels = raw('agentCliThinkingLevels');
    const stageModels = raw('agentCliStageModels');
    const stageLevels = raw('agentCliStageThinkingLevels');
    const inheritedModels = inherited('agentCliModels');
    const inheritedLevels = inherited('agentCliThinkingLevels');
    const ownStageModels = readAgentCliStageModels(stageModels);
    const ownStageLevels = readAgentCliStageModels(stageLevels);
    const lowerStageModels = readAgentCliStageModels(inherited('agentCliStageModels'));
    const lowerStageLevels = readAgentCliStageModels(inherited('agentCliStageThinkingLevels'));
    deps.post({
      type: 'settingsState', scope, workspaceAvailable,
      inheritedScope: scope === 'workspace' ? 'User' : 'Extension default',
      providers: AGENT_CLI_PROVIDER_IDS.map((id) => {
        const suggestions = deps.suggestions.find((provider) => provider.id === id);
        return {
          id, label: suggestions?.label ?? AGENT_CLI_LABELS[id],
          models: agentCliSettingsEntries(models, id),
          thinkingLevels: agentCliSettingsEntries(levels, id),
          inheritedModels: owns(models, id) ? [] : agentCliSettingsEntries(inheritedModels, id),
          inheritedThinkingLevels: owns(levels, id) ? [] : agentCliSettingsEntries(inheritedLevels, id),
          suggestedModels: suggestions?.suggestedModels ?? [],
          suggestedThinkingLevels: suggestions?.suggestedThinkingLevels ?? [],
          thinkingApplied: suggestions?.thinkingApplied ?? true,
        };
      }),
      stages: AGENT_CLI_HANDOFF_KINDS.flatMap((id) => AGENT_CLI_STAGE_PROVIDER_IDS.map((provider) => {
        const executable = agentCliExecutableProvider(provider);
        const model = stageAgentCliModel(ownStageModels, id, provider) ?? null;
        const thinkingLevel = stageAgentCliModel(ownStageLevels, id, provider) ?? null;
        const configuredNames = (own: typeof ownStageModels, lower: typeof ownStageModels): string[] =>
          AGENT_CLI_HANDOFF_KINDS.flatMap((stage) => [
            stageAgentCliModel(own, stage, provider), stageAgentCliModel(lower, stage, provider),
          ]).filter((name): name is string => name !== undefined);
        const pool = cursorStagePool(provider);
        const stageModelNames = configuredNames(ownStageModels, lowerStageModels);
        const stageLevelNames = configuredNames(ownStageLevels, lowerStageLevels);
        // Prefer this identity's own catalog; fall back to the shared Cursor
        // executable catalog (filtered by pool) when the identity has none yet.
        const ownCatalogModels = [
          ...agentCliSettingsEntries(models, provider), ...agentCliSettingsEntries(inheritedModels, provider),
        ];
        const sharedCatalogModels = [
          ...agentCliSettingsEntries(models, executable), ...agentCliSettingsEntries(inheritedModels, executable),
        ];
        const catalogModels = ownCatalogModels.length > 0 ? ownCatalogModels : sharedCatalogModels;
        const catalogLevels = [
          ...agentCliSettingsEntries(levels, provider), ...agentCliSettingsEntries(inheritedLevels, provider),
          ...agentCliSettingsEntries(levels, executable), ...agentCliSettingsEntries(inheritedLevels, executable),
        ];
        return {
          id, provider,
          label: AGENT_CLI_LABELS[provider],
          // Cursor Agent CLI and Cursor Agent CLI Other have no effort flag.
          thinkingApplied: executable !== 'cursor',
          model, thinkingLevel,
          inheritedModel: model === null ? stageAgentCliModel(lowerStageModels, id, provider) ?? null : null,
          inheritedThinkingLevel: thinkingLevel === null ? stageAgentCliModel(lowerStageLevels, id, provider) ?? null : null,
          suggestedModels: [...new Set([
            ...filterCursorPoolSuggestions(catalogModels, pool),
            ...stageModelNames,
          ])],
          suggestedThinkingLevels: [...new Set([...catalogLevels, ...stageLevelNames])],
        };
      })),
      error,
    });
  };

  const processMessage = async (value: unknown): Promise<void> => {
    if (!isAgentCliSettingsPanelMessage(value)) {
      error = 'Invalid settings message; nothing was written.';
      refresh();
      return;
    }
    error = null;
    if (value.type === 'settingsReady') {
      refresh();
      return;
    }
    if (value.scope === 'workspace' && !deps.workspaceAvailable()) {
      error = 'Open a workspace folder to edit Workspace settings.';
      refresh();
      return;
    }
    if (value.type === 'settingsScope') {
      scope = value.scope;
      refresh();
      return;
    }
    if (value.scope !== scope) {
      error = 'The settings scope changed. Retry this edit in the selected scope.';
      refresh();
      return;
    }
    const key: AgentCliPanelSetting = value.type === 'settingsStageEdit'
      ? value.list === 'models' ? 'agentCliStageModels' : 'agentCliStageThinkingLevels'
      : value.list === 'models' ? 'agentCliModels' : 'agentCliThinkingLevels';
    const current = raw(key);
    let edit: AgentCliSettingsEdit;
    if (value.type === 'settingsStageEdit') {
      edit = value.action === 'remove'
        ? removeAgentCliSettingsStage(current, value.stage, value.provider)
        : setAgentCliSettingsStage(current, value.list, value.stage, value.provider, value.name);
    } else {
      switch (value.action) {
        case 'add':
          edit = addAgentCliSettingsEntry(current, value.list, value.provider, value.name);
          break;
        case 'remove':
          edit = removeAgentCliSettingsEntry(current, value.list, value.provider, value.name);
          break;
        case 'makeDefault':
          edit = makeAgentCliSettingsDefault(current, value.list, value.provider, value.name);
          break;
        case 'clear':
          edit = clearAgentCliSettingsProvider(current, value.list, value.provider);
          break;
      }
    }
    if (!edit.ok) {
      error = edit.reason;
      refresh();
      return;
    }
    try {
      await deps.update(key, edit.value, scope);
    } catch (cause) {
      error = `Could not save settings: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
    refresh();
  };

  return {
    refresh,
    handle: (message) => {
      pending = pending.then(() => processMessage(message));
      return pending;
    },
  };
}

/** Auto vs Other Models for Cursor stage rows; other stage providers are unfiltered. */
function cursorStagePool(provider: AgentCliStageProviderId): CursorUsagePoolId | undefined {
  if (provider === 'cursor') {
    return 'auto';
  }
  if (provider === 'cursor-other') {
    return 'other-models';
  }
  return undefined;
}

function filterCursorPoolSuggestions(
  names: readonly string[],
  pool: CursorUsagePoolId | undefined,
): string[] {
  if (pool === undefined) {
    return [...names];
  }
  return names.filter((name) => classifyCursorModelPool({ model: name }).pool === pool);
}
