/**
 * Workspace default model smoke test, with simulated CLI results.
 *
 * Runs the real board store over a throwaway workspace on the real filesystem
 * and the real CLI handoff with the CLI process itself replaced. No agent CLI is
 * spawned and no paid credits are consumed.
 *
 * Verifies the parts of the feature a script can reach:
 *   1. `mwnn-kanban.agentCliModels` is declared the way the settings UI needs it
 *      - an empty default, the same configuration scope as the other AI-loop
 *        settings, and a description for every supported provider.
 *   2. The resolution order holds against a settings-shaped value: the card's
 *      own model wins, the active provider's first configured entry supplies the
 *      model when the card names none, another provider's entry is ignored, and
 *      nothing configured leaves the original argv untouched.
 *   3. A default that supplied the model is never written back into the card
 *      file on disk.
 *
 * This is the scriptable half of the card's Development Host check; seeing the
 * setting and its description rendered in the settings UI still belongs to a
 * human running the extension.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  AGENT_CLI_LABELS,
  AGENT_CLI_PROVIDER_IDS,
  runAgentCliCardHandoff,
} = require('../dist-test/src/agentCliHandoff.js');
const {
  agentCliModelsFor,
  defaultAgentCliModel,
  readAgentCliModelCatalog,
} = require('../dist-test/src/agentCliModels.js');
const { buildCardHandoffPrompt } = require('../dist-test/src/aiCards.js');
const { createBoardStore } = require('../dist-test/src/boardStore.js');
const packageJson = require('../package.json');

const SETTING = 'mwnn-kanban.agentCliModels';
const CARD_MODEL = 'claude-opus-5';
const DEFAULTS = {
  copilot: ['gpt-5', 'claude-sonnet-5'],
  codex: ['gpt-5-codex'],
  'claude-code': ['claude-sonnet-5', 'claude-opus-5'],
  cursor: ['auto'],
};
const BASELINE_ARGS = {
  copilot: ['--allow-all-tools', '--no-ask-user', '--silent'],
  codex: ['exec', '--sandbox', 'workspace-write', '-'],
  'claude-code': ['-p', '--permission-mode', 'bypassPermissions', '--output-format', 'text'],
  cursor: ['-p', '--force', '--output-format', 'text'],
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

async function main() {
  checkSettingDeclaration();

  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-workspace-model-smoke-'));
  const boardFolder = '.mwnn';
  try {
    const store = await createBoardStore({
      fileSystem: nodeFileSystem(workspaceRoot),
      boardFolder,
      defaultColumns: ['In Progress', 'Verify', 'Done'],
      defaultReadyReverseWip: 0,
    });
    const inProgress = store.getState().columns.find((column) => column.role === 'in-progress');
    if (!inProgress) {
      throw new Error('Smoke board has no In Progress column.');
    }

    await store.addCard(inProgress.id, 'Workspace default model smoke');
    const card = store
      .getState()
      .columns.flatMap((column) => column.cards)
      .find((candidate) => candidate.title === 'Workspace default model smoke');
    if (!card) {
      throw new Error('Smoke card was not created.');
    }
    await store.setDescription(card.id, 'Run this card on the workspace default model.');
    await store.setAcceptanceCriteria(card.id, '- [ ] The dispatch uses the resolved model');
    await store.setAssignee(card.id, { kind: 'ai' });
    const cardFile = path.join(workspaceRoot, boardFolder, 'cards', `${card.id}.md`);

    // The value a user would have in settings.json, read through the real
    // validator exactly as the extension host reads it.
    const catalog = readAgentCliModelCatalog(DEFAULTS);

    // 1. No card model: each provider runs on its own first configured entry.
    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      const expected = defaultAgentCliModel(catalog, provider);
      const invocation = await dispatch(store, card.id, provider, catalog);
      const flagIndex = invocation.args.indexOf('--model');
      assert.notEqual(flagIndex, -1, `${provider} did not receive a model argument.`);
      assert.equal(
        invocation.args[flagIndex + 1],
        expected,
        `${provider} did not run on its own configured default.`,
      );
      assert.equal(
        expected,
        DEFAULTS[provider][0],
        `${provider} default must be the first configured entry.`,
      );
      assert.deepEqual(
        agentCliModelsFor(catalog, provider),
        DEFAULTS[provider],
        `${provider} must expose its whole configured list for the card UI picker.`,
      );
      console.log(`  ${AGENT_CLI_LABELS[provider]}: ${invocation.args.join(' ')}`);
    }

    // The default stays a default: the card file gained no preferredModel key.
    assert.ok(
      !(await fs.readFile(cardFile, 'utf8')).includes('preferredModel'),
      'A workspace default must never be written back into the card file.',
    );

    // 2. The model the card names for a provider wins over that provider's
    // workspace default, and only for the provider it names.
    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      await store.setPreferredModel(card.id, provider, CARD_MODEL);
      const invocation = await dispatch(store, card.id, provider, catalog);
      const flagIndex = invocation.args.indexOf('--model');
      assert.equal(
        invocation.args[flagIndex + 1],
        CARD_MODEL,
        `${provider} used the workspace default instead of the card's own model.`,
      );
      await store.setPreferredModel(card.id, provider, undefined);
      // With that entry cleared, the provider is back on its workspace default.
      const afterClear = await dispatch(store, card.id, provider, catalog);
      assert.equal(
        afterClear.args[afterClear.args.indexOf('--model') + 1],
        DEFAULTS[provider][0],
        `${provider} must fall back to its workspace default once the card entry is cleared.`,
      );
    }

    // 3. A default configured only for other providers is ignored, and nothing
    // configured at all leaves the argv byte-identical to the original.
    const codexOnly = readAgentCliModelCatalog({ codex: DEFAULTS.codex });
    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      if (provider === 'codex') {
        continue;
      }
      assert.deepEqual(
        (await dispatch(store, card.id, provider, codexOnly)).args,
        BASELINE_ARGS[provider],
        `${provider} argv must be unchanged when only another provider has a default.`,
      );
      assert.deepEqual(
        (await dispatch(store, card.id, provider, undefined)).args,
        BASELINE_ARGS[provider],
        `${provider} argv must be unchanged when nothing is configured.`,
      );
    }

    console.log('Workspace default model smoke test passed.');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

/** What the settings UI renders comes straight from this declaration. */
function checkSettingDeclaration() {
  const properties = packageJson.contributes.configuration.properties;
  const declared = properties[SETTING];
  assert.ok(declared, `${SETTING} is not declared in package.json.`);
  assert.equal(declared.type, 'object', `${SETTING} must be a per-provider object.`);
  assert.deepEqual(declared.default, {}, `${SETTING} must default to empty.`);
  assert.equal(
    declared.scope,
    properties['mwnn-kanban.aiLoopCliFallbackOrder'].scope,
    `${SETTING} must use the same configuration scope as the other AI-loop settings.`,
  );
  assert.ok(
    typeof declared.markdownDescription === 'string' && declared.markdownDescription.length > 0,
    `${SETTING} needs a description for the settings UI.`,
  );
  for (const provider of AGENT_CLI_PROVIDER_IDS) {
    const entry = declared.properties[provider];
    assert.ok(entry, `${SETTING} is missing the ${provider} key.`);
    assert.equal(entry.type, 'array', `${SETTING}.${provider} must be a list of model names.`);
    assert.equal(entry.items.type, 'string', `${SETTING}.${provider} entries must be strings.`);
    assert.ok(
      typeof entry.description === 'string' && entry.description.length > 0,
      `${SETTING}.${provider} needs its own description.`,
    );
  }
  console.log(`  ${SETTING} is declared for: ${AGENT_CLI_PROVIDER_IDS.join(', ')}`);
}

