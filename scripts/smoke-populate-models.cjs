/**
 * Populate Agent CLI Models smoke test.
 *
 * Runs the same pipeline as `MWNN Kanban: Populate Agent CLI Models and
 * Thinking Levels` without the VS Code UI, against the agent CLIs actually
 * installed on this machine:
 *
 *   1. Discover each provider's models and thinking levels (real CLI probes,
 *      bundled fallback where a CLI is missing or cannot list them).
 *   2. Plan a merge over a pre-existing configuration and check the user's
 *      entries survive first and in order, and no empty level list is written.
 *   3. Feed the planned settings through the builders `BoardPanel.postState`
 *      uses, then through the webview's own picker helper, and check the card
 *      model and thinking pickers would offer the discovered values.
 *
 * Step 3 is the data half of "an open board updates without a reload": the
 * configuration listener in src/extension.ts re-runs `postState` on a change
 * to either setting, and a state message re-renders any open card details.
 * The human check is left with the visual half only.
 *
 * Only listing commands are spawned (`--help`, `models`, ...); no agent run
 * starts and no paid credits are consumed.
 */

const assert = require('node:assert/strict');
const {
  discoverAgentCliVocabularies,
  describeAgentCliDiscovery,
  planAgentCliPopulate,
} = require('../dist-test/src/agentCliDiscovery.js');
const {
  agentCliModelSuggestions,
  readAgentCliModelCatalog,
  readAgentCliThinkingLevelSuggestions,
} = require('../dist-test/src/agentCliModels.js');
const { modelSuggestionsFor } = require('../media/board.js');

/** Stands in for what the user already had in the chosen settings scope. */
const EXISTING_MODELS = { codex: ['my-pinned-codex-model'] };
const EXISTING_LEVELS = {};

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

async function main() {
  const discoveries = await discoverAgentCliVocabularies({ cwd: process.cwd() });
  for (const discovery of discoveries) {
    console.log(
      `${discovery.provider}: installed=${discovery.installed} ` +
        `models=${discovery.models.values.length} (${discovery.models.source}) ` +
        `levels=${discovery.thinkingLevels.values.length} (${discovery.thinkingLevels.source}) ` +
        `thinkingSupported=${discovery.thinkingSupported}`,
    );
    for (const note of discovery.notes) {
      console.log(`  note: ${note}`);
    }
    assert.ok(discovery.models.values.length > 0, `${discovery.provider} must yield models.`);
  }
  assert.equal(discoveries.length, 4, 'Every provider must be reported.');
  assert.ok(
    discoveries.some((discovery) => discovery.models.source === 'cli'),
    'At least one installed CLI must list its own models on this machine.',
  );
  for (const discovery of discoveries) {
    assert.equal(typeof describeAgentCliDiscovery(discovery), 'string');
  }

  const plan = planAgentCliPopulate(EXISTING_MODELS, EXISTING_LEVELS, discoveries, 'merge');
  assert.ok(plan.changed, 'Merging discovered values into a sparse config must change it.');
  assert.equal(
    plan.models.codex[0],
    'my-pinned-codex-model',
    'Merge must keep the existing default model first.',
  );
  for (const discovery of discoveries) {
    const levels = plan.thinkingLevels[discovery.provider];
    if (!discovery.thinkingSupported) {
      assert.equal(levels, undefined, `${discovery.provider} has no effort flag, so no level entry.`);
    } else if (levels !== undefined) {
      assert.ok(Array.isArray(levels) ? levels.length > 0 : String(levels).trim().length > 0);
    }
  }

  // What `BoardPanel.postState` would push after the configuration listener
  // fires, and what the webview's pickers would then offer.
  const modelSuggestions = agentCliModelSuggestions(readAgentCliModelCatalog(plan.models));
  const thinkingSuggestions = readAgentCliThinkingLevelSuggestions(plan.thinkingLevels);
  for (const discovery of discoveries) {
    const offered = modelSuggestionsFor(modelSuggestions, discovery.provider);
    for (const model of discovery.models.values) {
      assert.ok(offered.includes(model), `${discovery.provider} picker must offer ${model}.`);
    }
    if (discovery.thinkingSupported && discovery.thinkingLevels.values.length > 0) {
      const levels = modelSuggestionsFor(thinkingSuggestions, discovery.provider);
      for (const level of discovery.thinkingLevels.values) {
        assert.ok(levels.includes(level), `${discovery.provider} thinking field must offer ${level}.`);
      }
    }
  }

  console.log('Populate agent CLI models smoke: OK');
}
