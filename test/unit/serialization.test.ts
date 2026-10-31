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
        dependsOn: ['card-dep1', 'card-dep2'],
      },
    };

    assert.deepEqual(parseCard(serializeCard(document)), document);
  });

  test('card markdown round-trips a single dependency and omits empty lists', () => {
    const withDependency: CardDocument = {
      columnId: 'col-impl',
      position: 1000,
      card: {
        id: 'card-blocked',
        title: 'Blocked work',
        createdAt: 1719360000000,
        dependsOn: ['card-upstream'],
      },
    };
    assert.deepEqual(parseCard(serializeCard(withDependency)), withDependency);

    const withoutDependencies: CardDocument = {
      columnId: 'col-impl',
      position: 1000,
      card: {
        id: 'card-free',
        title: 'Unblocked work',
        createdAt: 1719360000000,
      },
    };
    const serialized = serializeCard({
      ...withoutDependencies,
      card: { ...withoutDependencies.card, dependsOn: [] },
    });
    assert.ok(!serialized.includes('dependsOn'), 'an empty dependency list is not written to frontmatter');
    assert.deepEqual(parseCard(serialized), withoutDependencies);
  });

  test('card markdown accepts a block-style dependency list from existing boards', () => {
    const markdown = `---
id: card-block-list
title: Block list dependency
column: col-ready
position: 1000
dependsOn:
  - card-upstream
createdAt: 1719360000000
---

## Description
Depends on an existing card.

## Acceptance criteria

## Activity
`;

    assert.deepEqual(parseCard(markdown).card.dependsOn, ['card-upstream']);
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

  test('card markdown preserves multiline Markdown Activity content', () => {
    const activity = [
      '## 2026-08-09 - Human note',
      '',
      '- Kept a list item',
      '- [x] Kept a workflow marker',
      '',
      '    const formatted = true;',
    ].join('\n');
    const document: CardDocument = {
      columnId: 'col-impl',
      position: 1000,
      card: {
        id: 'card-activity',
        title: 'Editable activity',
        createdAt: 1719360000000,
        activity,
      },
    };

    const serialized = serializeCard(document);
    assert.equal(parseCard(serialized).card.activity, activity);
    assert.match(serialized, /- \[x\] Kept a workflow marker/);
    assert.match(serialized, /## 2026-08-09 - Human note/);
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

  test('columns json round-trips a verify-role column', () => {
    const document: ColumnsDocument = {
      version: BOARD_FILE_VERSION,
      columns: [{ id: 'col-verify', title: 'Verify', role: 'verify', wipLimit: null, reverseWip: null }],
    };

    const serialized = serializeColumns(document);
    assert.match(serialized, /"role": "verify"/);
    assert.deepEqual(parseColumns(serialized), document);
  });

  test('card markdown round-trips scheduledFor and expands date-only to T00:00', () => {
    const document: CardDocument = {
      columnId: 'col-ready',
      position: 1000,
      card: {
        id: 'card-scheduled',
        title: 'Timed work',
        createdAt: 1719360000000,
        scheduledFor: '2026-11-01T09:30',
      },
    };

    const serialized = serializeCard(document);
    assert.match(serialized, /scheduledFor: "2026-11-01T09:30"/);
    assert.deepEqual(parseCard(serialized), document);

    const dateOnly = `---
id: card-scheduled
title: Timed work
column: col-ready
position: 1000
scheduledFor: 2026-11-01
createdAt: 1719360000000
---

## Description

## Acceptance criteria

## Activity
`;
    assert.equal(parseCard(dateOnly).card.scheduledFor, '2026-11-01T00:00');
    assert.match(serializeCard(parseCard(dateOnly)), /scheduledFor: "2026-11-01T00:00"/);
  });

  test('card markdown ignores invalid scheduledFor without failing the card', () => {
    const markdown = `---
id: card-bad-schedule
title: Bad schedule
column: col-ready
position: 1000
scheduledFor: not-a-datetime
createdAt: 1719360000000
---

## Description

## Acceptance criteria

## Activity
`;
    const parsed = parseCard(markdown);
    assert.equal(parsed.card.scheduledFor, undefined);
    assert.ok(!serializeCard(parsed).includes('scheduledFor'));
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
