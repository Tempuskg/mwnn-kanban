import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  AGENT_CLI_LABELS,
  AGENT_CLI_MODEL_FLAGS,
  AGENT_CLI_THINKING_FLAGS,
  buildAgentCliInvocation,
  resolveAgentCliModelSelection,
  resolveAgentCliTarget,
  resolveAgentCliThinkingSelection,
  type AgentCliTarget,
} from '../../src/agentCliHandoff';
import {
  EMPTY_AGENT_CLI_MODEL_CATALOG,
  readAgentCliModelCatalog,
  readAgentCliThinkingLevels,
  resolveAgentCliModel,
  resolveAgentCliThinkingLevel,
} from '../../src/agentCliModels';
import {
  AGENT_CLI_PROVIDER_IDS,
  agentCliExecutableProvider,
  isAgentCliProviderId,
} from '../../src/agentCliProviders';
import { cursorUsagePoolForProvider } from '../../src/cursorModelPool';
import { selectCursorUsageForProvider, type AgentCliUsageSnapshot } from '../../src/agentCliUsage';

suite('Cursor Agent CLI Other provider', () => {
  test('enumerates cursor-other with the Cursor Agent CLI Other label', () => {
    assert.ok(isAgentCliProviderId('cursor-other'));
    assert.equal(AGENT_CLI_LABELS['cursor-other'], 'Cursor Agent CLI Other');
    assert.equal(AGENT_CLI_LABELS.cursor, 'Cursor Agent CLI');
    assert.deepEqual(
      [...AGENT_CLI_PROVIDER_IDS],
      ['copilot', 'codex', 'claude-code', 'cursor', 'cursor-other'],
    );
  });

  test('maps cursor-other onto the Cursor executable identity and path key', () => {
    assert.equal(agentCliExecutableProvider('cursor-other'), 'cursor');
    assert.equal(agentCliExecutableProvider('cursor'), 'cursor');
    assert.equal(AGENT_CLI_MODEL_FLAGS['cursor-other'], AGENT_CLI_MODEL_FLAGS.cursor);
    assert.equal(AGENT_CLI_THINKING_FLAGS['cursor-other'], undefined);
  });

  test('resolveAgentCliTarget for cursor-other uses the cursor path override', async () => {
    const resolution = await resolveAgentCliTarget(
      'cursor-other',
      { cursor: 'E:\\tools\\cursor-agent.cmd' },
      {
        platform: 'win32',
        canExecute: async () => false,
      },
    );
    assert.equal(resolution.available, false);
    if (resolution.available) {
      return;
    }
    assert.equal(resolution.provider, 'cursor-other');
    assert.match(resolution.reason, /mwnn-kanban\.agentCliPaths\["cursor"\]/);
    assert.match(resolution.reason, /Cursor Agent CLI Other/);
    assert.match(resolution.reason, /E:\\tools\\cursor-agent\.cmd/);
  });

  test('preferred model and thinking level resolve independently for cursor-other', () => {
    const catalog = readAgentCliModelCatalog({
      cursor: ['auto'],
      'cursor-other': ['claude-opus-5', 'gpt-5'],
    });
    const levels = readAgentCliThinkingLevels({
      cursor: 'high',
      'cursor-other': 'medium',
    });
    assert.deepEqual(
      resolveAgentCliModel('cursor-other', undefined, catalog),
      { model: 'claude-opus-5', source: 'workspace-default' },
    );
    assert.deepEqual(
      resolveAgentCliModel('cursor', undefined, catalog),
      { model: 'auto', source: 'workspace-default' },
    );
    assert.deepEqual(
      resolveAgentCliModel('cursor-other', 'sonnet-card', catalog),
      { model: 'sonnet-card', source: 'card' },
    );
    assert.deepEqual(
      resolveAgentCliThinkingLevel('cursor-other', undefined, levels),
      { level: 'medium', source: 'workspace-default' },
    );
    assert.deepEqual(
      resolveAgentCliThinkingLevel('cursor', undefined, levels),
      { level: 'high', source: 'workspace-default' },
    );

    const modelSelection = resolveAgentCliModelSelection('cursor-other', 'opus', {
      catalog: EMPTY_AGENT_CLI_MODEL_CATALOG,
    });
    assert.ok(modelSelection?.applied);
    assert.deepEqual(modelSelection?.args, ['--model', 'opus']);

    const thinking = resolveAgentCliThinkingSelection('cursor-other', 'xhigh', {
      thinkingLevels: {},
    });
    assert.ok(thinking);
    assert.equal(thinking.applied, false);
    assert.match(thinking.reason ?? '', /Cursor Agent CLI Other does not accept a thinking level/);
  });

  test('cursor and cursor-other dispatch argv both request stream-json', () => {
    const expected = [
      '-p',
      '--force',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
    ];
    for (const provider of ['cursor', 'cursor-other'] as const) {
      const target: AgentCliTarget = {
        provider,
        label: AGENT_CLI_LABELS[provider],
        executable: 'C:\\Tools\\cursor-agent.exe',
        launcher: 'standalone',
      };
      const normal = buildAgentCliInvocation(target, 'prompt', 'E:\\workspace');
      assert.deepEqual(normal.args, expected, `${provider} normal argv`);
      const discovery = buildAgentCliInvocation(
        target,
        'prompt',
        'E:\\workspace',
        undefined,
        undefined,
        true,
      );
      assert.deepEqual(discovery.args, expected, `${provider} orchestrator argv`);
      const withModel = resolveAgentCliModelSelection(provider, 'claude-opus-5');
      assert.ok(withModel?.applied);
      const spliced = buildAgentCliInvocation(target, 'prompt', 'E:\\workspace', withModel);
      assert.deepEqual(spliced.args, [...expected, '--model', 'claude-opus-5']);
    }
  });

  test('usage pool classification follows the selectable identity', () => {
    assert.equal(cursorUsagePoolForProvider('cursor'), 'auto');
    assert.equal(cursorUsagePoolForProvider('cursor-other'), 'other-models');
    assert.equal(cursorUsagePoolForProvider('codex'), undefined);

    const pools: AgentCliUsageSnapshot = {
      kind: 'cursor-pools',
      provider: 'cursor',
      auto: { status: 'reported', remainingPercent: 10, resetsAt: 1 },
      otherModels: { status: 'reported', remainingPercent: 90, resetsAt: 1 },
    };
    assert.deepEqual(selectCursorUsageForProvider(pools, 'cursor'), {
      kind: 'reported',
      provider: 'cursor',
      remainingPercent: 10,
      resetsAt: 1,
    });
    assert.deepEqual(selectCursorUsageForProvider(pools, 'cursor-other'), {
      kind: 'reported',
      provider: 'cursor-other',
      remainingPercent: 90,
      resetsAt: 1,
    });
  });
});