/** One real hand-off whose CLI process is simulated; returns the invocation. */
async function dispatch(store, cardId, provider, modelCatalog) {
  let captured;
  const current = findCard(await store.reload(), cardId);
  await runAgentCliCardHandoff(
    {
      kind: 'implementation',
      target: fakeTarget(provider),
      cardId,
      prompt: buildCardHandoffPrompt(current, `.mwnn/cards/${cardId}.md`),
      cwd: '.',
      store,
      signal: new AbortController().signal,
      ...(modelCatalog !== undefined ? { modelCatalog } : {}),
    },
    {
      // Cursor's Windows prompt-file launch would otherwise change the argv
      // under test; the pointer path has its own coverage in the unit tests.
      platform: 'linux',
      runProcess: async (invocation) => {
        captured = invocation;
        await store.appendActivity(cardId, 'STATUS: DONE');
        return { started: true, cancelled: false, exitCode: 0, signal: null, stdout: 'done', stderr: '' };
      },
    },
  );
  if (!captured) {
    throw new Error(`No invocation was captured for ${provider}.`);
  }
  return captured;
}

function findCard(state, cardId) {
  for (const column of state.columns) {
    const found = column.cards.find((candidate) => candidate.id === cardId);
    if (found) {
      return found;
    }
  }
  throw new Error(`Card ${cardId} not found.`);
}

function fakeTarget(provider) {
  return {
    provider,
    label: AGENT_CLI_LABELS[provider],
    executable: `simulated-${provider}`,
    launcher: 'standalone',
  };
}

function nodeFileSystem(workspaceRoot) {
  const resolve = (relativePath) =>
    path.resolve(workspaceRoot, ...relativePath.split('/').filter(Boolean));
  return {
    async exists(relativePath) {
      try {
        await fs.access(resolve(relativePath));
        return true;
      } catch {
        return false;
      }
    },
    async readFile(relativePath) {
      return fs.readFile(resolve(relativePath), 'utf8');
    },
    async writeFile(relativePath, content) {
      await fs.mkdir(path.dirname(resolve(relativePath)), { recursive: true });
      await fs.writeFile(resolve(relativePath), content, 'utf8');
    },
    async deleteFile(relativePath) {
      await fs.rm(resolve(relativePath), { force: true });
    },
    async readDirectory(relativePath) {
      return fs.readdir(resolve(relativePath));
    },
    async createDirectory(relativePath) {
      await fs.mkdir(resolve(relativePath), { recursive: true });
    },
  };
}
