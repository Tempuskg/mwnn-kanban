import { manageAgentCliStage, type AgentCliStageMenuItem } from '../../src/agentCliSettingsQuickPick';
import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  createAgentCliSettingsPanelController,
  type AgentCliPanelSetting,
  type AgentCliSettingsInspection,
} from '../../src/agentCliSettingsPanelController';
import type { AgentCliSettingsPanelState, AgentCliSettingsScope } from '../../src/types';

function fixture(workspace = true) {
  const settings: Partial<Record<AgentCliPanelSetting, AgentCliSettingsInspection>> = {};
  const writes: { key: AgentCliPanelSetting; value: unknown; scope: AgentCliSettingsScope }[] = [];
  let posted: AgentCliSettingsPanelState | undefined;
  let workspaceAvailable = workspace;
  let fail = false;
  const controller = createAgentCliSettingsPanelController({
    workspaceAvailable: () => workspaceAvailable,
    inspect: (key) => settings[key],
    update: async (key, value, scope) => {
      if (fail) { throw new Error('settings file is read-only'); }
      writes.push({ key, value, scope });
      settings[key] = { ...settings[key], [scope === 'workspace' ? 'workspaceValue' : 'globalValue']: value };
    },
    post: (state) => { posted = state; },
    suggestions: [{ id: 'codex', label: 'Codex', suggestedModels: ['bundled'], suggestedThinkingLevels: ['high', 'low'], thinkingApplied: true },
      { id: 'cursor', label: 'Cursor', suggestedModels: ['auto'], suggestedThinkingLevels: [], thinkingApplied: false }],
  });
  const state = (): AgentCliSettingsPanelState => {
    assert.ok(posted);
    return posted;
  };
  return { ...controller, settings, writes, state,
    setWorkspace: (value: boolean) => { workspaceAvailable = value; },
    failWrites: () => { fail = true; },
  };
}

function listEdit(action: 'add' | 'remove' | 'makeDefault' | 'clear', name: string, scope: AgentCliSettingsScope = 'workspace', list = 'models') {
  return { type: 'settingsListEdit', scope, list, provider: 'codex', action, name };
}

function stageEdit(action: 'set' | 'remove', name: string, scope: AgentCliSettingsScope = 'workspace', list = 'models', stage = 'implementation') {
  return { type: 'settingsStageEdit', scope, list, stage, provider: 'codex', action, name };
}

