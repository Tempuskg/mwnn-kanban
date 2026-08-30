import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  openProPortfolio,
  portfolioButtonMode,
  OPEN_PORTFOLIO_COMMAND,
  PORTFOLIO_BUTTON_LABEL,
  PORTFOLIO_BUTTON_TOOLTIP,
  PORTFOLIO_UNAVAILABLE_MESSAGE,
} from '../../src/portfolioButton';

suite('sidebar Portfolio button visibility', () => {
  test('shows the button when a Pro license or live trial is active', () => {
    assert.equal(portfolioButtonMode({ licensed: true }), 'visible');
  });

  test('hides the button when no valid license is active', () => {
    assert.equal(portfolioButtonMode({ licensed: false }), 'hidden');
  });

  test('the label and tooltip name the Pro Portfolio dashboard', () => {
    assert.equal(PORTFOLIO_BUTTON_LABEL, 'Portfolio');
    assert.match(PORTFOLIO_BUTTON_TOOLTIP, /Pro Portfolio dashboard/);
  });

  test('clearing a license flips a shown button back to hidden', () => {
    const licensed = portfolioButtonMode({ licensed: true });
    const cleared = portfolioButtonMode({ licensed: false });

    assert.deepEqual([licensed, cleared], ['visible', 'hidden']);
  });
});

suite('sidebar Portfolio button routing', () => {
  test('executes the Pro Portfolio command', async () => {
    const executed: string[] = [];
    const messages: string[] = [];

    await openProPortfolio({
      executeCommand: (command) => {
        executed.push(command);
        return Promise.resolve(undefined);
      },
      showInformationMessage: (message) => {
        messages.push(message);
        return Promise.resolve(undefined);
      },
    });

    assert.deepEqual(executed, [OPEN_PORTFOLIO_COMMAND]);
    assert.deepEqual(messages, []);
  });

  test('reports a user-visible message when the Pro command is not registered', async () => {
    const messages: string[] = [];

    await openProPortfolio({
      executeCommand: () =>
        Promise.reject(new Error(`command '${OPEN_PORTFOLIO_COMMAND}' not found`)),
      showInformationMessage: (message) => {
        messages.push(message);
        return Promise.resolve(undefined);
      },
    });

    assert.deepEqual(messages, [PORTFOLIO_UNAVAILABLE_MESSAGE]);
  });

  test('a missing Pro module never surfaces as an unhandled rejection', async () => {
    await assert.doesNotReject(
      openProPortfolio({
        executeCommand: () => Promise.reject(new Error('boom')),
        showInformationMessage: () => Promise.resolve(undefined),
      }),
    );
  });
});
