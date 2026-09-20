import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { agentCliModelSuggestions, readAgentCliModelCatalog } from '../../src/agentCliModels';
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

interface BoardWebviewTestExports {
  modelSuggestionsFor(
    suggestions: AgentCliModelSuggestions | null | undefined,
    providerId: string,
  ): string[];
  createPreferredModelDrafts(
    providerIds: readonly string[],
    preferredModels: Record<string, string> | undefined,
  ): PreferredModelDrafts;
}

// In Node, media/board.js returns its pure helpers before the browser bootstrap.
const { modelSuggestionsFor, createPreferredModelDrafts } =
  require('../../../media/board.js') as BoardWebviewTestExports;

const PROVIDER_IDS = ['copilot', 'codex', 'claude-code', 'cursor'] as const;

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
