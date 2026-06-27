import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  BOARD_FILE_VERSION,
  parseCard,
  parseColumns,
  serializeCard,
  serializeColumns,
  type CardDocument,
  type ColumnsDocument,
} from '../../src/serialization';

suite('serialization', () => {
  test('card markdown round-trips with full metadata and body sections', () => {
    const document: CardDocument = {
      columnId: 'col-ready',
      position: 1500,
      card: {
        id: 'card-abc123',
        title: 'Add login form: basic flow',
        createdAt: 1719360000000,
        updatedAt: 1719363600000,
        description: 'Build the login form.\nWire the basic happy path.',
        acceptanceCriteria: '- [ ] Form validates email\n- [ ] Submit button is disabled while pending',
        activity: '- 2026-06-26 Claude: claimed',
        assignee: { kind: 'ai', name: 'Claude' },
      },
    };

    assert.deepEqual(parseCard(serializeCard(document)), document);
  });

  test('card markdown round-trips when optional sections are omitted', () => {
    const document: CardDocument = {
      columnId: 'col-backlog',
      position: 1000,
      card: {
        id: 'card-plain',
        title: 'Simple task',
        createdAt: 1719360000000,
      },
    };

    assert.deepEqual(parseCard(serializeCard(document)), document);
  });

  test('columns json round-trips with roles and limits', () => {
    const document: ColumnsDocument = {
      version: BOARD_FILE_VERSION,
      columns: [
        { id: 'col-backlog', title: 'Backlog', role: 'backlog', wipLimit: null, reverseWip: null },
        { id: 'col-ready', title: 'Ready', role: 'ready', wipLimit: null, reverseWip: 3 },
      ],
    };

    assert.deepEqual(parseColumns(serializeColumns(document)), document);
  });

  test('parseCard rejects missing frontmatter', () => {
    assert.throws(() => parseCard('## Description\nNo frontmatter'), /frontmatter/i);
  });

  test('parseColumns rejects the wrong file version', () => {
    assert.throws(
      () =>
        parseColumns(
          JSON.stringify({
            version: 1,
            columns: [],
          }),
        ),
      /columns document/i,
    );
  });
});
