import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { buildCardDefinitionPrompt } from '../../src/aiCards';
import {
  JEV_ENDPOINT,
  JevPendingDefinitions,
  buildJevRunSettingsRequest,
  planDefinitionRunSettings,
  formatRunSettingsActivityEntry,
  requestJevRunSettings,
  type JevFetch,
  type RunSettingCandidates,
} from '../../src/cardRunSettings';
import {
  addCard,
  defaultBoard,
  setAcceptanceCriteria,
  setDescription,
  setPreferredModel,
  setThinkingLevel,
} from '../../src/utils';

const candidates: RunSettingCandidates = {
  models: {
    'claude-code': ['sonnet', 'opus', 'haiku'],
    codex: ['openai/gpt-5: preview', 'gpt-5-mini'],
    cursor: ['auto'],
  },
  thinkingLevels: {
    'claude-code': ['low', 'medium', 'high'],
    cursor: ['low', 'high'],
  },
};

function makeCard(
  configure?: (board: ReturnType<typeof defaultBoard>, cardId: string) => ReturnType<typeof defaultBoard>,
  defined = true,
) {
  let board = defaultBoard(['Backlog']);
  board = addCard(board, board.columns[0]!.id, 'Rework the store protocol');
  const cardId = board.columns[0]!.cards[0]!.id;
  if (defined) {
    board = setAcceptanceCriteria(
      setDescription(board, cardId, 'Split the store into reader and writer modules.'),
      cardId,
      '- [ ] Store tests pass',
    );
  }
  if (configure) {
    board = configure(board, cardId);
  }
  return board.columns[0]!.cards[0]!;
}

function fakeFetch(body: unknown, calls: { url: string; body: unknown }[] = []): JevFetch {
  return async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) as unknown });
    return { ok: true, status: 200, json: async () => body };
  };
}

