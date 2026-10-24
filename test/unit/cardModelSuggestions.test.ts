import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { AGENT_CLI_LABELS, AGENT_CLI_PROVIDER_IDS } from '../../src/agentCliProviders';
import { parseCard, serializeCard } from '../../src/serialization';
import { addCard, defaultBoard, setPreferredModel, setThinkingLevel } from '../../src/utils';
import {
  agentCliModelSuggestions,
  readAgentCliModelCatalog,
  readAgentCliThinkingLevelSuggestions,
} from '../../src/agentCliModels';
import {
  BOARD_STATE_VERSION,
  type AgentCliModelSuggestions,
  type BoardState,
  type HostToWebviewMessage,
} from '../../src/types';

interface PreferredModelDrafts {
  get(providerId: string): string;
  set(providerId: string, value: string): void;
  changes(card: { preferredModels?: Record<string, string> }): { provider: string; model: string }[];
}

interface ThinkingLevelDrafts {
  get(providerId: string): string;
  set(providerId: string, value: string): void;
  changes(card: { thinkingLevels?: Record<string, string> }): { provider: string; level: string }[];
}

interface BoardWebviewTestExports {
  AGENT_CLI_PROVIDERS: { id: string; label: string }[];
  modelSuggestionsFor(
    suggestions: AgentCliModelSuggestions | null | undefined,
    providerId: string,
  ): string[];
  modelPickerContent(
    models: readonly string[],
    filter: string,
    currentValue: string,
  ): { models: string[]; offerDefault: boolean; note: '' | 'unconfigured' | 'no-match' };
  createPreferredModelDrafts(
    providerIds: readonly string[],
    preferredModels: Record<string, string> | undefined,
  ): PreferredModelDrafts;
  createThinkingLevelDrafts(
    providerIds: readonly string[],
    thinkingLevels: Record<string, string> | undefined,
  ): ThinkingLevelDrafts;
}

// In Node, media/board.js returns its pure helpers before the browser bootstrap.
const { AGENT_CLI_PROVIDERS, modelSuggestionsFor, modelPickerContent, createPreferredModelDrafts, createThinkingLevelDrafts } =
  require('../../../media/board.js') as BoardWebviewTestExports;

const PROVIDER_IDS = AGENT_CLI_PROVIDERS.map((provider) => provider.id);

function emptyBoard(): BoardState {
  return { version: BOARD_STATE_VERSION, columns: [] };
}

suite('card model suggestions', () => {
  test('maps the configured model lists to per-provider suggestions', () => {
    const suggestions = agentCliModelSuggestions(
      readAgentCliModelCatalog({
        codex: ['gpt-5-codex', 'gpt-5'],
        'claude-code': ['claude-opus-5', '  claude-sonnet-5  ', '', 'claude-opus-5'],
        unknown: ['ignored'],
      }),
    );

    assert.deepEqual(suggestions, {
      codex: ['gpt-5-codex', 'gpt-5'],
      'claude-code': ['claude-opus-5', 'claude-sonnet-5'],
    });
  });

  test('omits a provider with no configured models so the webview sees no list', () => {
    const suggestions = agentCliModelSuggestions(readAgentCliModelCatalog({ codex: ['gpt-5-codex'] }));

    assert.equal(Object.prototype.hasOwnProperty.call(suggestions, 'cursor'), false);
    assert.deepEqual(modelSuggestionsFor(suggestions, 'cursor'), []);
    assert.deepEqual(modelSuggestionsFor(suggestions, 'codex'), ['gpt-5-codex']);
    // A malformed or missing payload degrades to "no suggestions", never a throw.
    assert.deepEqual(modelSuggestionsFor(undefined, 'codex'), []);
  });

  test('carries the per-provider suggestion list on the state message', () => {
    const modelSuggestions = agentCliModelSuggestions(
      readAgentCliModelCatalog({ copilot: ['claude-sonnet-5'], codex: ['gpt-5-codex'] }),
    );
    const message: HostToWebviewMessage = {
      type: 'state',
      board: emptyBoard(),
      enableRunWithAI: true,
      zoom: 1,
      modelSuggestions,
      thinkingLevelSuggestions: readAgentCliThinkingLevelSuggestions({ codex: ['medium', 'high'] }),
    };

    assert.equal(message.type, 'state');
    assert.deepEqual(message.modelSuggestions, {
      copilot: ['claude-sonnet-5'],
      codex: ['gpt-5-codex'],
    });
    assert.deepEqual(modelSuggestionsFor(message.modelSuggestions, 'copilot'), ['claude-sonnet-5']);
  });

  test('keeps an off-list model exactly as typed when the card is saved', () => {
    const suggestions = agentCliModelSuggestions(readAgentCliModelCatalog({ codex: ['gpt-5-codex'] }));
    const drafts = createPreferredModelDrafts(PROVIDER_IDS, undefined);

    drafts.set('codex', 'gpt-6-preview-2027');

    assert.equal(modelSuggestionsFor(suggestions, 'codex').includes('gpt-6-preview-2027'), false);
    assert.equal(drafts.get('codex'), 'gpt-6-preview-2027');
    assert.deepEqual(drafts.changes({}), [{ provider: 'codex', model: 'gpt-6-preview-2027' }]);
  });

  test('shows and keeps a stored model that is absent from the suggestions', () => {
    const drafts = createPreferredModelDrafts(PROVIDER_IDS, { codex: 'retired-model' });

    assert.equal(drafts.get('codex'), 'retired-model');
    assert.deepEqual(drafts.changes({ preferredModels: { codex: 'retired-model' } }), []);
  });

  test('clears only the edited provider and leaves the other entries untouched', () => {
    const card = { preferredModels: { codex: 'gpt-5-codex', 'claude-code': 'claude-opus-5' } };
    const drafts = createPreferredModelDrafts(PROVIDER_IDS, card.preferredModels);

    drafts.set('codex', '   ');

    assert.deepEqual(drafts.changes(card), [{ provider: 'codex', model: '' }]);
    assert.equal(drafts.get('claude-code'), 'claude-opus-5');
  });
});

