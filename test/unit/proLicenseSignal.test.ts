import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import type * as vscode from 'vscode';
import {
  hasProLicense,
  initializeProLicenseCommands,
  isProLicenseActive,
  onDidChangeProLicense,
  ENTER_PRO_LICENSE_KEY_COMMAND,
  PRO_LICENSE_CONTEXT_KEY,
  type LicenseStorageContext,
  type ProLicenseConfiguration,
  type ProUpgradeDeps,
} from '../../src/pro';
import { portfolioButtonMode } from '../../src/portfolioButton';

type CommandCallback = (...args: unknown[]) => unknown;

/**
 * A harness whose license validation and trial state are both driven from the
 * test, so the published `mwnn-kanban.hasProLicense` value can be flipped in
 * both directions.
 */
function createHarness(): {
  readonly deps: ProUpgradeDeps;
  readonly context: vscode.ExtensionContext;
  readonly commands: Map<string, CommandCallback>;
  readonly contextValues: unknown[];
  granted: boolean;
} {
  const commands = new Map<string, CommandCallback>();
  const secrets = new Map<string, string>();
  // Seed a long-expired trial start so the free trial never grants access and
  // the published value tracks the license key alone.
  const globalState = new Map<string, unknown>([['mwnn-kanban-pro.trialStartedAt', 0]]);
  const contextValues: unknown[] = [];
  const state = { granted: false };

  const configured: Readonly<Record<string, string>> = {
    'polar.organizationId': 'organization-id',
    'polar.apiBaseUrl': 'https://polar.test',
  };
  const configuration: ProLicenseConfiguration = {
    get<T>(section: string, defaultValue: T): T {
      const value = configured[section];
      return value === undefined ? defaultValue : (value as unknown as T);
    },
  };

  const licenseContext: LicenseStorageContext = {
    secrets: {
      get: async (key) => secrets.get(key),
      store: async (key, value) => {
        secrets.set(key, value);
      },
      delete: async (key) => {
        secrets.delete(key);
      },
    },
    globalState: {
      get: <T>(key: string): T | undefined => globalState.get(key) as T | undefined,
      update: async (key, value) => {
        if (value === undefined) {
          globalState.delete(key);
        } else {
          globalState.set(key, value);
        }
      },
    },
  };

  const deps: ProUpgradeDeps = {
    registerCommand: (command, callback) => {
      commands.set(command, callback);
      return { dispose: () => commands.delete(command) };
    },
    executeCommand: async (command, ...args) => {
      if (command === 'setContext' && args[0] === PRO_LICENSE_CONTEXT_KEY) {
        contextValues.push(args[1]);
      }
      return undefined;
    },
    getImplicitWorkspaceFolder: () => undefined,
    getConfiguration: () => configuration,
    showInputBox: async () => 'license-key',
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    openExternal: async () => true,
    parseUri: (value) => ({ toString: () => value }) as unknown as vscode.Uri,
    fetch: async () => new Response(
      JSON.stringify({ status: state.granted ? 'granted' : 'revoked' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
    // Far past any trial window, so trial state never masks the key's validity.
    now: () => Date.UTC(2999, 0, 1),
  };

  return {
    deps,
    context: licenseContext as unknown as vscode.ExtensionContext,
    commands,
    contextValues,
    get granted(): boolean {
      return state.granted;
    },
    set granted(value: boolean) {
      state.granted = value;
    },
  };
}

suite('Pro license signal behind the sidebar Portfolio button', () => {
  test('the sync signal and the context key never disagree, and changes notify listeners', async () => {
    const harness = createHarness();
    const notified: boolean[] = [];
    const subscription = onDidChangeProLicense((licensed) => notified.push(licensed));

    initializeProLicenseCommands(harness.context, harness.deps);

    // No key and an expired trial: unlicensed, so the button is hidden.
    assert.equal(await hasProLicense(), false);
    assert.equal(isProLicenseActive(), false);
    assert.equal(portfolioButtonMode({ licensed: isProLicenseActive() }), 'hidden');
    assert.equal(harness.contextValues.at(-1), false);
    assert.deepEqual(notified, []);

    // Entering a valid key publishes `true` and pushes one change notification,
    // which is what makes the button appear in an already-open sidebar.
    harness.granted = true;
    await harness.commands.get(ENTER_PRO_LICENSE_KEY_COMMAND)?.();

    assert.equal(isProLicenseActive(), true);
    assert.equal(portfolioButtonMode({ licensed: isProLicenseActive() }), 'visible');
    assert.equal(harness.contextValues.at(-1), true);
    assert.deepEqual(notified, [true]);

    // Re-checking an unchanged license does not spam listeners.
    await hasProLicense();
    assert.deepEqual(notified, [true]);

    subscription.dispose();
  });

  test('a disposed listener stops receiving license changes', async () => {
    const harness = createHarness();
    const notified: boolean[] = [];
    const subscription = onDidChangeProLicense((licensed) => notified.push(licensed));
    subscription.dispose();

    initializeProLicenseCommands(harness.context, harness.deps);
    harness.granted = true;
    await harness.commands.get(ENTER_PRO_LICENSE_KEY_COMMAND)?.();

    assert.equal(isProLicenseActive(), true);
    assert.deepEqual(notified, []);
  });
});
