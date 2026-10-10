import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  REJECTED_MODEL_TTL_MS,
  forgetRejectedAgentCliModel,
  readRejectedAgentCliModels,
  recordRejectedAgentCliModel,
  withoutRejectedAgentCliModels,
} from '../../src/agentCliRejectedModels';

const NOW = Date.parse('2026-10-07T18:22:38.000Z');

suite('models an agent CLI refused', () => {
  test('a refused model is left out of that provider\'s candidates only', () => {
    const records = recordRejectedAgentCliModel([], 'copilot', 'gpt-5.3-codex', NOW);
    const filtered = withoutRejectedAgentCliModels(
      {
        copilot: ['auto', 'gpt-5.5', 'gpt-5.3-codex', 'claude-sonnet-5'],
        codex: ['gpt-5.3-codex', 'gpt-5.5'],
      },
      records,
    );
    assert.deepEqual(filtered.copilot, ['auto', 'gpt-5.5', 'claude-sonnet-5']);
    assert.deepEqual(filtered.codex, ['gpt-5.3-codex', 'gpt-5.5']);
  });

  test('a provider left with no candidates is dropped', () => {
    const records = recordRejectedAgentCliModel([], 'cursor', 'auto', NOW);
    assert.equal(withoutRejectedAgentCliModels({ cursor: ['auto'] }, records).cursor, undefined);
  });

  test('a later completed run on the same model forgets the refusal', () => {
    const records = recordRejectedAgentCliModel([], 'copilot', 'gpt-5.3-codex', NOW);
    assert.deepEqual(forgetRejectedAgentCliModel(records, 'copilot', 'gpt-5.3-codex'), []);
    assert.equal(forgetRejectedAgentCliModel(records, 'codex', 'gpt-5.3-codex').length, 1);
  });

  test('stored records are validated, deduplicated, and expire', () => {
    const raw: unknown[] = [
      { provider: 'copilot', model: 'gpt-5.3-codex', at: NOW - 1000 },
      { provider: 'copilot', model: ' gpt-5.3-codex ', at: NOW },
      { provider: 'copilot', model: 'old-model', at: NOW - REJECTED_MODEL_TTL_MS - 1 },
      { provider: 'nope', model: 'x', at: NOW },
      { provider: 'codex', model: '', at: NOW },
      { provider: 'codex', model: 'x', at: 'yesterday' },
      null,
      'copilot',
    ];
    assert.deepEqual(readRejectedAgentCliModels(raw, NOW), [
      { provider: 'copilot', model: 'gpt-5.3-codex', at: NOW },
    ]);
    assert.deepEqual(readRejectedAgentCliModels(undefined, NOW), []);
  });

  test('recording the same refusal again keeps one record with the newest time', () => {
    let records = recordRejectedAgentCliModel([], 'copilot', 'gpt-5.3-codex', NOW - 5000);
    records = recordRejectedAgentCliModel(records, 'copilot', 'gpt-5.3-codex', NOW);
    assert.deepEqual(records, [{ provider: 'copilot', model: 'gpt-5.3-codex', at: NOW }]);
  });
});
