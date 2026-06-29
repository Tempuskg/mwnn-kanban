import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { cardNeedsDefinition, isCardDefined } from '../../src/cardDefinition';

suite('card definition check', () => {
  test('a card is defined only when both Description and Acceptance criteria are non-empty', () => {
    assert.equal(isCardDefined({ description: 'Build the thing', acceptanceCriteria: '- [ ] It works' }), true);
    assert.equal(isCardDefined({ description: 'Build the thing', acceptanceCriteria: '' }), false);
    assert.equal(isCardDefined({ description: '', acceptanceCriteria: '- [ ] It works' }), false);
    assert.equal(isCardDefined({ description: '', acceptanceCriteria: '' }), false);
  });

  test('whitespace-only sections do not count as defined', () => {
    assert.equal(isCardDefined({ description: '   ', acceptanceCriteria: '- [ ] It works' }), false);
    assert.equal(isCardDefined({ description: 'Build the thing', acceptanceCriteria: '\n\t ' }), false);
    assert.equal(isCardDefined({ description: '  Build  ', acceptanceCriteria: '  - [ ] Done  ' }), true);
  });

  test('missing (undefined) sections are treated as empty', () => {
    assert.equal(isCardDefined({}), false);
    assert.equal(isCardDefined({ description: 'Build the thing' }), false);
    assert.equal(isCardDefined({ acceptanceCriteria: '- [ ] It works' }), false);
  });

  test('cardNeedsDefinition is the inverse of isCardDefined', () => {
    assert.equal(cardNeedsDefinition({ description: 'Build', acceptanceCriteria: '- [ ] Done' }), false);
    assert.equal(cardNeedsDefinition({ description: 'Build', acceptanceCriteria: '' }), true);
    assert.equal(cardNeedsDefinition({ description: '', acceptanceCriteria: '- [ ] Done' }), true);
    assert.equal(cardNeedsDefinition({}), true);
  });
});
