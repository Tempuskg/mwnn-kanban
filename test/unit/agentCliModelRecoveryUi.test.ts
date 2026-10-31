import * as assert from 'node:assert/strict';
import Module from 'node:module';
import { suite, test } from 'node:test';
import type { AgentCliModelRecoveryRequest } from '../../src/agentCliModelRecovery';
import type { AgentCliModelRecoveryUiDeps } from '../../src/agentCliModelRecoveryUi';

type ModuleLoader = (request: string, parent: unknown, isMain: boolean) => unknown;

/**
 * The recovery UI imports `vscode` for its default deps only; the prompt flow
 * itself takes injected deps. Load it with an empty stand-in module.
 */
function loadRecoveryUi(): typeof import('../../src/agentCliModelRecoveryUi') {
  const host = Module as unknown as { _load: ModuleLoader };
  const original = host._load;
  host._load = (request, parent, isMain) =>
    request === 'vscode' ? {} : original.call(host, request, parent, isMain);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../../src/agentCliModelRecoveryUi') as typeof import('../../src/agentCliModelRecoveryUi');
  } finally {
    host._load = original;
  }
}

const { promptAndApplyModelRecovery } = loadRecoveryUi();

const REQUEST: AgentCliModelRecoveryRequest = {
  provider: 'codex',
  providerLabel: 'Codex CLI',
  rejectedModel: 'broken-model',
  source: 'card',
  detail: 'unknown model',
  modelSuggestions: ['gpt-5.5'],
  thinkingSuggestions: ['high'],
  thinkingSupported: true,
  workspaceAvailable: true,
};

type Answer = { readonly label: string } | undefined;

/** Answers each prompt, in order, from `answers`; `'dismiss'` is Escape. */
function ui(answers: readonly (Answer | string | 'dismiss')[]): {
  readonly deps: AgentCliModelRecoveryUiDeps;
  readonly writes: string[];
  readonly warnings: string[];
  readonly statuses: string[];
  prompts: number;
} {
  const writes: string[] = [];
  const warnings: string[] = [];
  const statuses: string[] = [];
  const state = { prompts: 0 };
  const next = (items: readonly { readonly label: string }[]): unknown => {
    const answer = answers[state.prompts];
    state.prompts += 1;
    if (answer === undefined || answer === 'dismiss') {
      return undefined;
    }
    if (typeof answer === 'string') {
      return items.find((item) => item.label === answer) ?? items[0];
    }
    return answer;
  };
  return {
    writes,
    warnings,
    statuses,
    get prompts() { return state.prompts; },
    deps: {
      workspaceAvailable: () => true,
      inspectScoped: () => undefined,
      updateScoped: async (key, _value, scope) => { writes.push(`${key}@${scope}`); },
      pick: (async (items: readonly { readonly label: string }[]) => next(items)) as AgentCliModelRecoveryUiDeps['pick'],
      enter: async () => {
        const answer = answers[state.prompts];
        state.prompts += 1;
        return typeof answer === 'string' && answer !== 'dismiss' ? answer : undefined;
      },
      warn: (message) => warnings.push(message),
      status: (message) => statuses.push(message),
    },
  };
}

suite('model recovery prompt dismissal', () => {
  test('dismissing the model pick writes nothing', async () => {
    const h = ui(['dismiss']);
    assert.equal(await promptAndApplyModelRecovery(REQUEST, h.deps), undefined);
    assert.deepEqual(h.writes, []);
    assert.equal(h.prompts, 1);
  });

  test('dismissing the model input (after choosing to type one) writes nothing', async () => {
    const h = ui(['$(edit) Enter a model…', 'dismiss']);
    assert.equal(await promptAndApplyModelRecovery(REQUEST, h.deps), undefined);
    assert.deepEqual(h.writes, []);
    assert.equal(h.prompts, 2);
  });

  test('dismissing the thinking-level pick writes nothing', async () => {
    const h = ui(['gpt-5.5', 'dismiss']);
    assert.equal(await promptAndApplyModelRecovery(REQUEST, h.deps), undefined);
    assert.deepEqual(h.writes, []);
    assert.equal(h.prompts, 2);
  });

  test('dismissing the thinking-level input writes nothing', async () => {
    const h = ui(['gpt-5.5', '$(edit) Enter a thinking level…', 'dismiss']);
    assert.equal(await promptAndApplyModelRecovery(REQUEST, h.deps), undefined);
    assert.deepEqual(h.writes, []);
    assert.equal(h.prompts, 3);
  });

  test('dismissing the settings-scope pick writes nothing', async () => {
    const h = ui(['gpt-5.5', 'high', 'dismiss']);
    assert.equal(await promptAndApplyModelRecovery(REQUEST, h.deps), undefined);
    assert.deepEqual(h.writes, []);
    assert.equal(h.prompts, 3);
  });

  test('an abandoned attempt (aborted signal) writes nothing even after every prompt is answered', async () => {
    const h = ui(['gpt-5.5', 'high', 'Workspace']);
    const abandoned = new AbortController();
    const pending = promptAndApplyModelRecovery(REQUEST, h.deps, abandoned.signal);
    abandoned.abort();

    assert.equal(await pending, undefined);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.statuses, []);
  });

  test('a live attempt still writes the chosen scope', async () => {
    const h = ui(['gpt-5.5', 'high', 'Workspace']);
    const selection = await promptAndApplyModelRecovery(REQUEST, h.deps, new AbortController().signal);

    assert.equal(selection?.model, 'gpt-5.5');
    assert.equal(selection?.scope, 'workspace');
    assert.ok(h.writes.includes('agentCliModels@workspace'));
  });
});
