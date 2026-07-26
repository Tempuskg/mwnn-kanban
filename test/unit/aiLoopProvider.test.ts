import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { suite, test } from 'node:test';
import {
  AI_LOOP_PROVIDER_PREFERENCES,
  listAiLoopExecutionModeChoices,
} from '../../src/aiLoopProvider';

suite('AI loop provider selection', () => {
  test('always offers both the VS Code chat extension and local CLI channels', () => {
    const choices = listAiLoopExecutionModeChoices();

    assert.deepEqual(
      choices.map((choice) => choice.mode),
      ['chat', 'cli'],
    );
    assert.match(choices[0]?.label ?? '', /chat extension/i);
    assert.match(choices[1]?.label ?? '', /CLI/i);
  });

  test('keeps the contributed setting values aligned with the runtime preferences', () => {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
      readonly contributes?: {
        readonly configuration?: {
          readonly properties?: Record<string, { readonly enum?: readonly string[] }>;
        };
      };
    };
    const configuredValues = manifest.contributes
      ?.configuration
      ?.properties
      ?.['mwnn-kanban.aiLoopProvider']
      ?.enum;

    assert.deepEqual(configuredValues, AI_LOOP_PROVIDER_PREFERENCES);
  });
});
