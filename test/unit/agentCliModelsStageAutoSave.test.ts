import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  stageOverrideCommandLabels,
  wireStageOverrideAutoSave,
  type StageOverrideAutoSaveForm,
  type StageOverrideAutoSaveTarget,
} from '../../src/webview/agentCliModelsStageAutoSave';
import type { AgentCliSettingsPanelMessage } from '../../src/types';

function fakeInput(initial = ''): StageOverrideAutoSaveTarget & {
  dispatch(type: 'change' | 'blur'): void;
} {
  const listeners: { change: Array<() => void>; blur: Array<() => void> } = { change: [], blur: [] };
  return {
    value: initial,
    addEventListener(type, listener) {
      listeners[type].push(listener);
    },
    dispatch(type) {
      for (const listener of listeners[type]) {
        listener();
      }
    },
  };
}

function fakeForm(): StageOverrideAutoSaveForm & {
  dispatchSubmit(): void;
} {
  const listeners: Array<(event: { preventDefault(): void }) => void> = [];
  return {
    addEventListener(_type, listener) {
      listeners.push(listener);
    },
    dispatchSubmit() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      for (const listener of listeners) {
        listener(event);
      }
      assert.equal(event.prevented, true);
    },
  };
}

function stageSetMessage(name: string): AgentCliSettingsPanelMessage {
  return {
    type: 'settingsStageEdit',
    scope: 'workspace',
    stage: 'implementation',
    provider: 'codex',
    list: 'models',
    action: 'set',
    name,
  };
}

suite('Agent CLI Models stage override auto-save', () => {
  test('stage override rows never expose a Save command button', () => {
    assert.deepEqual(stageOverrideCommandLabels(false), []);
    assert.deepEqual(stageOverrideCommandLabels(true), ['Remove override']);
    assert.equal(stageOverrideCommandLabels(true).includes('Save'), false);
    assert.equal(stageOverrideCommandLabels(false).includes('Save'), false);

    // Equivalent DOM harness: labels that would be rendered as <button> text.
    const renderedButtons = [...stageOverrideCommandLabels(true)].map((label) => ({ tag: 'button', text: label }));
    assert.equal(renderedButtons.some((node) => node.text === 'Save'), false);
    assert.equal(renderedButtons.some((node) => node.text === 'Remove override'), true);
  });

  test('blur posts settingsStageEdit set without a Save click', () => {
    const posted: AgentCliSettingsPanelMessage[] = [];
    const input = fakeInput('');
    const form = fakeForm();
    wireStageOverrideAutoSave(input, form, {
      ownedValue: null,
      commitSet: () => posted.push(stageSetMessage(input.value)),
    });

    input.value = 'gpt-5-codex';
    input.dispatch('blur');

    assert.deepEqual(posted, [stageSetMessage('gpt-5-codex')]);
  });

  test('datalist change posts the same settingsStageEdit set message', () => {
    const posted: AgentCliSettingsPanelMessage[] = [];
    const input = fakeInput('old');
    const form = fakeForm();
    wireStageOverrideAutoSave(input, form, {
      ownedValue: 'old',
      commitSet: () => posted.push(stageSetMessage(input.value)),
    });

    input.value = 'high';
    input.dispatch('change');

    assert.deepEqual(posted, [stageSetMessage('high')]);
  });

  test('Enter (form submit) posts set, and a following blur does not double-post', () => {
    const posted: AgentCliSettingsPanelMessage[] = [];
    const input = fakeInput('');
    const form = fakeForm();
    wireStageOverrideAutoSave(input, form, {
      ownedValue: null,
      commitSet: () => posted.push(stageSetMessage(input.value)),
    });

    input.value = 'sonnet';
    form.dispatchSubmit();
    input.dispatch('blur');

    assert.deepEqual(posted, [stageSetMessage('sonnet')]);
  });

  test('leaving an unchanged field does not post', () => {
    const posted: AgentCliSettingsPanelMessage[] = [];
    const input = fakeInput('already-saved');
    const form = fakeForm();
    wireStageOverrideAutoSave(input, form, {
      ownedValue: 'already-saved',
      commitSet: () => posted.push(stageSetMessage(input.value)),
    });

    input.dispatch('blur');
    input.dispatch('change');
    assert.deepEqual(posted, []);
  });
});
