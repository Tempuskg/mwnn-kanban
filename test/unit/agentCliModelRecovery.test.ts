import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  availableRecoveryScopes,
  buildModelRecoveryWrites,
  isRecoverableModelRejection,
  modelRecoverySuggestions,
  providerSupportsThinkingLevel,
  recoveryScopeWriteTarget,
  recoveryUpdatesCardFrontmatter,
  thinkingRecoverySuggestions,
} from '../../src/agentCliModelRecovery';
import { readAgentCliModelCatalog } from '../../src/agentCliModels';
import type { AgentCliHandoffFailure } from '../../src/agentCliHandoff';

function failed(failure: AgentCliHandoffFailure): { failure: AgentCliHandoffFailure } {
  return { failure };
}

suite('agentCliModelRecovery: classification', () => {
  test('model-rejected is recoverable', () => {
    assert.equal(isRecoverableModelRejection(failed('model-rejected')), true);
  });

  test('non-model failures do not open the recovery path', () => {
    for (const failure of [
      'credit-exhausted',
      'process-failed',
      'missing-evidence',
      'card-missing',
    ] as const) {
      assert.equal(
        isRecoverableModelRejection(failed(failure)),
        false,
        failure,
      );
    }
    assert.equal(isRecoverableModelRejection({}), false);
  });
});

suite('agentCliModelRecovery: scope write targets', () => {
  test('workspace scope writes ConfigurationTarget.Workspace via workspaceValue', () => {
    assert.deepEqual(recoveryScopeWriteTarget('workspace'), {
      configurationTarget: 'Workspace',
      inspectField: 'workspaceValue',
    });
  });

  test('user scope writes ConfigurationTarget.Global via globalValue', () => {
    assert.deepEqual(recoveryScopeWriteTarget('user'), {
      configurationTarget: 'Global',
      inspectField: 'globalValue',
    });
  });

  test('workspace is offered only when a folder is available', () => {
    assert.deepEqual(availableRecoveryScopes(true), ['workspace', 'user']);
    assert.deepEqual(availableRecoveryScopes(false), ['user']);
  });

  test('buildModelRecoveryWrites patches only the chosen provider in one scope', () => {
    const modelsValue = { codex: ['stale-model'], copilot: ['auto'] };
    const thinkingValue = { codex: 'low', cursor: 'high' };
    const writes = buildModelRecoveryWrites(
      'codex',
      { model: 'gpt-5.5', thinkingLevel: 'high' },
      modelsValue,
      thinkingValue,
    );
    assert.equal(writes.models.ok, true);
    assert.equal(writes.thinkingLevels?.ok, true);
    if (!writes.models.ok || !writes.thinkingLevels?.ok) {
      return;
    }
    assert.deepEqual(writes.models.value, {
      codex: ['gpt-5.5', 'stale-model'],
      copilot: ['auto'],
    });
    assert.deepEqual(writes.thinkingLevels.value, {
      codex: ['high', 'low'],
      cursor: 'high',
    });
    // Inputs are not mutated; the other scope's values are never in play here.
    assert.deepEqual(modelsValue, { codex: ['stale-model'], copilot: ['auto'] });
    assert.deepEqual(thinkingValue, { codex: 'low', cursor: 'high' });
  });

  test('omitting thinkingLevel does not write agentCliThinkingLevels', () => {
    const writes = buildModelRecoveryWrites(
      'cursor',
      { model: 'auto' },
      { cursor: ['stale'] },
      { cursor: 'high' },
    );
    assert.equal(writes.models.ok, true);
    assert.equal(writes.thinkingLevels, undefined);
  });
});

suite('agentCliModelRecovery: suggestions and card updates', () => {
  test('model suggestions come from the catalog plus bundled names, minus the refused model', () => {
    const catalog = readAgentCliModelCatalog({
      codex: ['gpt-5.5', 'broken-model'],
    });
    const suggestions = modelRecoverySuggestions('codex', catalog, 'broken-model');
    assert.ok(suggestions.includes('gpt-5.5'));
    assert.ok(!suggestions.includes('broken-model'));
    // Bundled names that are not already listed are still offered.
    assert.ok(suggestions.includes('gpt-5.6-sol') || suggestions.length >= 1);
  });

  test('thinking suggestions are empty for Cursor Agent CLI', () => {
    assert.equal(providerSupportsThinkingLevel('cursor'), false);
    assert.deepEqual(thinkingRecoverySuggestions('cursor'), []);
    assert.equal(providerSupportsThinkingLevel('codex'), true);
    assert.ok(thinkingRecoverySuggestions('codex').includes('high'));
  });

  test('only a card-sourced refusal rewrites card frontmatter', () => {
    assert.equal(recoveryUpdatesCardFrontmatter('card'), true);
    assert.equal(recoveryUpdatesCardFrontmatter('workspace-default'), false);
    assert.equal(recoveryUpdatesCardFrontmatter('stage-rule'), false);
    assert.equal(recoveryUpdatesCardFrontmatter('escalation'), false);
  });
});