suite('Agent CLI settings panel host bridge', () => {
  test('starts in Workspace, lists all providers, and exposes bundled suggestions', async () => {
    const f = fixture();
    await f.handle({ type: 'settingsReady' });
    assert.equal(f.state().scope, 'workspace');
    assert.equal(f.state().workspaceAvailable, true);
    assert.equal(f.state().providers.length, 4);
    const codex = f.state().providers.find((p) => p.id === 'codex');
    assert.deepEqual(codex?.suggestedModels, ['bundled']);
    assert.deepEqual(codex?.suggestedThinkingLevels, ['high', 'low']);
    assert.equal(f.state().providers.find((p) => p.id === 'cursor')?.thinkingApplied, false);
    assert.equal(f.writes.length, 0);
  });

  test('scope selection reads own values and labels lower values without copying them', async () => {
    const f = fixture();
    f.settings.agentCliModels = { globalValue: { codex: ['user-a', 'user-b'] }, workspaceValue: { copilot: ['workspace'] } };
    f.settings.agentCliThinkingLevels = { globalValue: { codex: 'high' } };
    await f.handle({ type: 'settingsReady' });
    const codex = f.state().providers.find((p) => p.id === 'codex');
    assert.deepEqual(codex?.models, []);
    assert.deepEqual(codex?.inheritedModels, ['user-a', 'user-b']);
    assert.deepEqual(codex?.thinkingLevels, []);
    assert.deepEqual(codex?.inheritedThinkingLevels, ['high']);
    assert.equal(f.state().inheritedScope, 'User');
    await f.handle(listEdit('add', 'new'));
    assert.deepEqual(f.writes, [{ key: 'agentCliModels', value: { copilot: ['workspace'], codex: ['new'] }, scope: 'workspace' }]);
    assert.deepEqual(f.settings.agentCliModels.globalValue, { codex: ['user-a', 'user-b'] });
    assert.deepEqual(f.state().providers.find((p) => p.id === 'codex')?.inheritedModels, []);
    await f.handle({ type: 'settingsScope', scope: 'user' });
    assert.deepEqual(f.state().providers.find((p) => p.id === 'codex')?.models, ['user-a', 'user-b']);
    assert.deepEqual(f.state().providers.find((p) => p.id === 'copilot')?.models, []);
  });

  test('no folder means User only and Workspace edits are rejected', async () => {
    const f = fixture(false);
    await f.handle({ type: 'settingsReady' });
    assert.equal(f.state().scope, 'user');
    assert.equal(f.state().workspaceAvailable, false);
    await f.handle({ type: 'settingsScope', scope: 'workspace' });
    assert.match(f.state().error ?? '', /Open a workspace folder/);
    await f.handle(listEdit('add', 'x'));
    assert.equal(f.writes.length, 0);
    await f.handle(listEdit('add', 'user-only', 'user'));
    assert.deepEqual(f.writes[0], { key: 'agentCliModels', value: { codex: ['user-only'] }, scope: 'user' });
  });

  test('add, make default and remove preserve ordering and other scoped entries', async () => {
    const f = fixture();
    f.settings.agentCliModels = { workspaceValue: { codex: ['a', 'b'], custom: { keep: true } } };
    await f.handle(listEdit('add', ' c '));
    await f.handle(listEdit('makeDefault', 'c'));
    await f.handle(listEdit('remove', 'b'));
    assert.deepEqual(f.writes.map((w) => w.value), [
      { codex: ['a', 'b', 'c'], custom: { keep: true } },
      { codex: ['c', 'a', 'b'], custom: { keep: true } },
      { codex: ['c', 'a'], custom: { keep: true } },
    ]);
    assert.deepEqual(f.state().providers.find((p) => p.id === 'codex')?.models, ['c', 'a']);
  });

  test('thinking set, add suggestion, remove and clear use editor shapes in User scope', async () => {
    const f = fixture();
    f.settings.agentCliThinkingLevels = { workspaceValue: { codex: 'max' } };
    await f.handle({ type: 'settingsScope', scope: 'user' });
    await f.handle(listEdit('makeDefault', 'high', 'user', 'thinkingLevels'));
    await f.handle(listEdit('add', 'low', 'user', 'thinkingLevels'));
    await f.handle(listEdit('remove', 'high', 'user', 'thinkingLevels'));
    await f.handle(listEdit('clear', '', 'user', 'thinkingLevels'));
    assert.deepEqual(f.writes.map((w) => w.value), [{ codex: 'high' }, { codex: ['high', 'low'] }, { codex: 'low' }, undefined]);
    assert.ok(f.writes.every((w) => w.scope === 'user' && w.key === 'agentCliThinkingLevels'));
    assert.deepEqual(f.settings.agentCliThinkingLevels.workspaceValue, { codex: 'max' });
  });

  test('stage overrides add, change and remove without copying inherited stages', async () => {
    const f = fixture();
    f.settings.agentCliStageModels = { globalValue: { definition: 'inherited' }, workspaceValue: { triage: 'local', future: 'preserved' } };
    await f.handle({ type: 'settingsReady' });
    assert.equal(f.state().stages.find((s) => s.id === 'definition' && s.provider === 'codex')?.model, null);
    assert.equal(f.state().stages.find((s) => s.id === 'definition')?.inheritedModel, 'inherited');
    await f.handle(stageEdit('set', ' a '));
    await f.handle(stageEdit('set', 'b'));
    await f.handle(stageEdit('remove', ''));
    assert.deepEqual(f.writes.map((w) => w.value), [
      { triage: 'local', future: 'preserved', implementation: { codex: 'a' } },
      { triage: 'local', future: 'preserved', implementation: { codex: 'b' } },
      { triage: 'local', future: 'preserved' },
    ]);
    assert.deepEqual(f.settings.agentCliStageModels.globalValue, { definition: 'inherited' });
    await f.handle({ type: 'settingsScope', scope: 'user' });
    await f.handle(stageEdit('set', 'high', 'user', 'thinkingLevels', 'verification'));
    assert.deepEqual(f.writes.at(-1), { key: 'agentCliStageThinkingLevels', value: { verification: { codex: 'high' } }, scope: 'user' });
    await f.handle(stageEdit('remove', '', 'user', 'thinkingLevels', 'verification'));
    assert.equal(f.writes.at(-1)?.value, undefined);
  });

  test('every AI loop stage supports both kinds of override', async () => {
    const f = fixture();
    for (const stage of ['definition', 'triage', 'implementation', 'verification']) {
      await f.handle(stageEdit('set', 'model', 'workspace', 'models', stage));
      await f.handle(stageEdit('set', 'level', 'workspace', 'thinkingLevels', stage));
    }
    assert.equal(f.writes.length, 8);
    assert.ok(f.state().stages.filter((s) => s.provider === 'codex').every((s) => s.model === 'model' && s.thinkingLevel === 'level'));
  });

  test('duplicate, blank, invalid stage and malformed messages write nothing and give a reason', async () => {
    const f = fixture();
    f.settings.agentCliModels = { workspaceValue: { codex: ['a'] } };
    await f.handle(listEdit('add', ' a '));
    assert.match(f.state().error ?? '', /already in the list/);
    await f.handle(listEdit('add', '   '));
    assert.match(f.state().error ?? '', /blank/);
    await f.handle(stageEdit('set', ' '));
    assert.match(f.state().error ?? '', /blank/);
    for (const message of [null, { type: 'settingsScope', scope: 'folder' }, stageEdit('set', 'x', 'workspace', 'models', 'unknown'),
      { ...listEdit('add', 'x'), provider: 'unknown' }, { ...listEdit('add', 'x'), action: { toString: () => 'add' } }]) {
      await f.handle(message);
      assert.match(f.state().error ?? '', /Invalid settings message/);
    }
    assert.equal(f.writes.length, 0);
    assert.deepEqual(f.settings.agentCliModels.workspaceValue, { codex: ['a'] });
  });

  test('a stale scope message cannot write to the newly selected scope', async () => {
    const f = fixture();
    await f.handle({ type: 'settingsScope', scope: 'user' });
    await f.handle(listEdit('add', 'stale'));
    assert.equal(f.writes.length, 0);
    assert.match(f.state().error ?? '', /scope changed/);
  });

  test('external settings changes refresh own and inherited values on the next refresh', async () => {
    const f = fixture();
    await f.handle({ type: 'settingsReady' });
    f.settings.agentCliModels = { workspaceValue: { codex: ['outside', 'next'] } };
    f.settings.agentCliThinkingLevels = { globalValue: { codex: ['low', 'high'] } };
    f.settings.agentCliStageThinkingLevels = { workspaceValue: { definition: 'medium' } };
    f.refresh();
    assert.deepEqual(f.state().providers.find((p) => p.id === 'codex')?.models, ['outside', 'next']);
    assert.deepEqual(f.state().providers.find((p) => p.id === 'codex')?.inheritedThinkingLevels, ['low', 'high']);
    assert.equal(f.state().stages.find((s) => s.id === 'definition')?.thinkingLevel, 'medium');
    assert.equal(f.writes.length, 0);
    f.setWorkspace(false);
    f.refresh();
    assert.equal(f.state().scope, 'user');
  });

  test('rapid edits are serialized and do not lose a previously written model', async () => {
    const f = fixture();
    await Promise.all([f.handle(listEdit('add', 'a')), f.handle(listEdit('add', 'b'))]);
    assert.deepEqual(f.writes.at(-1)?.value, { codex: ['a', 'b'] });
  });

  test('write failures are reported in the panel', async () => {
    const f = fixture();
    f.failWrites();
    await f.handle(listEdit('add', 'a'));
    assert.match(f.state().error ?? '', /settings file is read-only/);
    assert.equal(f.writes.length, 0);
  });

  test('explicit empty provider values suppress inherited values and clearing restores inheritance', async () => {
    const f = fixture();
    f.settings.agentCliModels = { workspaceValue: { codex: [] }, globalValue: { codex: ['inherited'] } };
    await f.handle({ type: 'settingsReady' });
    assert.deepEqual(f.state().providers.find((p) => p.id === 'codex')?.inheritedModels, []);
    await f.handle(listEdit('clear', ''));
    assert.deepEqual(f.state().providers.find((p) => p.id === 'codex')?.inheritedModels, ['inherited']);
  });
  test('all sixteen stage/CLI pairs edit independently and suggestions never cross CLIs', async () => {
    const f = fixture();
    f.settings.agentCliModels = { globalValue: { codex: ['codex-default'], cursor: ['cursor-default'] } };
    for (const stage of ['definition', 'triage', 'implementation', 'verification']) {
      for (const provider of ['copilot', 'codex', 'claude-code', 'cursor']) {
        await f.handle({ ...stageEdit('set', stage + '-' + provider, 'workspace', 'models', stage), provider });
        await f.handle({ ...stageEdit('set', provider + '-effort', 'workspace', 'thinkingLevels', stage), provider });
      }
    }
    assert.equal(f.state().stages.length, 16);
    for (const entry of f.state().stages) {
      assert.equal(entry.model, entry.id + '-' + entry.provider);
      assert.equal(entry.thinkingLevel, entry.provider + '-effort');
      assert.ok(entry.suggestedModels.every((name) => name.includes(entry.provider)));
      assert.ok(entry.suggestedThinkingLevels.every((name) => name.startsWith(entry.provider)));
    }
    assert.deepEqual(f.settings.agentCliModels.globalValue, { codex: ['codex-default'], cursor: ['cursor-default'] });
  });

  test('editing a legacy scoped stage preserves unedited CLIs and clearing restores the lower scope', async () => {
    const f = fixture();
    f.settings.agentCliStageModels = {
      globalValue: { implementation: { codex: 'inherited-codex', cursor: 'inherited-cursor' } },
      workspaceValue: { implementation: 'legacy', triage: { cursor: 'keep' } },
    };
    await f.handle(stageEdit('set', 'custom: off-list name'));
    assert.deepEqual(f.writes.at(-1)?.value, {
      implementation: { copilot: 'legacy', codex: 'custom: off-list name', 'claude-code': 'legacy', cursor: 'legacy' },
      triage: { cursor: 'keep' },
    });
    await f.handle(stageEdit('remove', ''));
    const codex = f.state().stages.find((s) => s.id === 'implementation' && s.provider === 'codex');
    assert.equal(codex?.model, null);
    assert.equal(codex?.inheritedModel, 'inherited-codex');
    assert.equal(f.state().stages.find((s) => s.id === 'implementation' && s.provider === 'cursor')?.model, 'legacy');
    assert.deepEqual(f.settings.agentCliStageModels.globalValue, { implementation: { codex: 'inherited-codex', cursor: 'inherited-cursor' } });
  });

  test('model-only and level-only edits never write the other setting or inherited siblings', async () => {
    const f = fixture();
    f.settings.agentCliStageModels = { globalValue: { implementation: 'shared-user' } };
    await f.handle(stageEdit('set', 'just-model'));
    assert.deepEqual(f.writes.at(-1)?.value, { implementation: { codex: 'just-model' } });
    assert.equal(f.settings.agentCliStageThinkingLevels, undefined);
    assert.equal(f.state().stages.find((s) => s.id === 'implementation' && s.provider === 'cursor')?.inheritedModel, 'shared-user');
    await f.handle(stageEdit('set', 'only-level', 'workspace', 'thinkingLevels', 'definition'));
    assert.deepEqual(f.writes.at(-1)?.value, { definition: { codex: 'only-level' } });
  });

  test('missing/unknown provider and unusable names are visible errors with no writes', async () => {
    const f = fixture();
    for (const message of [
      { ...stageEdit('set', 'x'), provider: undefined }, { ...stageEdit('set', 'x'), provider: 'future-cli' },
      stageEdit('set', 'bad\u0000name'), stageEdit('set', 'bad\nname'),
    ]) {
      await f.handle(message);
      assert.ok(f.state().error);
    }
    assert.equal(f.writes.length, 0);
  });

  test('the quick-pick stage flow sets and removes each axis through the panel controller in either scope', async () => {
    for (const scope of ['user', 'workspace'] as const) {
      const f = fixture();
      f.settings.agentCliStageModels = { globalValue: { implementation: 'user-shared' } };
      await f.handle({ type: 'settingsScope', scope });
      const choices = [
        { action: 'set', list: 'models' }, { action: 'set', list: 'thinkingLevels' },
        { action: 'remove', list: 'models' }, { action: 'remove', list: 'thinkingLevels' },
        { action: 'back', list: 'models' },
      ] as const;
      let index = 0;
      const warnings: string[] = [];
      const outcome = await manageAgentCliStage('implementation', 'codex', {
        title: 'test', readState: () => f.state(), handle: f.handle,
        pick: async (items: readonly AgentCliStageMenuItem[]) => {
          const choice = choices[index++];
          assert.ok(choice);
          const item = items.find((candidate) => candidate.action === choice.action && candidate.list === choice.list);
          assert.ok(item);
          return item;
        },
        enterName: async (noun, suggestions) => {
          assert.ok(!suggestions.includes('bundled'), 'stage suggestions are configured values only');
          return noun === 'model name' ? 'off-list-model' : 'custom-effort';
        },
        warn: (message) => warnings.push(message),
      });
      assert.equal(outcome, true);
      assert.equal(f.writes.length, 4);
      assert.ok(f.writes.every((write) => write.scope === scope));
      const codex = f.state().stages.find((s) => s.id === 'implementation' && s.provider === 'codex');
      assert.equal(codex?.model, null);
      assert.equal(codex?.thinkingLevel, null);
      if (scope === 'workspace') {
        assert.equal(codex?.inheritedModel, 'user-shared');
        assert.equal(f.settings.agentCliStageModels.workspaceValue, undefined);
        assert.deepEqual(f.settings.agentCliStageModels.globalValue, { implementation: 'user-shared' });
      } else {
        assert.deepEqual(f.settings.agentCliStageModels.globalValue, { implementation: { copilot: 'user-shared', 'claude-code': 'user-shared', cursor: 'user-shared' } });
      }
      assert.deepEqual(warnings, []);
    }
  });

  test('quick-pick cancellation and invalid free-form names do not write settings', async () => {
    const f = fixture();
    await f.handle({ type: 'settingsReady' });
    let asked = false;
    const warnings: string[] = [];
    assert.equal(await manageAgentCliStage('triage', 'codex', {
      title: 'test', readState: f.state, handle: f.handle,
      pick: async (items) => { if (asked) { return undefined; } asked = true; return items[0]; },
      enterName: async () => 'bad\u0000name', warn: (message) => warnings.push(message),
    }), false);
    assert.equal(f.writes.length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /control characters/);
  });

});
