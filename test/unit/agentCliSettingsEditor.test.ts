import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  addAgentCliSettingsEntry,
  agentCliSettingsEntries,
  agentCliSettingsEntryProblem,
  clearAgentCliSettingsProvider,
  makeAgentCliSettingsDefault,
  removeAgentCliSettingsEntry,
  summarizeAgentCliProvider,
  type AgentCliSettingsEdit,
} from '../../src/agentCliSettingsEditor';

function written(edit: AgentCliSettingsEdit): unknown {
  assert.equal(edit.ok, true, edit.ok ? '' : edit.reason);
  return edit.ok ? edit.value : undefined;
}

suite('agentCliSettingsEditor models', () => {
  test('adds a trimmed model after the existing ones and keeps other providers', () => {
    const value = { codex: ['gpt-5.5'], 'claude-code': ['sonnet'] };
    const next = written(addAgentCliSettingsEntry(value, 'models', 'claude-code', '  opus  '));
    assert.deepEqual(next, { codex: ['gpt-5.5'], 'claude-code': ['sonnet', 'opus'] });
    assert.deepEqual(value, { codex: ['gpt-5.5'], 'claude-code': ['sonnet'] }, 'input is not mutated');
  });

  test('the first model added to an unset provider becomes its default', () => {
    assert.deepEqual(written(addAgentCliSettingsEntry(undefined, 'models', 'cursor', 'auto')), {
      cursor: ['auto'],
    });
  });

  test('rejects a duplicate model, even with surrounding whitespace', () => {
    const edit = addAgentCliSettingsEntry({ codex: ['gpt-5.5'] }, 'models', 'codex', ' gpt-5.5 ');
    assert.equal(edit.ok, false);
    assert.match(edit.ok ? '' : edit.reason, /already in the list/);
  });

  test('rejects blank and whitespace-only input', () => {
    for (const input of ['', '   ', '\t']) {
      const edit = addAgentCliSettingsEntry({}, 'models', 'codex', input);
      assert.equal(edit.ok, false, JSON.stringify(input));
    }
    assert.match(agentCliSettingsEntryProblem([], '  ', 'model name') ?? '', /blank/);
    assert.equal(agentCliSettingsEntryProblem(['a'], 'b', 'model name'), undefined);
  });

  test('removes a model and leaves the rest in order', () => {
    const next = written(removeAgentCliSettingsEntry({ codex: ['a', 'b', 'c'] }, 'models', 'codex', 'b'));
    assert.deepEqual(next, { codex: ['a', 'c'] });
  });

  test("removing a provider's last model deletes its key, not an empty array", () => {
    const next = written(
      removeAgentCliSettingsEntry({ codex: ['gpt-5.5'], copilot: ['auto'] }, 'models', 'codex', 'gpt-5.5'),
    );
    assert.deepEqual(next, { copilot: ['auto'] });
  });

  test('an emptied map becomes undefined so the setting is removed from the scope', () => {
    const edit = removeAgentCliSettingsEntry({ codex: ['gpt-5.5'] }, 'models', 'codex', 'gpt-5.5');
    assert.equal(written(edit), undefined);
  });

  test('removing a name that is not listed is rejected', () => {
    assert.equal(removeAgentCliSettingsEntry({ codex: ['a'] }, 'models', 'codex', 'z').ok, false);
  });

  test('make default moves the model to first place', () => {
    const next = written(makeAgentCliSettingsDefault({ codex: ['a', 'b', 'c'] }, 'models', 'codex', 'c'));
    assert.deepEqual(next, { codex: ['c', 'a', 'b'] });
  });

  test('unknown keys from the scope are copied through untouched', () => {
    const next = written(addAgentCliSettingsEntry({ legacy: 42 }, 'models', 'codex', 'x'));
    assert.deepEqual(next, { legacy: 42, codex: ['x'] });
  });
});

suite('agentCliSettingsEditor thinking levels', () => {
  test('a single level is written as a string', () => {
    assert.deepEqual(written(makeAgentCliSettingsDefault({}, 'thinkingLevels', 'codex', ' high ')), {
      codex: 'high',
    });
  });

  test('several levels are an array whose first entry is the level used', () => {
    const withSuggestion = written(addAgentCliSettingsEntry({ codex: 'high' }, 'thinkingLevels', 'codex', 'low'));
    assert.deepEqual(withSuggestion, { codex: ['high', 'low'] });
    const promoted = written(makeAgentCliSettingsDefault(withSuggestion, 'thinkingLevels', 'codex', 'low'));
    assert.deepEqual(promoted, { codex: ['low', 'high'] });
  });

  test('setting a new level used inserts it first', () => {
    const next = written(makeAgentCliSettingsDefault({ codex: ['high', 'low'] }, 'thinkingLevels', 'codex', 'medium'));
    assert.deepEqual(next, { codex: ['medium', 'high', 'low'] });
  });

  test('removing down to one level goes back to the string shape', () => {
    const next = written(removeAgentCliSettingsEntry({ codex: ['high', 'low'] }, 'thinkingLevels', 'codex', 'high'));
    assert.deepEqual(next, { codex: 'low' });
  });

  test('clear removes the provider key and keeps the others', () => {
    const next = written(
      clearAgentCliSettingsProvider({ codex: ['high', 'low'], copilot: 'max' }, 'thinkingLevels', 'codex'),
    );
    assert.deepEqual(next, { copilot: 'max' });
  });

  test('reads a string, an array, and drops blanks and duplicates', () => {
    assert.deepEqual(agentCliSettingsEntries({ codex: ' high ' }, 'codex'), ['high']);
    assert.deepEqual(agentCliSettingsEntries({ codex: ['a', ' ', 'a', 3, 'b'] }, 'codex'), ['a', 'b']);
    assert.deepEqual(agentCliSettingsEntries('nonsense', 'codex'), []);
  });
});

suite('agentCliSettingsEditor summary', () => {
  test('an unset provider uses the CLI default for both', () => {
    const summary = summarizeAgentCliProvider(undefined, undefined, 'codex');
    assert.equal(summary.description, 'model: CLI default · thinking: CLI default');
  });

  test('shows the default model, the count of others, and the level used', () => {
    const summary = summarizeAgentCliProvider(
      { 'claude-code': ['sonnet', 'opus', 'haiku'] },
      { 'claude-code': ['high', 'low'] },
      'claude-code',
    );
    assert.equal(summary.description, 'model: sonnet (+2 other) · thinking: high');
    assert.match(summary.detail, /Other models: opus, haiku/);
    assert.match(summary.detail, /Suggested levels: low/);
  });

  test("labels Cursor's thinking level as not applied", () => {
    const summary = summarizeAgentCliProvider({}, { cursor: 'high' }, 'cursor');
    assert.match(summary.description, /thinking: high \(not applied by this CLI\)/);
  });
});