suite('card thinking level drafts', () => {
  test('reports only the provider whose level changed, as a level change', () => {
    const card = { thinkingLevels: { codex: 'high' } };
    const drafts = createThinkingLevelDrafts(PROVIDER_IDS, card.thinkingLevels);

    assert.equal(drafts.get('codex'), 'high');
    assert.deepEqual(drafts.changes(card), []);

    drafts.set('cursor', '  medium  ');

    assert.deepEqual(drafts.changes(card), [{ provider: 'cursor', level: 'medium' }]);
    assert.equal(drafts.get('codex'), 'high');
  });

  test('an emptied field is a clear, not a no-op', () => {
    const card = { thinkingLevels: { codex: 'high' } };
    const drafts = createThinkingLevelDrafts(PROVIDER_IDS, card.thinkingLevels);

    drafts.set('codex', '   ');

    assert.deepEqual(drafts.changes(card), [{ provider: 'codex', level: '' }]);
  });

  test('levels and models are tracked independently for the same provider', () => {
    const card = { preferredModels: { codex: 'gpt-5-codex' }, thinkingLevels: { codex: 'high' } };
    const models = createPreferredModelDrafts(PROVIDER_IDS, card.preferredModels);
    const levels = createThinkingLevelDrafts(PROVIDER_IDS, card.thinkingLevels);

    levels.set('codex', 'low');

    // Editing one axis leaves the other reporting no change, so only the field
    // the user actually touched is posted.
    assert.deepEqual(models.changes(card), []);
    assert.deepEqual(levels.changes(card), [{ provider: 'codex', level: 'low' }]);
  });
});

suite('card model picker content', () => {
  test('a CLI with nothing configured still opens, with an explanation instead of a dead list', () => {
    // mwnn-kanban.agentCliModels defaults to {}, so this is the fresh-install case.
    const suggestions = agentCliModelSuggestions(readAgentCliModelCatalog({}));
    const content = modelPickerContent(modelSuggestionsFor(suggestions, 'claude-code'), '', '');

    assert.deepEqual(content, { models: [], offerDefault: false, note: 'unconfigured' });
  });

  test('an unconfigured CLI with a typed model still offers going back to the default', () => {
    const content = modelPickerContent([], '', 'my-byok-model');

    assert.equal(content.note, 'unconfigured');
    assert.equal(content.offerDefault, true);
  });

  test('opens with the whole list even when the field already names a model', () => {
    const models = ['claude-opus-5', 'claude-sonnet-5'];
    const content = modelPickerContent(models, '', 'claude-sonnet-5');

    assert.deepEqual(content, { models, offerDefault: true, note: '' });
  });

  test('narrows case-insensitively on text typed after opening', () => {
    const content = modelPickerContent(['claude-opus-5', 'claude-sonnet-5'], ' SONNET ', 'sonnet');

    assert.deepEqual(content.models, ['claude-sonnet-5']);
    assert.equal(content.note, '');
  });

  test('a typed name outside the list reports no match rather than rejecting it', () => {
    const content = modelPickerContent(['gpt-5-codex'], 'gpt-6-preview', 'gpt-6-preview');

    assert.deepEqual(content, { models: [], offerDefault: true, note: 'no-match' });
  });

  test('the thinking list opens with every configured level when the card already saves one', () => {
    // The datalist this replaced filtered on the saved value, so `high` showed only `high`.
    const levels = readAgentCliThinkingLevelSuggestions({ codex: ['low', 'medium', 'high'] });
    const content = modelPickerContent(modelSuggestionsFor(levels, 'codex'), '', 'high');

    assert.deepEqual(content, { models: ['low', 'medium', 'high'], offerDefault: true, note: '' });
  });

  test('the thinking list for a CLI with no levels configured explains itself', () => {
    const levels = readAgentCliThinkingLevelSuggestions({ codex: ['high'] });
    const content = modelPickerContent(modelSuggestionsFor(levels, 'claude-code'), '', '');

    assert.deepEqual(content, { models: [], offerDefault: false, note: 'unconfigured' });
  });
});

