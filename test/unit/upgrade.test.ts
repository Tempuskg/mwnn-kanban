import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import type * as vscode from 'vscode';
import {
  CLEAR_PRO_LICENSE_KEY_COMMAND,
  ENTER_PRO_LICENSE_KEY_COMMAND,
  hasProLicense,
  initializeProLicenseCommands,
  PRO_ACTIVATE_PROMPT_LABEL,
  PRO_LICENSE_CONTEXT_KEY,
  PRO_PURCHASE_URL,
  PRO_UPGRADE_PROMPT_LABEL,
  SHOW_PRO_LICENSE_STATUS_COMMAND,
  showUpgradePrompt,
  UPGRADE_TO_PRO_COMMAND,
  type LicenseStorageContext,
  type ProLicenseConfiguration,
  type ProUpgradeDeps,
} from '../../src/pro';

const LICENSE_KEY = 'license-key';
const SECRET_STORAGE_KEY = 'mwnn-kanban-pro.licenseKey';
const CACHE_STORAGE_KEY = 'mwnn-kanban-pro.licenseCache';

type CommandCallback = (...args: unknown[]) => unknown;

interface InformationMessage {
  readonly message: string;
  readonly items: readonly string[];
}

interface ContextUpdate {
  readonly key: string;
  readonly value: unknown;
}

interface Harness {
  readonly context: vscode.ExtensionContext;
  readonly deps: ProUpgradeDeps;
  readonly commands: Map<string, CommandCallback>;
  readonly secrets: Map<string, string>;
  readonly globalState: Map<string, unknown>;
  readonly contextUpdates: ContextUpdate[];
  readonly informationMessages: InformationMessage[];
  readonly openedUrls: string[];
  readonly queueInformationSelection: (selection: string | undefined) => void;
  readonly invokeCommand: (command: string) => Promise<void>;
}

function createConfiguration(): ProLicenseConfiguration {
  const values: Readonly<Record<string, string>> = {
    'polar.organizationId': 'organization-id',
    'polar.apiBaseUrl': 'https://polar.test',
  };

  return {
    get<T>(section: string, defaultValue: T): T {
      const value = values[section];
      return value === undefined ? defaultValue : value as unknown as T;
    },
  };
}

function createHarness(): Harness {
  const commands = new Map<string, CommandCallback>();
  const secrets = new Map<string, string>();
  const globalState = new Map<string, unknown>();
  const contextUpdates: ContextUpdate[] = [];
  const informationMessages: InformationMessage[] = [];
  const informationSelections: Array<string | undefined> = [];
  const openedUrls: string[] = [];

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
      if (command === 'setContext') {
        contextUpdates.push({
          key: String(args[0]),
          value: args[1],
        });
        return undefined;
      }

      const callback = commands.get(command);
      return callback ? callback(...args) : undefined;
    },
    getImplicitWorkspaceFolder: () => undefined,
    getConfiguration: () => createConfiguration(),
    showInputBox: async () => LICENSE_KEY,
    showInformationMessage: async (message, ...items) => {
      informationMessages.push({ message, items });
      return items.length > 0 ? informationSelections.shift() : undefined;
    },
    showWarningMessage: async () => 'Clear',
    showErrorMessage: async () => undefined,
    openExternal: async (target) => {
      openedUrls.push(target.toString());
      return true;
    },
    parseUri: (value) => ({
      toString: () => value,
    }) as unknown as vscode.Uri,
    fetch: async () => new Response(JSON.stringify({ status: 'granted' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  };

  return {
    context: licenseContext as unknown as vscode.ExtensionContext,
    deps,
    commands,
    secrets,
    globalState,
    contextUpdates,
    informationMessages,
    openedUrls,
    queueInformationSelection: (selection) => {
      informationSelections.push(selection);
    },
    invokeCommand: async (command) => {
      const callback = commands.get(command);
      if (!callback) {
        throw new Error(`Command not registered: ${command}`);
      }
      await callback();
    },
  };
}

suite('Pro upgrade commands', () => {
  test('registers all commands and round-trips the license secret and context key', async () => {
    const harness = createHarness();
    const disposables = initializeProLicenseCommands(harness.context, harness.deps);
    await hasProLicense();

    assert.equal(disposables.length, 4);
    assert.deepEqual([...harness.commands.keys()].sort(), [
      CLEAR_PRO_LICENSE_KEY_COMMAND,
      ENTER_PRO_LICENSE_KEY_COMMAND,
      SHOW_PRO_LICENSE_STATUS_COMMAND,
      UPGRADE_TO_PRO_COMMAND,
    ].sort());
    assert.deepEqual(harness.contextUpdates.at(-1), {
      key: PRO_LICENSE_CONTEXT_KEY,
      value: true,
    });

    await harness.invokeCommand(ENTER_PRO_LICENSE_KEY_COMMAND);
    assert.equal(harness.secrets.get(SECRET_STORAGE_KEY), LICENSE_KEY);
    assert.ok(harness.globalState.has(CACHE_STORAGE_KEY));
    assert.deepEqual(harness.contextUpdates.at(-1), {
      key: PRO_LICENSE_CONTEXT_KEY,
      value: true,
    });

    await harness.invokeCommand(SHOW_PRO_LICENSE_STATUS_COMMAND);
    assert.equal(harness.secrets.get(SECRET_STORAGE_KEY), LICENSE_KEY);
    assert.ok(harness.informationMessages.some(({ message }) =>
      message === 'MWNN Kanban Pro is active.'));
    assert.deepEqual(harness.contextUpdates.at(-1), {
      key: PRO_LICENSE_CONTEXT_KEY,
      value: true,
    });

    await harness.invokeCommand(CLEAR_PRO_LICENSE_KEY_COMMAND);
    assert.equal(harness.secrets.has(SECRET_STORAGE_KEY), false);
    assert.equal(harness.globalState.has(CACHE_STORAGE_KEY), false);
    assert.deepEqual(harness.contextUpdates.at(-1), {
      key: PRO_LICENSE_CONTEXT_KEY,
      value: true,
    });

    await harness.invokeCommand(UPGRADE_TO_PRO_COMMAND);
    assert.deepEqual(harness.openedUrls, [PRO_PURCHASE_URL]);
    assert.match(PRO_PURCHASE_URL, /^https:\/\/mwnnkanban\.dev\/#pro$/);
  });

  test('upgrade prompt activates a key and publishes the licensed context', async () => {
    const harness = createHarness();
    initializeProLicenseCommands(harness.context, harness.deps);
    await hasProLicense();
    harness.queueInformationSelection(PRO_ACTIVATE_PROMPT_LABEL);

    await showUpgradePrompt();

    assert.equal(harness.secrets.get(SECRET_STORAGE_KEY), LICENSE_KEY);
    assert.deepEqual(harness.contextUpdates.at(-1), {
      key: PRO_LICENSE_CONTEXT_KEY,
      value: true,
    });
  });

  test('upgrade prompt opens the landing purchase URL', async () => {
    const harness = createHarness();
    initializeProLicenseCommands(harness.context, harness.deps);
    await hasProLicense();
    harness.queueInformationSelection(PRO_UPGRADE_PROMPT_LABEL);

    await showUpgradePrompt();

    assert.deepEqual(harness.openedUrls, [PRO_PURCHASE_URL]);
  });
});
