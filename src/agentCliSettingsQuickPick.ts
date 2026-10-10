import type { AgentCliProviderId } from './agentCliProviders';
import type { AgentCliHandoffKind } from './agentCliStages';
import type { AgentCliSettingsPanelStage, AgentCliSettingsPanelState, AgentCliPanelList } from './types';

export interface AgentCliStageMenuItem {
  readonly label: string;
  readonly action: 'set' | 'remove' | 'back';
  readonly list: AgentCliPanelList;
}

export interface AgentCliStageQuickPickDeps {
  readonly title: string;
  readonly readState: () => AgentCliSettingsPanelState;
  readonly handle: (message: unknown) => Promise<void>;
  readonly pick: (items: readonly AgentCliStageMenuItem[], options: { title: string; placeHolder: string }) => PromiseLike<AgentCliStageMenuItem | undefined>;
  readonly enterName: (noun: string, suggestions: readonly string[]) => PromiseLike<string | undefined>;
  readonly warn: (message: string) => void;
}

export function stagePreferenceDescription(entry: AgentCliSettingsPanelStage, inheritedScope: string): string {
  const describe = (own: string | null, lower: string | null): string => own ??
    (lower === null ? 'provider default' : lower + ' (inherited from ' + inheritedScope + ')');
  return 'model: ' + describe(entry.model, entry.inheritedModel) + ' · thinking: ' +
    describe(entry.thinkingLevel, entry.inheritedThinkingLevel) +
    (entry.provider === 'cursor' ? ' (not applied by this CLI)' : '');
}

/** Uses the same scope isolation, validation and conversion as the panel. */
export async function manageAgentCliStage(
  stage: AgentCliHandoffKind,
  provider: AgentCliProviderId,
  deps: AgentCliStageQuickPickDeps,
): Promise<boolean> {
  const { readState, handle, title } = deps;
  for (;;) {
    const state = readState();
    const entry = state.stages.find((item) => item.id === stage && item.provider === provider);
    if (!entry) {
      return false;
    }
    const picked = await deps.pick([
      { label: 'Set model override…', action: 'set', list: 'models' },
      ...(entry.model === null ? [] : [{ label: 'Remove model override', action: 'remove', list: 'models' } as const]),
      { label: 'Set thinking-level override…', action: 'set', list: 'thinkingLevels' },
      ...(entry.thinkingLevel === null ? [] : [{ label: 'Remove thinking-level override', action: 'remove', list: 'thinkingLevels' } as const]),
      { label: '$(arrow-left) Back', action: 'back', list: 'models' },
    ] as const, { title, placeHolder: stagePreferenceDescription(entry, state.inheritedScope) + ' (' + state.scope + ' settings)' });
    if (!picked) {
      return false;
    }
    if (picked.action === 'back') {
      return true;
    }
    const name = picked.action === 'remove' ? '' : await deps.enterName(
      picked.list === 'models' ? 'model name' : 'thinking level',
      picked.list === 'models' ? entry.suggestedModels : entry.suggestedThinkingLevels,
    );
    if (name !== undefined) {
      await handle({ type: 'settingsStageEdit', scope: state.scope, stage, provider, list: picked.list, action: picked.action, name });
      const updated = readState();
      if (updated.error) {
        deps.warn(updated.error);
      }
    }
  }
}