suite('card run settings on definition', () => {
  test('definition prompt allows only run-settings frontmatter keys and lists candidates', () => {
    const card = makeCard();
    const prompt = buildCardDefinitionPrompt(card, '.mwnn/cards/x.md', {
      candidates,
      overwriteExisting: false,
      mode: { kind: 'agent', reason: 'Jev is not configured (TYPESAFE_API_KEY is not set)' },
    });

    assert.match(prompt, /only frontmatter keys you may add or change are `preferredModel\.<provider>` and `thinkingLevel\.<provider>`/);
    assert.match(prompt, /Do not change any other frontmatter, the title, or existing Activity entries/);
    assert.doesNotMatch(prompt, /Do not change the frontmatter,/);
    assert.match(prompt, /claude-code models: sonnet, opus, haiku/);
    assert.match(prompt, /claude-code thinking levels: low, medium, high/);
    assert.match(prompt, /codex models: openai\/gpt-5: preview, gpt-5-mini/);
    // One candidate is no choice, and a provider without a list is left unset.
    assert.doesNotMatch(prompt, /cursor models:/);
    assert.doesNotMatch(prompt, /copilot models:/);
    assert.match(prompt, /leave its keys unset/);
    assert.match(prompt, /Never write the legacy bare `preferredModel` key/);
    assert.match(prompt, /never write a key with an empty value/);
    assert.match(prompt, /JSON-quote a value/);
    assert.match(prompt, /thinkingLevel\.cursor` value may be recorded but is reported as not applied, which is not an error/);
    assert.match(prompt, /Jev was not used \(Jev is not configured/);
    assert.match(prompt, /note that Jev was unavailable/);
  });

  test('definition prompt preserves existing card keys unless overwriting is opted in', () => {
    const card = makeCard((board, id) =>
      setThinkingLevel(setPreferredModel(board, id, 'claude-code', 'opus'), id, 'claude-code', 'high'));
    const settings = {
      candidates,
      overwriteExisting: false,
      mode: { kind: 'agent', reason: 'off' } as const,
    };

    const kept = buildCardDefinitionPrompt(card, '.mwnn/cards/x.md', settings);
    assert.match(kept, /preferredModel\.claude-code: opus/);
    assert.match(kept, /thinkingLevel\.claude-code: high/);
    assert.match(kept, /Keep every existing non-empty/);
    assert.doesNotMatch(kept, /claude-code models:/);
    assert.doesNotMatch(kept, /claude-code thinking levels:/);
    assert.match(kept, /codex models:/);

    const replaced = buildCardDefinitionPrompt(card, '.mwnn/cards/x.md', { ...settings, overwriteExisting: true });
    assert.match(replaced, /claude-code models: sonnet, opus, haiku/);
    assert.match(replaced, /allows replacing existing run settings/);
  });

  test('Jev-available path returns a typed recommendation limited to candidates', async () => {
    const card = makeCard((board, id) => setPreferredModel(board, id, 'claude-code', 'opus'));
    const calls: { url: string; body: unknown }[] = [];
    const result = await requestJevRunSettings(card, candidates, {
      apiKey: 'k',
      enabled: true,
      overwriteExisting: false,
      fetch: fakeFetch({
        answers: {
          tier: { type: 'choice', choice: 'heavy' },
          'model.codex': { type: 'choice', choice: 'openai/gpt-5: preview' },
          'model.claude-code': { type: 'choice', choice: 'haiku' },
          'level.claude-code': { type: 'choice', choice: 'high' },
          'level.cursor': { type: 'choice', choice: 'invented-level' },
        },
      }, calls),
    });

    assert.equal(result.kind, 'jev');
    assert.ok(result.kind === 'jev');
    assert.equal(result.recommendation.tier, 'heavy');
    // The card's explicit claude-code model is preserved: it was never asked.
    assert.deepEqual(result.recommendation.models, { codex: 'openai/gpt-5: preview' });
    assert.deepEqual(result.recommendation.thinkingLevels, { 'claude-code': 'high' });

    assert.equal(calls[0]!.url, JEV_ENDPOINT);
    const questions = (calls[0]!.body as { questions: Record<string, unknown> }).questions;
    assert.deepEqual(Object.keys(questions).sort(), ['level.claude-code', 'level.cursor', 'model.codex', 'tier']);

    const entry = formatRunSettingsActivityEntry(result, new Date('2026-09-27T00:00:00.000Z'));
    assert.match(entry, /Run settings recommended by Jev/);
    assert.match(entry, /difficulty tier: \*\*heavy\*\*/);
    assert.match(entry, /codex: model `openai\/gpt-5: preview`/);
  });

  test('overwrite opt-in asks Jev about providers the card already sets', () => {
    const card = makeCard((board, id) => setPreferredModel(board, id, 'claude-code', 'opus'));
    const request = buildJevRunSettingsRequest(card, candidates, true);
    assert.ok('model.claude-code' in request.questions);
  });

  test('Jev-unavailable paths fall back without throwing', async () => {
    const card = makeCard();
    const base = { enabled: true, overwriteExisting: false } as const;

    const unconfigured = await requestJevRunSettings(card, candidates, base);
    assert.deepEqual(unconfigured, { kind: 'fallback', reason: 'Jev is not configured (TYPESAFE_API_KEY is not set)' });

    const disabled = await requestJevRunSettings(card, candidates, { ...base, enabled: false, apiKey: 'k' });
    assert.equal(disabled.kind, 'fallback');

    const httpError = await requestJevRunSettings(card, candidates, {
      ...base,
      apiKey: 'k',
      fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    });
    assert.deepEqual(httpError, { kind: 'fallback', reason: 'Jev request failed (HTTP 503)' });

    const thrown = await requestJevRunSettings(card, candidates, {
      ...base,
      apiKey: 'k',
      fetch: async () => { throw new Error('ENOTFOUND'); },
    });
    assert.deepEqual(thrown, { kind: 'fallback', reason: 'Jev request failed (ENOTFOUND)' });

    const garbage = await requestJevRunSettings(card, candidates, {
      ...base,
      apiKey: 'k',
      fetch: fakeFetch({ answers: { tier: { choice: 'enormous' } } }),
    });
    assert.deepEqual(garbage, { kind: 'fallback', reason: 'Jev returned an unusable answer' });

    const timedOut = await requestJevRunSettings(card, candidates, {
      ...base,
      apiKey: 'k',
      timeoutMs: 10,
      fetch: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    });
    assert.deepEqual(timedOut, { kind: 'fallback', reason: 'Jev timed out after 10 ms' });

    const entry = formatRunSettingsActivityEntry(timedOut, new Date('2026-09-27T00:00:00.000Z'));
    assert.match(entry, /Run settings: Jev fallback/);
    assert.match(entry, /no run settings were changed/);
  });

  test('Jev is never called for a card without both a Description and Acceptance criteria', async () => {
    const answers = { answers: { tier: { type: 'choice', choice: 'light' } } };
    for (const [description, criteria] of [['', ''], ['Some scope', ''], ['', '- [ ] Done'], ['  ', '\n']] as const) {
      let board = defaultBoard(['Backlog']);
      board = addCard(board, board.columns[0]!.id, 'Untitled scope');
      const cardId = board.columns[0]!.cards[0]!.id;
      board = setAcceptanceCriteria(setDescription(board, cardId, description), cardId, criteria);
      const card = board.columns[0]!.cards[0]!;
      const calls: { url: string; body: unknown }[] = [];
      const result = await requestJevRunSettings(card, candidates, {
        apiKey: 'k',
        enabled: true,
        overwriteExisting: false,
        fetch: fakeFetch(answers, calls),
      });
      assert.equal(calls.length, 0, `Jev was called for description=${JSON.stringify(description)}`);
      assert.deepEqual(result, { kind: 'fallback', reason: 'the card has no Description and Acceptance criteria yet' });
    }

    const calls: { url: string; body: unknown }[] = [];
    await requestJevRunSettings(makeCard(), candidates, {
      apiKey: 'k',
      enabled: true,
      overwriteExisting: false,
      fetch: fakeFetch(answers, calls),
    });
    assert.equal(calls.length, 1);
  });

  test('definition plan defers to Jev only when it is enabled and configured', () => {
    assert.deepEqual(planDefinitionRunSettings({ enabled: true, apiKey: 'k' }), { kind: 'jev-after-definition' });
    assert.deepEqual(planDefinitionRunSettings({ enabled: true, apiKey: '  ' }), {
      kind: 'agent',
      reason: 'Jev is not configured (TYPESAFE_API_KEY is not set)',
    });
    assert.deepEqual(planDefinitionRunSettings({ enabled: false, apiKey: 'k' }), {
      kind: 'agent',
      reason: 'Jev recommendations are turned off in settings',
    });
  });

  test('definition prompt tells the agent to leave run settings to Jev when Jev runs afterward', () => {
    const card = makeCard(undefined, false);
    const prompt = buildCardDefinitionPrompt(card, '.mwnn/cards/x.md', {
      candidates,
      overwriteExisting: false,
      mode: { kind: 'jev-after-definition' },
    });
    assert.doesNotMatch(prompt, /already judged/);
    assert.match(prompt, /Do not set run settings/);
    assert.match(prompt, /After you finish the Description and Acceptance criteria, Jev \(TypeSafe\) will judge/);
    assert.match(prompt, /Do not change the frontmatter \(including any `preferredModel\.\*` \/ `thinkingLevel\.\*`/);
    assert.doesNotMatch(prompt, /only frontmatter keys you may add or change/);
    assert.doesNotMatch(prompt, /Candidates you may set/);
    assert.doesNotMatch(prompt, /claude-code models:/);
  });

  test('chat definitions fire Jev once, when the card first becomes newly defined', () => {
    let board = defaultBoard(['Backlog']);
    board = addCard(board, board.columns[0]!.id, 'Pending card');
    board = addCard(board, board.columns[0]!.id, 'Gone card');
    const [pendingCard, goneCard] = board.columns[0]!.cards;
    const tracker = new JevPendingDefinitions();
    tracker.add(pendingCard!);
    tracker.add(goneCard!);

    // Partial definition: not ready yet.
    board = setDescription(board, pendingCard!.id, 'Scope');
    assert.deepEqual(tracker.takeReady(board), []);

    board = setAcceptanceCriteria(board, pendingCard!.id, '- [ ] Works');
    const withoutGone = {
      ...board,
      columns: board.columns.map((column) => ({
        ...column,
        cards: column.cards.filter((card) => card.id !== goneCard!.id),
      })),
    };
    assert.deepEqual(tracker.takeReady(withoutGone), [pendingCard!.id]);

    // Later edits never re-trigger, and the vanished card was forgotten.
    const edited = setDescription(withoutGone, pendingCard!.id, 'Scope, refined');
    assert.deepEqual(tracker.takeReady(edited), []);
    assert.deepEqual(tracker.takeReady(board), []);
  });

  test('a card already defined at hand-off waits for the agent to change its definition', () => {
    let board = defaultBoard(['Backlog']);
    board = addCard(board, board.columns[0]!.id, 'Redefine me');
    const cardId = board.columns[0]!.cards[0]!.id;
    board = setAcceptanceCriteria(setDescription(board, cardId, 'Old scope'), cardId, '- [ ] Old');
    const tracker = new JevPendingDefinitions();
    tracker.add(board.columns[0]!.cards[0]!);

    assert.deepEqual(tracker.takeReady(board), []);
    board = setDescription(board, cardId, 'New scope');
    assert.deepEqual(tracker.takeReady(board), [cardId]);
  });
});
