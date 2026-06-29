import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  buildCardDefinitionPrompt,
  buildCardHandoffPrompt,
  buildCardPrompt,
  findAiCardSelection,
  formatActivityEntry,
  formatDefinitionHandoffEntry,
  formatHandoffEntry,
  listAiCardSelections,
  summarizeCardDescription,
} from '../../src/aiCards';
import { addCard, defaultBoard, setAcceptanceCriteria, setAssignee, setDescription } from '../../src/utils';

suite('ai card helpers', () => {
  test('listAiCardSelections returns only AI-assigned cards with their next column', () => {
    let board = defaultBoard(['Backlog', 'Ready', 'Done']);
    const backlogId = board.columns[0]!.id;
    const readyId = board.columns[1]!.id;
    const doneId = board.columns[2]!.id;

    board = addCard(board, backlogId, 'Human task');
    board = addCard(board, readyId, 'AI task');
    board = addCard(board, doneId, 'Last AI task');

    const humanCardId = board.columns[0]!.cards[0]!.id;
    const aiCardId = board.columns[1]!.cards[0]!.id;
    const lastAiCardId = board.columns[2]!.cards[0]!.id;

    board = setAssignee(board, humanCardId, { kind: 'human', name: 'Darren' });
    board = setAssignee(board, aiCardId, { kind: 'ai', name: 'Codex' });
    board = setAssignee(board, lastAiCardId, { kind: 'ai' });

    const selections = listAiCardSelections(board);

    assert.equal(selections.length, 2);
    assert.equal(selections[0]!.card.id, aiCardId);
    assert.equal(selections[0]!.nextColumn?.id, doneId);
    assert.equal(selections[1]!.card.id, lastAiCardId);
    assert.equal(selections[1]!.nextColumn, undefined);
  });

  test('findAiCardSelection ignores missing and non-AI cards', () => {
    let board = defaultBoard(['Ready']);
    const readyId = board.columns[0]!.id;

    board = addCard(board, readyId, 'Human task');
    const humanCardId = board.columns[0]!.cards[0]!.id;
    board = setAssignee(board, humanCardId, { kind: 'human', name: 'Darren' });

    assert.equal(findAiCardSelection(board, 'missing-card'), undefined);
    assert.equal(findAiCardSelection(board, humanCardId), undefined);
  });

  test('buildCardPrompt uses card details and fallback copy', () => {
    let board = defaultBoard(['Ready']);
    const readyId = board.columns[0]!.id;

    board = addCard(board, readyId, 'Write acceptance tests');
    const cardId = board.columns[0]!.cards[0]!.id;
    board = setDescription(board, cardId, '  Cover the AI helper paths.  ');
    board = setAcceptanceCriteria(board, cardId, '  - [ ] Prompt includes description  ');

    const card = board.columns[0]!.cards[0]!;
    assert.match(buildCardPrompt(card), /Title: Write acceptance tests/);
    assert.match(buildCardPrompt(card), /Cover the AI helper paths\./);
    assert.match(buildCardPrompt(card), /- \[ \] Prompt includes description/);

    const fallbackPrompt = buildCardPrompt({
      id: 'card-fallback',
      title: 'Fallback task',
      createdAt: 1,
    });
    assert.match(fallbackPrompt, /No description provided\./);
    assert.match(fallbackPrompt, /No acceptance criteria provided\./);
  });

  test('buildCardHandoffPrompt directs the agent to do the work and report status', () => {
    let board = defaultBoard(['Ready']);
    const readyId = board.columns[0]!.id;

    board = addCard(board, readyId, 'Add extension icon');
    const cardId = board.columns[0]!.cards[0]!.id;
    board = setDescription(board, cardId, 'Create a 128x128 icon.');
    board = setAcceptanceCriteria(board, cardId, '- [ ] icon.png exists');

    const card = board.columns[0]!.cards[0]!;
    const prompt = buildCardHandoffPrompt(card, `.mwnn/cards/${cardId}.md`);

    assert.match(prompt, /Title: Add extension icon/);
    assert.match(prompt, /Create a 128x128 icon\./);
    assert.match(prompt, /- \[ \] icon\.png exists/);
    assert.match(prompt, new RegExp(`\\.mwnn/cards/${cardId}\\.md`));
    assert.match(prompt, /STATUS: DONE/);
    assert.match(prompt, /STATUS: BLOCKED/);
  });

  test('buildCardDefinitionPrompt asks the agent to define the card without implementing it', () => {
    let board = defaultBoard(['Ready']);
    const readyId = board.columns[0]!.id;

    board = addCard(board, readyId, 'Add password reset');
    const cardId = board.columns[0]!.cards[0]!.id;

    const card = board.columns[0]!.cards[0]!;
    const prompt = buildCardDefinitionPrompt(card, `.mwnn/cards/${cardId}.md`);

    assert.match(prompt, /Title: Add password reset/);
    assert.match(prompt, /## Description/);
    assert.match(prompt, /## Acceptance criteria/);
    assert.match(prompt, /do not implement|Do not implement/);
    assert.match(prompt, new RegExp(`\\.mwnn/cards/${cardId}\\.md`));
    assert.match(prompt, /No description provided\./);
    assert.match(prompt, /No acceptance criteria provided\./);
  });

  test('formatDefinitionHandoffEntry records the provider and a timestamped definition note', () => {
    const entry = formatDefinitionHandoffEntry('GitHub Copilot', new Date('2026-06-27T18:10:00.000Z'));

    assert.equal(
      entry,
      [
        '### 2026-06-27T18:10:00.000Z - Definition requested from GitHub Copilot',
        'Asked GitHub Copilot to fill in the Description and Acceptance criteria for this card.',
      ].join('\n'),
    );
  });

  test('formatActivityEntry stamps model metadata and trims the response body', () => {
    const entry = formatActivityEntry(
      { name: 'GPT-5', vendor: 'OpenAI', family: 'gpt-5' },
      '\nSummarized the next steps.\n',
      new Date('2026-06-27T16:20:00.000Z'),
    );

    assert.equal(
      entry,
      [
        '### 2026-06-27T16:20:00.000Z - Run with AI (GPT-5)',
        'Model: OpenAI/gpt-5',
        '',
        'Summarized the next steps.',
      ].join('\n'),
    );
  });

  test('formatHandoffEntry records the provider and a timestamped dispatch note', () => {
    const entry = formatHandoffEntry('Codex (ChatGPT)', new Date('2026-06-27T17:40:00.000Z'));

    assert.equal(
      entry,
      [
        '### 2026-06-27T17:40:00.000Z - Handed off to Codex (ChatGPT)',
        'Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.',
      ].join('\n'),
    );
  });

  test('summarizeCardDescription collapses whitespace and truncates long text', () => {
    assert.equal(summarizeCardDescription(undefined), 'No description yet');
    assert.equal(summarizeCardDescription('  Small\nsummary  '), 'Small summary');

    const longSummary = summarizeCardDescription(
      'This description is intentionally long so the helper needs to trim it into a compact single-line summary for quick picks.',
    );
    assert.equal(longSummary.endsWith('...'), true);
    assert.equal(longSummary.length, 80);
  });
});
