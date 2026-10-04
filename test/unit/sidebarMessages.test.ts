import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  aiLoopControls,
  createSidebarAiLoopStateMessage,
  routeSidebarMessage,
  type SidebarActions,
  type SidebarCommand,
} from '../../src/sidebarMessages';
import { openProPortfolio, OPEN_PORTFOLIO_COMMAND } from '../../src/portfolioButton';

function createActions(): { readonly actions: SidebarActions; readonly ran: SidebarCommand[] } {
  const ran: SidebarCommand[] = [];
  return {
    ran,
    actions: {
      openBoard: () => ran.push('openBoard'),
      importPlan: () => ran.push('importPlan'),
      playAiLoop: () => ran.push('playAiLoop'),
      pauseAiLoop: () => ran.push('pauseAiLoop'),
      stopAiLoop: () => ran.push('stopAiLoop'),
      openPortfolio: () => ran.push('openPortfolio'),
      sidebarReady: () => ran.push('sidebarReady'),
    },
  };
}

suite('sidebar message routing', () => {
  test('an openPortfolio message runs only the Portfolio action', () => {
    const { actions, ran } = createActions();

    const command = routeSidebarMessage({ type: 'openPortfolio' }, actions);

    assert.equal(command, 'openPortfolio');
    assert.deepEqual(ran, ['openPortfolio']);
  });

  test('the existing button messages still route to their own actions', () => {
    const { actions, ran } = createActions();

    routeSidebarMessage({ type: 'openBoard' }, actions);
    routeSidebarMessage({ type: 'importPlan' }, actions);

    assert.deepEqual(ran, ['openBoard', 'importPlan']);
  });

  test('Play, Pause, Stop, and ready messages route to their own actions', () => {
    const { actions, ran } = createActions();

    routeSidebarMessage({ type: 'playAiLoop' }, actions);
    routeSidebarMessage({ type: 'pauseAiLoop' }, actions);
    routeSidebarMessage({ type: 'stopAiLoop' }, actions);
    routeSidebarMessage({ type: 'sidebarReady' }, actions);

    assert.deepEqual(ran, ['playAiLoop', 'pauseAiLoop', 'stopAiLoop', 'sidebarReady']);
  });

  test('the retired runAiLoop message and host-to-sidebar messages run nothing', () => {
    const { actions, ran } = createActions();

    for (const message of [{ type: 'runAiLoop' }, { type: 'aiLoopState' }, { type: 'boardButton' }]) {
      assert.equal(routeSidebarMessage(message, actions), undefined);
    }

    assert.deepEqual(ran, []);
  });

  test('unknown and malformed messages run nothing', () => {
    const { actions, ran } = createActions();

    for (const message of [undefined, null, 'openPortfolio', {}, { type: 'nope' }]) {
      assert.equal(routeSidebarMessage(message, actions), undefined);
    }

    assert.deepEqual(ran, []);
  });

  test('the Portfolio button message ends up executing the Pro Portfolio command', async () => {
    const executed: string[] = [];
    const openPortfolio = (): void => {
      void openProPortfolio({
        executeCommand: (command) => {
          executed.push(command);
          return Promise.resolve(undefined);
        },
        showInformationMessage: () => Promise.resolve(undefined),
      });
    };
    const { actions } = createActions();

    routeSidebarMessage({ type: 'openPortfolio' }, { ...actions, openPortfolio });
    await Promise.resolve();

    assert.deepEqual(executed, [OPEN_PORTFOLIO_COMMAND]);
  });
});

suite('sidebar AI loop controls', () => {
  test('idle enables only Play', () => {
    assert.deepEqual(aiLoopControls('idle', true), { play: true, pause: false, stop: false });
  });

  test('running enables Pause and Stop', () => {
    assert.deepEqual(aiLoopControls('running', true), { play: false, pause: true, stop: true });
  });

  test('paused enables Play (resume) and Stop', () => {
    assert.deepEqual(aiLoopControls('paused', true), { play: true, pause: false, stop: true });
  });

  test('with Run With AI disabled nothing is usable', () => {
    for (const state of ['idle', 'running', 'paused'] as const) {
      assert.deepEqual(aiLoopControls(state, false), { play: false, pause: false, stop: false });
    }
  });

  test('the loop-state message carries the state and its derived controls', () => {
    assert.deepEqual(createSidebarAiLoopStateMessage('paused', true), {
      type: 'aiLoopState',
      state: 'paused',
      enabled: true,
      controls: { play: true, pause: false, stop: true },
    });
  });
});