suite('Cursor Other card editor', () => {
  test('offers every host provider in order with the host label', () => {
    assert.deepEqual(AGENT_CLI_PROVIDERS, AGENT_CLI_PROVIDER_IDS.map((id) => ({
      id, label: AGENT_CLI_LABELS[id],
    })));
  });

  for (const typed of [false, true]) {
    test(`saves and clears independent Cursor Other fields (${typed ? 'typed' : 'suggested'})`, () => {
      let state = defaultBoard(['Backlog']);
      const column = state.columns[0]!;
      state = addCard(state, column.id, 'Independent Cursor values');
      const cardId = state.columns[0]!.cards[0]!.id;
      state = setPreferredModel(state, cardId, 'cursor', 'cursor-model');
      state = setThinkingLevel(state, cardId, 'cursor', 'cursor-level');
      state = setPreferredModel(state, cardId, 'codex', 'codex-model');
      state = setThinkingLevel(state, cardId, 'codex', 'high');
      const original = state.columns[0]!.cards[0]!;
      const models = createPreferredModelDrafts(PROVIDER_IDS, original.preferredModels);
      const levels = createThinkingLevelDrafts(PROVIDER_IDS, original.thinkingLevels);
      const modelSuggestions = agentCliModelSuggestions(readAgentCliModelCatalog({
        cursor: ['cursor-model'], 'cursor-other': ['other-model'],
      }));
      const thinkingSuggestions = readAgentCliThinkingLevelSuggestions({
        cursor: ['cursor-level'], 'cursor-other': ['other-level'],
      });
      assert.deepEqual(modelSuggestionsFor(modelSuggestions, 'cursor-other'), ['other-model']);
      assert.deepEqual(modelSuggestionsFor(thinkingSuggestions, 'cursor-other'), ['other-level']);
      const model = typed ? 'custom-model' : modelSuggestionsFor(modelSuggestions, 'cursor-other')[0]!;
      const level = typed ? 'custom-level' : modelSuggestionsFor(thinkingSuggestions, 'cursor-other')[0]!;
      models.set('cursor-other', model);
      levels.set('cursor-other', level);
      assert.deepEqual(models.changes(original), [{ provider: 'cursor-other', model }]);
      assert.deepEqual(levels.changes(original), [{ provider: 'cursor-other', level }]);
      for (const change of models.changes(original)) {
        assert.equal(change.provider, 'cursor-other');
        state = setPreferredModel(state, cardId, 'cursor-other', change.model);
      }
      for (const change of levels.changes(original)) {
        state = setThinkingLevel(state, cardId, 'cursor-other', change.level);
      }
      const saved = state.columns[0]!.cards[0]!;
      const text = serializeCard({ columnId: column.id, position: 1000, card: saved });
      assert.ok(text.includes(`preferredModel.cursor-other: ${model}`));
      assert.ok(text.includes(`thinkingLevel.cursor-other: ${level}`));
      assert.deepEqual(parseCard(text).card.preferredModels, { ...original.preferredModels, 'cursor-other': model });
      assert.deepEqual(parseCard(text).card.thinkingLevels, { ...original.thinkingLevels, 'cursor-other': level });

      const clearModels = createPreferredModelDrafts(PROVIDER_IDS, saved.preferredModels);
      const clearLevels = createThinkingLevelDrafts(PROVIDER_IDS, saved.thinkingLevels);
      clearModels.set('cursor-other', '');
      clearLevels.set('cursor-other', '   ');
      assert.deepEqual(clearModels.changes(saved), [{ provider: 'cursor-other', model: '' }]);
      assert.deepEqual(clearLevels.changes(saved), [{ provider: 'cursor-other', level: '' }]);
      state = setPreferredModel(state, cardId, 'cursor-other', clearModels.changes(saved)[0]!.model);
      assert.deepEqual(state.columns[0]!.cards[0]!.thinkingLevels, saved.thinkingLevels);
      state = setThinkingLevel(state, cardId, 'cursor-other', clearLevels.changes(saved)[0]!.level);
      const cleared = parseCard(serializeCard({ columnId: column.id, position: 1000, card: state.columns[0]!.cards[0]! }));
      assert.deepEqual(cleared.card.preferredModels, original.preferredModels);
      assert.deepEqual(cleared.card.thinkingLevels, original.thinkingLevels);
    });
  }
});
