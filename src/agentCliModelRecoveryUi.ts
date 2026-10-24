/**
 * QuickPick recovery UI when Define/Run with AI fails because the selected
 * agent CLI refused the model name it was given. Reuses the same suggestion
 * sources and scoped-write rules as the Agent CLI Models panel.
 */
import * as vscode from 'vscode';
import {
  availableRecoveryScopes,
  buildModelRecoveryWrites,
  modelRecoveryTitle,
  recoveryScopeLabel,
  recoveryScopeWriteTarget,
  type AgentCliModelRecoveryRequest,
  type AgentCliModelRecoverySelection,
  type AgentCliRecoveryScope,
} from './agentCliModelRecovery';
import { agentCliSettingsEntryProblem } from './agentCliSettingsEditor';

export interface AgentCliModelRecoveryUiDeps {
  /** True when at least one workspace folder is open. */
  readonly workspaceAvailable: () => boolean;
  /** Read one scope's own raw value for a setting key under `mwnn-kanban`. */
  readonly inspectScoped: (
    key: 'agentCliModels' | 'agentCliThinkingLevels',
    scope: AgentCliRecoveryScope,
  ) => unknown;
  /** Write one setting at the chosen scope's configuration target. */
  readonly updateScoped: (
    key: 'agentCliModels' | 'agentCliThinkingLevels',
    value: unknown,
    scope: AgentCliRecoveryScope,
  ) => Promise<void>;
  readonly pick: <T extends vscode.QuickPickItem>(
    items: readonly T[],
    options: vscode.QuickPickOptions,
  ) => PromiseLike<T | undefined>;
  readonly enter: (options: vscode.InputBoxOptions) => PromiseLike<string | undefined>;
  readonly warn: (message: string) => void;
  readonly status: (message: string) => void;
}

/**
 * Ask the user for a working model (and thinking level when the CLI supports
 * it), which settings scope to update, then write only that scope and return
 * the selection for an immediate re-dispatch. Escape at any step writes
 * nothing and returns undefined.
 */
