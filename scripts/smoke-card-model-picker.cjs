/**
 * Card model picker smoke test.
 *
 * Drives the webview's own picker logic - the pure helpers exported by
 * `media/board.js` - against the real board store on a real temporary
 * workspace, posting the same protocol messages the board panel handles. It
 * covers the three things a human otherwise has to click through in the
 * Development Host, so the human check is left with the visual half only:
 *
 *   1. Picking a model from the suggestion list saves that name.
 *   2. Typing a model that is not in the list saves it unchanged, and still
 *      wins over the workspace default at dispatch.
 *   3. Clearing the field removes only that provider's key from the card file.
 *
 * It also checks that a provider with nothing configured gets no suggestions
 * yet still saves a typed name, and that switching the selected provider edits
 * only the entry that changed.
 *
 * No agent CLI is spawned and no paid credits are consumed.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  agentCliModelSuggestions,
  readAgentCliModelCatalog,
  resolveAgentCliModel,
} = require('../dist-test/src/agentCliModels.js');
const { createBoardStore } = require('../dist-test/src/boardStore.js');
const { AGENT_CLI_PROVIDER_IDS, isWebviewToHostMessage } = require('../dist-test/src/types.js');
const { modelSuggestionsFor, createPreferredModelDrafts } = require('../media/board.js');

/** Stands in for `mwnn-kanban.agentCliModels`; `cursor` is left unconfigured. */
const CONFIGURED_MODELS = {
  copilot: ['claude-sonnet-5', 'gpt-5'],
  codex: ['gpt-5-codex', 'gpt-5'],
  'claude-code': ['claude-opus-5', 'claude-sonnet-5'],
};
const OFF_LIST_MODEL = 'gpt-6-preview-2027';
const UNCONFIGURED_MODEL = 'cursor-fast';

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

async function main() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-model-picker-smoke-'));
  const boardFolder = '.mwnn';
  try {
    // The host validates the setting once and posts the result with the board;
    // the webview never reads configuration itself.
    const catalog = readAgentCliModelCatalog(CONFIGURED_MODELS);
    const suggestions = agentCliModelSuggestions(catalog);
    assert.deepEqual(
      modelSuggestionsFor(suggestions, 'claude-code'),
      ['claude-opus-5', 'claude-sonnet-5'],
      'A configured provider must offer its configured models, in order.',
    );
    assert.deepEqual(
      modelSuggestionsFor(suggestions, 'cursor'),
      [],
      'An unconfigured provider must offer no suggestions.',
    );

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
    await store.addCard(inProgress.id, 'Model picker smoke');
    const card = findCardByTitle(store.getState(), 'Model picker smoke');
    const cardFile = path.join(workspaceRoot, boardFolder, 'cards', `${card.id}.md`);

    // 1. Open the card's details, pick a model from the list for one provider,
    // type an off-list model for a second, and type a name for the provider
    // that has no suggestions at all. Only the edited entries are posted.
    const drafts = createPreferredModelDrafts(AGENT_CLI_PROVIDER_IDS, card.preferredModels);
    const picked = modelSuggestionsFor(suggestions, 'claude-code')[1];
    drafts.set('claude-code', picked);
    drafts.set('codex', OFF_LIST_MODEL);
    drafts.set('cursor', UNCONFIGURED_MODEL);
    assert.deepEqual(
      drafts.changes(card).map((change) => change.provider).sort(),
      ['claude-code', 'codex', 'cursor'],
      'Only the providers the user edited may be posted.',
    );
    await applyChanges(store, card.id, drafts.changes(card));

    const written = await fs.readFile(cardFile, 'utf8');
    assert.ok(
      written.includes(`preferredModel.claude-code: ${picked}`),
      'A model picked from the list must persist verbatim.',
    );
    assert.ok(
      written.includes(`preferredModel.codex: ${OFF_LIST_MODEL}`),
      'A model typed by hand must persist unchanged even though it is not in the list.',
    );
    assert.ok(
      written.includes(`preferredModel.cursor: ${UNCONFIGURED_MODEL}`),
      'A provider with no suggestions must still save a typed model.',
    );
    assert.ok(
      !written.includes('preferredModel.copilot'),
      'An untouched provider must gain no key.',
    );

    // 2. Reopening the card shows the stored values, including the off-list one,
    // and dispatch still runs on it rather than the configured default.
    const reloaded = findCardByTitle(await store.reload(), 'Model picker smoke');
    const reopened = createPreferredModelDrafts(AGENT_CLI_PROVIDER_IDS, reloaded.preferredModels);
    assert.equal(reopened.get('codex'), OFF_LIST_MODEL, 'An off-list stored model must still display.');
    assert.deepEqual(reopened.changes(reloaded), [], 'Reopening an unedited card must post nothing.');
    assert.deepEqual(
      resolveAgentCliModel('codex', reloaded.preferredModels.codex, catalog),
      { model: OFF_LIST_MODEL, source: 'card' },
      'An off-list card model must still be the model dispatched.',
    );

    // 3. Clearing the field removes that provider's entry and leaves the rest.
    reopened.set('codex', '');
    await applyChanges(store, reloaded.id, reopened.changes(reloaded));
    const afterClear = await fs.readFile(cardFile, 'utf8');
    assert.ok(
      !afterClear.includes('preferredModel.codex'),
      'Clearing the field must remove that provider key from the card file.',
    );
    assert.ok(
      afterClear.includes(`preferredModel.claude-code: ${picked}`) &&
        afterClear.includes(`preferredModel.cursor: ${UNCONFIGURED_MODEL}`),
      'Clearing one provider must leave the other entries untouched.',
    );
    assert.equal(
      resolveAgentCliModel('codex', undefined, catalog).model,
      CONFIGURED_MODELS.codex[0],
      'A cleared provider must fall back to the workspace default.',
    );

    console.log('Card model picker smoke test passed.');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

/** Mirror the webview save: one validated protocol message per changed entry. */
async function applyChanges(store, cardId, changes) {
  for (const change of changes) {
    const message = change.model.length > 0
      ? { type: 'setPreferredModel', cardId, provider: change.provider, preferredModel: change.model }
      : { type: 'setPreferredModel', cardId, provider: change.provider };
    assert.ok(isWebviewToHostMessage(message), 'The webview message must satisfy the shared protocol guard.');
    await store.setPreferredModel(message.cardId, message.provider, message.preferredModel);
  }
}

function findCardByTitle(state, title) {
  for (const column of state.columns) {
    const found = column.cards.find((candidate) => candidate.title === title);
    if (found) {
      return found;
    }
  }
  throw new Error(`Card "${title}" not found.`);
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
