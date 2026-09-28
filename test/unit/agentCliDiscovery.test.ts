import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { suite, test } from 'node:test';
import {
  BUNDLED_AGENT_CLI_MODELS,
  BUNDLED_AGENT_CLI_THINKING_LEVELS,
  combineAgentCliLists,
  describeAgentCliDiscovery,
  discoverAgentCliVocabularies,
  parseCodexModelCatalog,
  parseCopilotConfigModels,
  parseCursorModels,
  parseHelpOptionChoices,
  planAgentCliPopulate,
  type AgentCliDiscovery,
  type AgentCliProbeRunner,
} from '../../src/agentCliDiscovery';
import {
  AGENT_CLI_LABELS,
  AGENT_CLI_PROVIDER_IDS,
  type AgentCliProviderId,
  type AgentCliResolution,
} from '../../src/agentCliHandoff';
import {
  readAgentCliThinkingLevelSuggestions,
  readAgentCliThinkingLevels,
} from '../../src/agentCliModels';

const COPILOT_CONFIG_HELP = [
  '  `logLevel`: log level for CLI; defaults to "default".',
  '',
  '  `model`: AI model to use for Copilot CLI; can be changed with /model command or --model flag option.',
  '    - "claude-sonnet-5"',
  '    - "gpt-5.5"',
  '    - "claude-sonnet-5"',
  '',
  '  `contextTier`: context window tier (e.g., "default" or "long_context").',
].join('\r\n');

const COPILOT_HELP = [
  'Options:',
  '  --effort, --reasoning-effort <level>  Set the reasoning effort level (choices:',
  '                                        "none", "minimal", "low", "medium",',
  '                                        "high", "xhigh", "max")',
  '  --enable-all-github-mcp-tools         Enable all GitHub MCP server tools',
].join('\n');

const CLAUDE_HELP = [
  '  --debug-file <path>                   Write debug logs (e.g. \'a\', \'b\')',
  '  --effort <level>                      Effort level for the current session',
  '                                        (low, medium, high, xhigh, max)',
  '  --environment <environment_id>        Create a new cloud session',
].join('\n');

const CODEX_CATALOG = JSON.stringify({
  models: [
    {
      slug: 'gpt-hidden',
      visibility: 'hide',
      priority: 0,
      default_reasoning_level: 'high',
      supported_reasoning_levels: [{ effort: 'secret' }],
    },
    {
      slug: 'gpt-second',
      visibility: 'list',
      priority: 7,
      default_reasoning_level: 'medium',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }],
    },
    {
      slug: 'gpt-first',
      visibility: 'list',
      priority: 1,
      default_reasoning_level: 'low',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'ultra' }],
    },
  ],
});

const CURSOR_MODELS = [
  '\u001b[1mAvailable models\u001b[0m',
  '',
  'auto - Auto  (current)',
  'gpt-5 - GPT-5',
  'sonnet-4.5-thinking - Claude 4.5 Sonnet Thinking',
  '',
  'Tip: use --model <id> to switch.',
].join('\n');

suite('agent CLI discovery: parsing each CLI', () => {
  test('Copilot: reads the model list documented by `copilot help config`', () => {
    assert.deepEqual(parseCopilotConfigModels(COPILOT_CONFIG_HELP), ['claude-sonnet-5', 'gpt-5.5']);
    assert.deepEqual(parseCopilotConfigModels('no model section here'), []);
  });

  test('Copilot and Claude Code: read the --effort choices from --help, wrapped or not', () => {
    assert.deepEqual(parseHelpOptionChoices(COPILOT_HELP, '--effort'), [
      'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
    ]);
    assert.deepEqual(parseHelpOptionChoices(CLAUDE_HELP, '--effort'), [
      'low', 'medium', 'high', 'xhigh', 'max',
    ]);
    assert.deepEqual(parseHelpOptionChoices(CLAUDE_HELP, '--model'), []);
  });

  test('Codex: skips hidden models, orders by priority, leads levels with the top default', () => {
    const parsed = parseCodexModelCatalog(`warning: stale cache\n${CODEX_CATALOG}`);
    assert.deepEqual(parsed.models, ['gpt-first', 'gpt-second']);
    assert.deepEqual(parsed.thinkingLevels, ['low', 'medium', 'ultra', 'high']);
    assert.deepEqual(parseCodexModelCatalog('not json'), { models: [], thinkingLevels: [] });
  });

  test('Cursor: reads `<id> - <name>` lines and ignores headings, blanks, and tips', () => {
    assert.deepEqual(parseCursorModels(CURSOR_MODELS), ['auto', 'gpt-5', 'sonnet-4.5-thinking']);
  });
});

