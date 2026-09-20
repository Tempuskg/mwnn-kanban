/**
 * Per-card preferred model smoke test, with simulated CLI results.
 *
 * Runs the real board store over a throwaway workspace on the real filesystem,
 * drives it with the same webview protocol message the board panel handles, and
 * then runs the real CLI handoff with the CLI process itself replaced. No agent
 * CLI is spawned and no paid credits are consumed.
 *
 * Verifies the halves of the feature end to end:
 *   1. Setting a card's model for one provider from the webview persists it to
 *      that provider's own key in the card file, leaves the other providers'
 *      keys alone, and clearing it removes only that key.
 *   2. A dispatch runs on the model named for the provider actually running:
 *      each CLI gets its own value as one model argument, with the prompt still
 *      on stdin; a provider the card says nothing about gets no model argument
 *      at all, and a card with no entries produces the original argv.
 *   3. A card written with the pre-scoping bare `preferredModel` scalar still
 *      dispatches on that model for every provider, and is migrated to the
 *      per-provider keys the next time the extension writes it.
 *
 * This is the scriptable half of the card's Development Host check; the visual
 * confirmation in the webview still belongs to a human running the extension.
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
const { buildCardHandoffPrompt } = require('../dist-test/src/aiCards.js');
const { createBoardStore } = require('../dist-test/src/boardStore.js');
const { isWebviewToHostMessage } = require('../dist-test/src/types.js');

const NEWLINE = String.fromCharCode(10);
const MODEL = 'claude-opus-5';
/** One distinct name per provider, so a leak between CLIs is visible. */
const PER_PROVIDER = {
  copilot: 'gpt-5-copilot',
  codex: 'gpt-5-codex',
  'claude-code': MODEL,
  cursor: 'cursor-fast',
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
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-card-model-smoke-'));
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

    await store.addCard(inProgress.id, 'Card model smoke');
    const card = store
      .getState()
      .columns.flatMap((column) => column.cards)
      .find((candidate) => candidate.title === 'Card model smoke');
    if (!card) {
      throw new Error('Smoke card was not created.');
    }
    await store.setDescription(card.id, 'Run this card on a named model.');
    await store.setAcceptanceCriteria(card.id, '- [ ] The dispatch uses the card model');
    await store.setAssignee(card.id, { kind: 'ai' });

    const cardFile = path.join(workspaceRoot, boardFolder, 'cards', `${card.id}.md`);
    assert.ok(
      !(await readCardFile(cardFile)).includes('preferredModel'),
      'A card saved without a model must gain no preferredModel key.',
    );

    // 1. The webview sets one provider's model. This is the exact message the
    // board panel validates and forwards to the store.
    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      await applyWebviewMessage(store, {
        type: 'setPreferredModel',
        cardId: card.id,
        provider,
        preferredModel: PER_PROVIDER[provider],
      });
    }
    const written = await readCardFile(cardFile);
    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      assert.ok(
        written.includes(`preferredModel.${provider}: ${PER_PROVIDER[provider]}`),
        `Setting the ${provider} model in the webview must persist its own key.`,
      );
    }
    assert.deepEqual(
      findCard(await store.reload(), card.id).preferredModels,
      PER_PROVIDER,
      'A reload must read every persisted per-provider model back.',
    );

    // 2. Each dispatch runs on the model named for the provider running it.
    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      const invocation = await dispatch(store, card.id, provider);
      const flagIndex = invocation.args.indexOf('--model');
      assert.notEqual(flagIndex, -1, `${provider} did not receive a model argument.`);
      assert.equal(
        invocation.args[flagIndex + 1],
        PER_PROVIDER[provider],
        `${provider} did not receive its own model as one argument.`,
      );
      for (const other of AGENT_CLI_PROVIDER_IDS) {
        if (other !== provider) {
          assert.ok(
            !invocation.args.includes(PER_PROVIDER[other]),
            `${provider} argv must not carry the ${other} model.`,
          );
        }
      }
      assert.ok(
        invocation.stdin.includes('Card model smoke'),
        `${provider} must still receive the hand-off prompt on stdin.`,
      );
      assert.ok(
        invocation.args.every((argument) => !argument.includes(NEWLINE)),
        `${provider} argv must stay single-line.`,
      );
      console.log(`  ${AGENT_CLI_LABELS[provider]}: ${invocation.args.join(' ')}`);
    }

    // 3. Clearing one provider's model removes only that key, and that CLI
    // falls back to its own default while the others keep their models.
    await applyWebviewMessage(store, { type: 'setPreferredModel', cardId: card.id, provider: 'codex' });
    const afterClear = await readCardFile(cardFile);
    assert.ok(
      !afterClear.includes('preferredModel.codex'),
      'Clearing one provider must remove that key from the card file.',
    );
    assert.ok(
      afterClear.includes(`preferredModel.cursor: ${PER_PROVIDER.cursor}`),
      'Clearing one provider must leave the other providers untouched.',
    );
    assert.deepEqual(
      (await dispatch(store, card.id, 'codex')).args,
      BASELINE_ARGS.codex,
      'A provider the card names no model for must get no model argument.',
    );

    // 4. Clearing every provider removes the key entirely and restores the
    // original argv exactly.
    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      await applyWebviewMessage(store, { type: 'setPreferredModel', cardId: card.id, provider });
    }
    assert.ok(
      !(await readCardFile(cardFile)).includes('preferredModel'),
      'Clearing every provider must remove the key from the card file.',
    );
    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      const invocation = await dispatch(store, card.id, provider);
      assert.deepEqual(
        invocation.args,
        BASELINE_ARGS[provider],
        `${provider} argv must be unchanged for a card with no model.`,
      );
    }

    // 5. A card hand-written with the pre-scoping bare scalar keeps working on
    // every provider, and is migrated to the scoped keys on the next write.
    await writeLegacyScalar(cardFile, MODEL);
    await store.reload();
    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      const invocation = await dispatch(store, card.id, provider);
      const flagIndex = invocation.args.indexOf('--model');
      assert.equal(
        invocation.args[flagIndex + 1],
        MODEL,
        `${provider} must still run on a legacy bare preferredModel.`,
      );
    }
    // Any write migrates the file: the bare key is gone, the scoped keys are in.
    await store.setActivity(card.id, 'Migrated by the smoke test.');
    const migrated = await readCardFile(cardFile);
    assert.ok(
      !migrated.split(NEWLINE).some((line) => line.trim() === `preferredModel: ${MODEL}`),
      'The legacy bare key must not survive a write.',
    );
    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      assert.ok(
        migrated.includes(`preferredModel.${provider}: ${MODEL}`),
        `The legacy value must be migrated to the ${provider} key.`,
      );
    }

    console.log('Card preferred model smoke test passed.');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

/** Mirror the board panel: validate the message, then apply it to the store. */
async function applyWebviewMessage(store, message) {
  assert.ok(isWebviewToHostMessage(message), 'The webview message must satisfy the shared protocol guard.');
  await store.setPreferredModel(message.cardId, message.provider, message.preferredModel);
}

/**
 * Rewrite the card file with the pre-scoping bare scalar, the way a card
 * authored before per-provider scoping looks on disk.
 */
async function writeLegacyScalar(cardFile, model) {
  const text = await readCardFile(cardFile);
  const lines = text.split(NEWLINE).filter((line) => !line.startsWith('preferredModel'));
  const insertAt = lines.findIndex((line) => line.startsWith('createdAt:'));
  lines.splice(insertAt, 0, `preferredModel: ${model}`);
  await fs.writeFile(cardFile, lines.join(NEWLINE), 'utf8');
}

/** One real hand-off whose CLI process is simulated; returns the invocation. */
async function dispatch(store, cardId, provider) {
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

async function readCardFile(cardFile) {
  return fs.readFile(cardFile, 'utf8');
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