export async function promptAndApplyModelRecovery(
  request: AgentCliModelRecoveryRequest,
  deps: AgentCliModelRecoveryUiDeps,
): Promise<AgentCliModelRecoverySelection | undefined> {
  const title = modelRecoveryTitle(request.provider);
  const model = await pickOrEnterName(
    title,
    'model',
    request.modelSuggestions,
    `Pick a model ${request.providerLabel} accepts (refused "${request.rejectedModel}")`,
    deps,
  );
  if (model === undefined) {
    return undefined;
  }

  let thinkingLevel: string | undefined;
  if (request.thinkingSupported) {
    const levelPick = await pickThinkingLevel(
      title,
      request.thinkingSuggestions,
      deps,
    );
    // Undefined means the user cancelled the whole recovery.
    if (levelPick === undefined) {
      return undefined;
    }
    // Empty string means "keep CLI default" — do not write a thinking level.
    if (levelPick.length > 0) {
      thinkingLevel = levelPick;
    }
  }

  // Prefer the live workspace check so a stale request flag cannot offer a
  // workspace write when no folder is open.
  const scopes = availableRecoveryScopes(
    request.workspaceAvailable && deps.workspaceAvailable(),
  );
  const scope = await pickScope(title, scopes, deps);
  if (scope === undefined) {
    return undefined;
  }

  const modelsValue = deps.inspectScoped('agentCliModels', scope);
  const thinkingValue = deps.inspectScoped('agentCliThinkingLevels', scope);
  const writes = buildModelRecoveryWrites(
    request.provider,
    { model, ...(thinkingLevel !== undefined ? { thinkingLevel } : {}) },
    modelsValue,
    thinkingValue,
  );
  if (!writes.models.ok) {
    deps.warn(`MWNN Kanban: ${writes.models.reason}`);
    return undefined;
  }
  if (writes.thinkingLevels && !writes.thinkingLevels.ok) {
    deps.warn(`MWNN Kanban: ${writes.thinkingLevels.reason}`);
    return undefined;
  }

  try {
    await deps.updateScoped('agentCliModels', writes.models.value, scope);
    if (writes.thinkingLevels?.ok) {
      await deps.updateScoped(
        'agentCliThinkingLevels',
        writes.thinkingLevels.value,
        scope,
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    deps.warn(`MWNN Kanban: could not write the settings: ${message}`);
    return undefined;
  }

  deps.status(
    `MWNN Kanban: saved ${request.providerLabel} model in ${recoveryScopeLabel(scope).toLowerCase()} settings; retrying…`,
  );
  return {
    model,
    scope,
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
  };
}

async function pickOrEnterName(
  title: string,
  noun: string,
  suggestions: readonly string[],
  placeHolder: string,
  deps: AgentCliModelRecoveryUiDeps,
): Promise<string | undefined> {
  const enterLabel = `$(edit) Enter a ${noun}…`;
  if (suggestions.length > 0) {
    const picked = await deps.pick(
      [...suggestions.map((name) => ({ label: name })), { label: enterLabel }],
      { title, placeHolder },
    );
    if (!picked) {
      return undefined;
    }
    if (picked.label !== enterLabel) {
      return picked.label;
    }
  }
  return deps.enter({
    title,
    prompt: `Enter a ${noun}, spelled exactly as the CLI accepts it.`,
    validateInput: (value) => agentCliSettingsEntryProblem([], value, noun) ?? null,
  });
}

/**
 * Returns a level name, `""` for CLI default, or `undefined` when cancelled.
 */
async function pickThinkingLevel(
  title: string,
  suggestions: readonly string[],
  deps: AgentCliModelRecoveryUiDeps,
): Promise<string | undefined> {
  const defaultLabel = '$(circle-slash) Use CLI default thinking level';
  const enterLabel = '$(edit) Enter a thinking level…';
  const items = [
    ...suggestions.map((name) => ({ label: name })),
    { label: defaultLabel },
    { label: enterLabel },
  ];
  const picked = await deps.pick(items, {
    title,
    placeHolder: 'Pick a thinking level this CLI accepts (optional)',
  });
  if (!picked) {
    return undefined;
  }
  if (picked.label === defaultLabel) {
    return '';
  }
  if (picked.label !== enterLabel) {
    return picked.label;
  }
  return deps.enter({
    title,
    prompt: 'Enter a thinking level, spelled exactly as the CLI accepts it.',
    validateInput: (value) =>
      agentCliSettingsEntryProblem([], value, 'thinking level') ?? null,
  });
}

async function pickScope(
  title: string,
  scopes: readonly AgentCliRecoveryScope[],
  deps: AgentCliModelRecoveryUiDeps,
): Promise<AgentCliRecoveryScope | undefined> {
  if (scopes.length === 1) {
    return scopes[0];
  }
  const items = scopes.map((scope) => ({
    label: recoveryScopeLabel(scope),
    description: scope === 'workspace' ? 'Only this workspace' : 'Every workspace',
    scope,
  }));
  const picked = await deps.pick(items, {
    title,
    placeHolder: 'Save the working model where?',
  });
  return picked?.scope;
}

/** Default deps wired to the live VS Code configuration API. */
export function createModelRecoveryUiDeps(): AgentCliModelRecoveryUiDeps {
  const workspaceFolder = () => vscode.workspace.workspaceFolders?.[0];
  return {
    workspaceAvailable: () => (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
    inspectScoped: (key, scope) => {
      const inspected = vscode.workspace
        .getConfiguration('mwnn-kanban', workspaceFolder()?.uri)
        .inspect<unknown>(key);
      return recoveryScopeWriteTarget(scope).inspectField === 'workspaceValue'
        ? inspected?.workspaceValue
        : inspected?.globalValue;
    },
    updateScoped: async (key, value, scope) => {
      const target =
        recoveryScopeWriteTarget(scope).configurationTarget === 'Workspace'
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
      await vscode.workspace
        .getConfiguration('mwnn-kanban', workspaceFolder()?.uri)
        .update(key, value, target);
    },
    pick: (items, options) => vscode.window.showQuickPick([...items], options),
    enter: (options) => vscode.window.showInputBox(options),
    warn: (message) => {
      void vscode.window.showWarningMessage(message);
    },
    status: (message) => {
      vscode.window.setStatusBarMessage(message, 4000);
    },
  };
}