function fakeResolve(installed: readonly AgentCliProviderId[]) {
  return async (provider: AgentCliProviderId): Promise<AgentCliResolution> =>
    installed.includes(provider)
      ? {
          available: true,
          target: { provider, label: AGENT_CLI_LABELS[provider], executable: provider, launcher: 'standalone' },
        }
      : { available: false, provider, attemptedCommand: provider, reason: 'missing' };
}

const THINKING_FLAGS = { copilot: undefined, codex: '-c', 'claude-code': undefined, cursor: undefined };

suite('agent CLI discovery: sources and fallback', () => {
  test('uses CLI listings when available and bundled lists otherwise, without aborting', async () => {
    const calls: string[] = [];
    const runProbe: AgentCliProbeRunner = async (target, args) => {
      calls.push(`${target.provider} ${args.join(' ')}`);
      if (target.provider === 'codex') {
        return { ok: true, stdout: CODEX_CATALOG };
      }
      if (target.provider === 'copilot' && args[0] === 'help') {
        return { ok: true, stdout: COPILOT_CONFIG_HELP };
      }
      if (target.provider === 'copilot') {
        return { ok: false, reason: 'timed out after 20s' };
      }
      throw new Error('boom');
    };

    const discoveries = await discoverAgentCliVocabularies({
      cwd: '.',
      resolveTarget: fakeResolve(['copilot', 'codex', 'claude-code']),
      runProbe,
      thinkingFlags: THINKING_FLAGS,
    });
    const byId = new Map(discoveries.map((discovery) => [discovery.provider, discovery]));

    assert.deepEqual(discoveries.map((discovery) => discovery.provider), [...AGENT_CLI_PROVIDER_IDS]);
    // Codex's one catalog command answers both axes, and runs only once.
    assert.equal(calls.filter((call) => call.startsWith('codex')).length, 1);
    assert.equal(byId.get('codex')?.models.source, 'cli');
    assert.equal(byId.get('codex')?.thinkingLevels.source, 'cli');

    const copilot = byId.get('copilot');
    assert.equal(copilot?.models.source, 'cli');
    // `auto` leads, so an empty setting keeps Copilot choosing its own model.
    assert.deepEqual(copilot?.models.values, ['auto', 'claude-sonnet-5', 'gpt-5.5']);
    assert.equal(copilot?.thinkingLevels.source, 'bundled');
    assert.match(copilot?.notes.join() ?? '', /timed out/);

    // A probe that throws falls back rather than rejecting the discovery.
    const claude = byId.get('claude-code');
    assert.equal(claude?.installed, true);
    assert.equal(claude?.thinkingLevels.source, 'bundled');
    assert.deepEqual(claude?.models.values, BUNDLED_AGENT_CLI_MODELS['claude-code']);
    assert.match(claude?.notes.join() ?? '', /boom/);

    const cursor = byId.get('cursor');
    assert.equal(cursor?.installed, false);
    assert.equal(cursor?.models.source, 'bundled');
    assert.deepEqual(cursor?.thinkingLevels.values, BUNDLED_AGENT_CLI_THINKING_LEVELS.cursor);
    assert.match(describeAgentCliDiscovery(cursor as AgentCliDiscovery, undefined), /not installed/);
  });

  test('falls back when a CLI exits cleanly but lists nothing readable', async () => {
    const discoveries = await discoverAgentCliVocabularies({
      cwd: '.',
      resolveTarget: fakeResolve(['cursor']),
      runProbe: async () => ({ ok: true, stdout: 'Please log in first.' }),
      thinkingFlags: THINKING_FLAGS,
    });
    const cursor = discoveries.find((discovery) => discovery.provider === 'cursor');
    assert.equal(cursor?.models.source, 'bundled');
    assert.deepEqual(cursor?.models.values, BUNDLED_AGENT_CLI_MODELS.cursor);
  });
});

function discovery(
  provider: AgentCliProviderId,
  models: string[],
  thinkingLevels: string[],
  thinkingSupported: boolean,
): AgentCliDiscovery {
  return {
    provider,
    label: AGENT_CLI_LABELS[provider],
    installed: true,
    models: { values: models, source: 'cli' },
    thinkingLevels: { values: thinkingLevels, source: 'cli' },
    thinkingSupported,
    notes: [],
  };
}

