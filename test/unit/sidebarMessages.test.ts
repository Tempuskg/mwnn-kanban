import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { routeSidebarMessage, type SidebarActions, type SidebarCommand } from '../../src/sidebarMessages';
import { openProPortfolio, OPEN_PORTFOLIO_COMMAND } from '../../src/portfolioButton';

function createActions(): { readonly actions: SidebarActions; readonly ran: SidebarCommand[] } {
  const ran: SidebarCommand[] = [];
  return {
    ran,
    actions: {
      openBoard: () => ran.push('openBoard'),
      importPlan: () => ran.push('importPlan'),
      runAiLoop: () => ran.push('runAiLoop'),
      openPortfolio: () => ran.push('openPortfolio'),
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
    routeSidebarMessage({ type: 'runAiLoop' }, actions);

    assert.deepEqual(ran, ['openBoard', 'importPlan', 'runAiLoop']);
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
