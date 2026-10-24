import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { AGENT_CLI_PROVIDER_IDS } from '../../src/agentCliProviders';
import {
  CURSOR_AMBIGUOUS_MODEL_IDS,
  CURSOR_AUTO_POOL_DISPLAY_NAME,
  CURSOR_AUTO_POOL_EXACT_IDS,
  CURSOR_AUTO_POOL_PREFIXES,
  CURSOR_OTHER_MODELS_DISPLAY_NAME,
  classifyCursorModelPool,
  type CursorModelPool,
} from '../../src/cursorModelPool';

function classify(model?: string, productDefault?: string): CursorModelPool {
  return classifyCursorModelPool({
    ...(model !== undefined ? { model } : {}),
    ...(productDefault !== undefined ? { productDefault } : {}),
  });
}

suite('Cursor model-to-pool classifier', () => {
  test('allow-list hits map to Auto and the Cursor display name', () => {
    const hits = [
      'auto',
      'Auto',
      ' AUTO ',
      'composer',
      'Composer-2.5',
      'composer-2.5-fast',
      'Composer 2.5',
      'composer_2',
      'grok-4.5',
      'grok-4.6-fast',
      'grok-4.7',
      'grok-4.7-fast',
      'grok-4.7-500k',
      'Grok 4.7',
      'grok-4-7',
      'grok-4-5-fast',
    ];
    for (const model of hits) {
      assert.deepEqual(classify(model, 'claude-opus-5.5'), {
        pool: 'auto',
        displayName: CURSOR_AUTO_POOL_DISPLAY_NAME,
      }, model);
    }
    assert.ok(CURSOR_AUTO_POOL_EXACT_IDS.includes('auto'));
    assert.ok(CURSOR_AUTO_POOL_PREFIXES.includes('composer'));
    assert.ok(CURSOR_AUTO_POOL_PREFIXES.includes('grok-4.7'));
  });

  test('a resolved name outside the allow-list is Other Models', () => {
    const others = [
      'claude-opus-5.5',
      'claude-sonnet-5.5',
      'gpt-5.6-sol',
      'gpt-5.4',
      'gemini-3.1-pro',
      'grok-4',
      'grok-3',
      'grok-code',
      'composerfoo',
      'automatic',
      'cursor',
      'some-future-model',
    ];
    for (const model of others) {
      assert.deepEqual(classify(model, 'auto'), {
        pool: 'other-models',
        displayName: CURSOR_OTHER_MODELS_DISPLAY_NAME,
      }, model);
    }
  });

  test('an empty or ambiguous model is Auto only when the product default is on the allow-list', () => {
    assert.ok(CURSOR_AMBIGUOUS_MODEL_IDS.includes('default'));

    const autoDefaults = ['auto', 'Composer 2.5', 'grok-4.7-fast'];
    const emptyModels = [undefined, '', '   ', 'default', 'Default', 'au\nto'];
    for (const productDefault of autoDefaults) {
      for (const model of emptyModels) {
        assert.deepEqual(classify(model, productDefault), {
          pool: 'auto',
          displayName: CURSOR_AUTO_POOL_DISPLAY_NAME,
        }, `${model ?? '(omitted)'} / ${productDefault}`);
      }
    }

    const otherDefaults = [undefined, '', '   ', 'default', 'claude-sonnet-5.5', 'gpt-5.4'];
    for (const productDefault of otherDefaults) {
      assert.deepEqual(classify(undefined, productDefault), {
        pool: 'other-models',
        displayName: CURSOR_OTHER_MODELS_DISPLAY_NAME,
      }, productDefault ?? '(omitted)');
      assert.equal(classify('default', productDefault).pool, 'other-models', productDefault ?? '(omitted)');
    }

    assert.equal(classify('au\nto', 'claude-sonnet-5.5').pool, 'other-models');
    assert.equal(classify('gpt-5.4', 'auto').pool, 'other-models');
    assert.equal(classify('auto', 'gpt-5.4').pool, 'auto');
  });

  test('pool ids stay distinct from selectable Cursor provider ids', () => {
    const cursorIds = AGENT_CLI_PROVIDER_IDS.filter((id) => id === 'cursor' || id.startsWith('cursor-'));
    assert.deepEqual(cursorIds, ['cursor', 'cursor-other']);
    const classified = [
      classify('auto'),
      classify('claude-opus-5.5'),
      classify(undefined, 'auto'),
    ];
    const providerIds: readonly string[] = AGENT_CLI_PROVIDER_IDS;
    for (const result of classified) {
      assert.equal(providerIds.includes(result.pool), false);
      assert.equal(
        result.displayName === 'Cursor' || result.displayName === 'Cursor Agent CLI Other',
        true,
      );
    }
  });
});
