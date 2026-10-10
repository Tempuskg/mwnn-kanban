import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { createBoardStore, type BoardStoreDeps, type FileSystemLike } from '../../src/boardStore';
import { parseCard, serializeCard, type CardDocument } from '../../src/serialization';
import { isInterviewCard, isWebviewToHostMessage, type BoardState } from '../../src/types';

function cardText(frontmatter: readonly string[]): string {
  return [
    '---',
    'id: card-1',
    'title: Interview me',
    'column: col-1',
    'position: 1000',
    ...frontmatter,
    'createdAt: 1',
    '---',
    '',
    '## Description',
    'Facts to gather.',
    '',
    '## Acceptance criteria',
    '',
    '## Activity',
    '- 2026-10-09 Alice: started',
    '',
  ].join('\n');
}

function boardWith(card: BoardState['columns'][number]['cards'][number]): BoardState {
  return { version: 2, columns: [{ id: 'col-1', title: 'Ready', cards: [card] }] };
}

function firstCard(state: BoardState): BoardState['columns'][number]['cards'][number] {
  const card = state.columns[0]?.cards[0];
  assert.ok(card);
  return card;
}

function createFakeFileSystem(): FileSystemLike & { files: Map<string, string> } {
  const files = new Map<string, string>();
  const normalize = (target: string): string =>
    target.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const isDirectory = (target: string): boolean =>
    target === '' || target === '.' || [...files.keys()].some((key) => key.startsWith(`${target}/`));
  return {
    files,
    async exists(target) {
      const key = normalize(target);
      return files.has(key) || isDirectory(key);
    },
    async readFile(target) {
      const value = files.get(normalize(target));
      if (value === undefined) {
        throw new Error(`Missing file: ${target}`);
      }
      return value;
    },
    async writeFile(target, content) {
      files.set(normalize(target), content);
    },
    async deleteFile(target) {
      files.delete(normalize(target));
    },
    async readDirectory(target) {
      const prefix = `${normalize(target)}/`;
      const entries = new Set<string>();
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          entries.add(key.slice(prefix.length).split('/')[0]!);
        }
      }
      return [...entries];
    },
    async createDirectory() {
      // Directories are implied by the files written under them.
    },
  };
}

suite('AI-guided interview eligibility', () => {
  test('every Human card is an interview card; AI and unassigned cards never are', () => {
    assert.equal(isInterviewCard({ assignee: { kind: 'human' } }), true);
    assert.equal(isInterviewCard({ assignee: { kind: 'human', name: 'Alice' } }), true);
    assert.equal(isInterviewCard({ assignee: { kind: 'ai' } }), false);
    assert.equal(isInterviewCard({}), false);
  });

  test('serialization never writes an interview key', () => {
    const document: CardDocument = {
      columnId: 'col-1',
      position: 1000,
      card: {
        id: 'card-1',
        title: 'Interview me',
        createdAt: 1,
        description: 'Facts to gather.',
        activity: '- 2026-10-09 Alice: started',
        assignee: { kind: 'human', name: 'Alice' },
        dependsOn: ['card-0'],
        preferredModels: { codex: 'gpt-5-codex' },
        thinkingLevels: { codex: 'high' },
      },
    };
    const text = serializeCard(document);
    assert.equal(text.includes('interview'), false);
    assert.deepEqual(parseCard(text), document);
  });

  test('a legacy interview key loads without error and is dropped on the next write', () => {
    for (const frontmatter of [
      ['assignee: { kind: human, name: Alice }', 'interview: true'],
      ['assignee: { kind: ai }', 'interview: true'],
      ['interview: true'],
      ['assignee: { kind: human }', 'interview: false'],
      ['assignee: { kind: human }', 'interview: '],
    ]) {
      const parsed = parseCard(cardText(frontmatter));
      assert.equal('interview' in parsed.card, false, frontmatter.join(', '));
      assert.equal(parsed.card.activity, '- 2026-10-09 Alice: started');
      assert.equal(serializeCard(parsed).includes('interview'), false);
    }
  });

  test('the protocol no longer accepts setInterview messages', () => {
    assert.equal(isWebviewToHostMessage({ type: 'setInterview', cardId: 'card-1', interview: true }), false);
    assert.equal(isWebviewToHostMessage({ type: 'startCardInterview', cardId: 'card-1' }), true);
  });

  test('the store rewrites a legacy card without the key and the README omits it', async () => {
    const fileSystem = createFakeFileSystem();
    const deps: BoardStoreDeps = {
      fileSystem,
      boardFolder: '.mwnn',
      defaultColumns: ['Ready'],
      defaultReadyReverseWip: 3,
    };
    const store = await createBoardStore(deps);
    const columnId = store.getState().columns[0]!.id;
    await store.addCard(columnId, 'Interview me');
    const cardId = store.getState().columns[0]!.cards[0]!.id;
    const filePath = `.mwnn/cards/${cardId}.md`;

    const original = fileSystem.files.get(filePath) ?? '';
    fileSystem.files.set(
      filePath,
      original.replace(/\ncreatedAt:/, '\nassignee: { kind: human }\ninterview: true\ncreatedAt:'),
    );
    assert.ok((fileSystem.files.get(filePath) ?? '').includes('interview: true'));

    const reloaded = await store.reload();
    const card = reloaded.columns[0]!.cards[0]!;
    assert.equal('interview' in card, false);
    assert.equal(isInterviewCard(card), true);

    await store.editCard(cardId, 'Interview me again');
    const rewritten = fileSystem.files.get(filePath) ?? '';
    assert.ok(rewritten.includes('title: Interview me again'));
    assert.equal(rewritten.includes('interview:'), false);

    const readme = fileSystem.files.get('.mwnn/README.md') ?? '';
    assert.ok(readme.length > 0);
    assert.equal(readme.includes('`interview`'), false);
  });
});