suite('agent CLI discovery: planning the settings write', () => {
  test('merge keeps the existing default and order and appends new names once', () => {
    assert.deepEqual(combineAgentCliLists(['mine', 'b'], ['a', 'b', ' ', 'c', 'a'], 'merge'), [
      'mine', 'b', 'a', 'c',
    ]);
    assert.deepEqual(combineAgentCliLists(['mine'], [' a ', '', 'a', 'c'], 'replace'), ['a', 'c']);
  });

  test('merge plan keeps the user default first; replace uses the discovered order', () => {
    const found = [discovery('codex', ['gpt-new', 'gpt-mine'], ['medium', 'high'], true)];
    const existingModels = { codex: ['gpt-mine'], cursor: ['keep-me'] };
    const existingLevels = { codex: 'high' };

    const merged = planAgentCliPopulate(existingModels, existingLevels, found, 'merge');
    assert.deepEqual(merged.models, { codex: ['gpt-mine', 'gpt-new'], cursor: ['keep-me'] });
    assert.deepEqual(merged.thinkingLevels, { codex: ['high', 'medium'] });
    // The dispatch default is still the level the user chose.
    assert.equal(readAgentCliThinkingLevels(merged.thinkingLevels).codex, 'high');
    assert.equal(merged.changed, true);

    const replaced = planAgentCliPopulate(existingModels, existingLevels, found, 'replace');
    assert.deepEqual(replaced.models, { codex: ['gpt-new', 'gpt-mine'], cursor: ['keep-me'] });
    assert.deepEqual(replaced.thinkingLevels, { codex: ['medium', 'high'] });
  });

  test('writes discovered effort levels only for supported CLIs, and skips empty lists', () => {
    const found = [
      discovery('copilot', ['auto'], ['none', 'high'], true),
      discovery('claude-code', ['sonnet'], ['low', 'high'], true),
      discovery('cursor', [], [], false),
      discovery('codex', ['gpt'], [], true),
    ];
    const plan = planAgentCliPopulate(undefined, { cursor: 'user-typed' }, found, 'replace');

    assert.deepEqual(plan.models, { copilot: ['auto'], 'claude-code': ['sonnet'], codex: ['gpt'] });
    assert.deepEqual(plan.thinkingLevels, {
      copilot: ['none', 'high'],
      'claude-code': ['low', 'high'],
      cursor: 'user-typed',
    });
    assert.deepEqual(plan.providers.find((p) => p.provider === 'copilot')?.thinkingLevels, {
      before: [],
      after: ['none', 'high'],
    });
    assert.deepEqual(plan.providers.find((p) => p.provider === 'claude-code')?.thinkingLevels, {
      before: [],
      after: ['low', 'high'],
    });
    // The user's own Cursor entry survives, but discovery cannot replace it.
    assert.equal(plan.providers.find((p) => p.provider === 'cursor')?.thinkingLevels, undefined);
    assert.deepEqual(plan.providers.find((p) => p.provider === 'codex')?.thinkingLevels, {
      before: [],
      after: [],
    });
  });

  test('reports no change when merging adds nothing', () => {
    const found = [discovery('codex', ['gpt'], ['medium'], true)];
    const plan = planAgentCliPopulate({ codex: ['gpt'] }, { codex: ['medium'] }, found, 'merge');
    assert.equal(plan.changed, false);
  });
});

suite('agent CLI thinking levels setting: list shape', () => {
  test('a list is read with its first entry as the default and all entries as suggestions', () => {
    const value = { codex: [' ', 'high', 'low', 'high'], cursor: 'max', copilot: [] };
    assert.deepEqual(readAgentCliThinkingLevels(value), { codex: 'high', cursor: 'max' });
    assert.deepEqual(readAgentCliThinkingLevelSuggestions(value), { codex: ['high', 'low'], cursor: ['max'] });
  });

  test('the command is contributed under the MWNN Kanban category', () => {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
      contributes: { commands: { command: string; category?: string }[] };
    };
    const command = manifest.contributes.commands.find(
      (entry) => entry.command === 'mwnn-kanban.populateAgentCliModels',
    );
    assert.equal(command?.category, 'MWNN Kanban');
  });
});
