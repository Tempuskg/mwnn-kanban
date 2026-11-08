import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { unownedBoardTabs } from '../../src/boardPanelTabs';

const boardType = 'mwnn-kanban.board';
const viewType = (tab: { type?: string }): string | undefined => tab.type;

suite('unowned restored board tabs', () => {
  test('finds lazy session tabs in any group without matching labels or other webviews', () => {
    const restored = { type: `mainThreadWebview-${boardType}` };
    const olderApi = { type: boardType };
    const unrelated = [{}, { type: 'markdown.preview' }, { type: `${boardType}.other` }];
    assert.deepEqual(unownedBoardTabs(false, [restored, ...unrelated, olderApi], viewType, boardType),
      [restored, olderApi]);
  });

  test('never closes a visible or hidden live panel on a repeated open', () => {
    const live = { type: boardType };
    assert.deepEqual(unownedBoardTabs(true, [live], viewType, boardType), []);
  });

  test('cleanup retains its pre-creation snapshot when a replacement tab arrives', () => {
    const restored = { type: boardType };
    const tabs = [restored];
    const stale = unownedBoardTabs(false, tabs, viewType, boardType);
    const replacement = { type: boardType };
    tabs.push(replacement);
    assert.deepEqual(stale, [restored]);
    assert.equal(stale.includes(replacement), false);
  });
});
