import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';

interface ActivityDraft {
  readonly initialValue: string;
  hasChanges(value: string): boolean;
  save(value: string): string;
  discard(): string;
}

interface BoardWebviewTestExports {
  createActivityDraft(activity: string | undefined): ActivityDraft;
}

// In Node, media/board.js returns its pure Activity draft helper before the
// browser-only webview bootstrap runs.
const { createActivityDraft } = require('../../../media/board.js') as BoardWebviewTestExports;

suite('card Activity editor draft', () => {
  test('loads complete existing Activity text and exposes a usable empty value', () => {
    const activity = '## Existing entry\n\n- **Markdown** stays editable\n- [x] STATUS: DONE';
    assert.equal(createActivityDraft(activity).initialValue, activity);
    assert.equal(createActivityDraft(undefined).initialValue, '');
  });

  test('saves multiline Markdown edits and supports removing all Activity text', () => {
    const draft = createActivityDraft('Original');
    const edited = '## Updated\r\n\r\n    kept indentation\r\n- kept list';

    assert.equal(draft.hasChanges(edited), true);
    assert.equal(draft.save(edited), '## Updated\n\n    kept indentation\n- kept list');
    assert.equal(draft.save('  \n  '), '');
  });

  test('discarding an unsaved Activity edit restores the original content', () => {
    const original = '### Existing entry\n\nSTATUS: DONE';
    const draft = createActivityDraft(original);
    const unsaved = 'Replaced locally but never saved';

    assert.equal(draft.hasChanges(unsaved), true);
    assert.equal(draft.discard(), original);
    assert.equal(draft.initialValue, original);
  });
});
