import * as assert from 'node:assert/strict';
import Module from 'node:module';
import { test } from 'node:test';
import type { BoardPanelDeps } from '../../src/boardPanel';

class WebviewInput {
  constructor(readonly viewType: string) {}
}

class Events {
  readonly event = (): { dispose(): void } => ({ dispose() {} });
  fire(): void {}
}

test('real BoardPanel wiring removes lazy restored tabs and retains replacement during delayed cleanup', async () => {
  type Tab = { input: unknown };
  const groups: { tabs: Tab[]; viewColumn: number }[] = [{ tabs: [], viewColumn: 1 }, { tabs: [], viewColumn: 2 }];
  const panels: ReturnType<typeof createPanel>[] = [];
  const pendingCloses: (() => void)[] = [];
  function createPanel(column: number) {
    const tab = { input: new WebviewInput('mainThreadWebview-mwnn-kanban.board') };
    const group = groups.find((candidate) => candidate.viewColumn === column);
    assert.ok(group);
    group.tabs.push(tab);
    const disposeListeners: (() => void)[] = [];
    const panel = {
      active: true,
      viewColumn: column,
      reveals: 0,
      disposed: false,
      webview: {
        html: '', options: {}, cspSource: 'test:',
        asWebviewUri: (uri: unknown) => uri,
        onDidReceiveMessage: () => ({ dispose() {} }),
        postMessage: async () => true,
      },
      onDidDispose: (listener: () => void) => { disposeListeners.push(listener); return { dispose() {} }; },
      onDidChangeViewState: () => ({ dispose() {} }),
      reveal: () => { panel.reveals += 1; },
      dispose: () => {
        panel.disposed = true;
        group.tabs = group.tabs.filter((candidate) => candidate !== tab);
        disposeListeners.forEach((listener) => listener());
      },
    };
    return panel;
  }
  const host = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const original = host._load;
  const fakeVscode = {
    EventEmitter: Events,
    TabInputWebview: WebviewInput,
    Uri: { joinPath: (...parts: unknown[]) => parts.join('/') },
    window: {
      tabGroups: {
        all: groups, activeTabGroup: groups[1],
        close: (tabs: Tab[]) => new Promise<boolean>((resolve) => {
          pendingCloses.push(() => {
            groups.forEach((group) => { group.tabs = group.tabs.filter((tab) => !tabs.includes(tab)); });
            resolve(true);
          });
        }),
      },
      createWebviewPanel: (_type: string, _title: string, column: number) => {
        const panel = createPanel(column);
        panels.push(panel);
        return panel;
      },
    },
  };
  host._load = (request, parent, isMain) => request === 'vscode' ? fakeVscode : original.call(host, request, parent, isMain);
  let BoardPanel: typeof import('../../src/boardPanel').BoardPanel;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BoardPanel = (require('../../src/boardPanel') as typeof import('../../src/boardPanel')).BoardPanel;
  } finally {
    host._load = original;
  }
  const deps = { extensionUri: 'test:' } as unknown as BoardPanelDeps;
  const oldTab = { input: new WebviewInput('mainThreadWebview-mwnn-kanban.board') };
  const unrelated = { input: {} };
  groups[0]!.tabs.push(oldTab, unrelated);
  const board = BoardPanel.show(deps);
  assert.equal(BoardPanel.show(deps), board);
  assert.equal(panels.length, 1);
  assert.equal(pendingCloses.length, 1);
  const live = panels[0]!;
  live.active = false; // Hidden, and opens now originate in another group.
  fakeVscode.window.tabGroups.activeTabGroup = groups[0];
  assert.equal(BoardPanel.show(deps), board);
  assert.equal(live.viewColumn, 2);
  pendingCloses.shift()!();
  await Promise.resolve();
  assert.equal(groups.flatMap((group) => group.tabs).length, 2);
  assert.equal(groups[0]!.tabs[0], unrelated);
  assert.equal(live.disposed, false);

  const duplicate = createPanel(1);
  panels.push(duplicate);
  assert.equal(BoardPanel.restore(duplicate as unknown as import('vscode').WebviewPanel, deps), board);
  assert.equal(duplicate.disposed, true);
  assert.equal(live.disposed, false);
  live.dispose();
  const replacement = BoardPanel.show(deps);
  assert.notEqual(replacement, board);
  assert.equal(BoardPanel.show(deps), replacement);
  assert.equal(panels.length, 3);
  panels[2]!.dispose();
  assert.equal(BoardPanel.status().open, false);
});
