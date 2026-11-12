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
const TRIAL_STORAGE_KEY = 'mwnn-kanban-pro.trialStartedAt';
const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

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

function createHarness(options: {
  readonly now?: () => number;
  readonly scheduleLicenseRecheck?: ProUpgradeDeps['scheduleLicenseRecheck'];
} = {}): Harness {
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
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.scheduleLicenseRecheck !== undefined
      ? { scheduleLicenseRecheck: options.scheduleLicenseRecheck }
      : {}),
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
  test('activation without a key or trial does not write trialStartedAt', async () => {
    const harness = createHarness();
    const disposables = initializeProLicenseCommands(harness.context, harness.deps);
    // Match activation: publish existing license state only — do not mint a trial.
    assert.equal(await hasProLicense(), false);

    assert.equal(disposables.length, 5);
    assert.equal(harness.globalState.has(TRIAL_STORAGE_KEY), false);
    assert.deepEqual(harness.contextUpdates[0], {
      key: PRO_LICENSE_CONTEXT_KEY,
      value: false,
    });
    assert.deepEqual(harness.contextUpdates.at(-1), {
      key: PRO_LICENSE_CONTEXT_KEY,
      value: false,
    });
  });

  test('the first Pro feature open starts the 14-day trial and publishes licensed', async () => {
    let currentTime = 5_000;
    const harness = createHarness({ now: () => currentTime });
    initializeProLicenseCommands(harness.context, harness.deps);
    assert.equal(await hasProLicense(), false);
    assert.equal(harness.globalState.has(TRIAL_STORAGE_KEY), false);

    // Gated Pro commands pass startTrialIfMissing when the feature opens.
    assert.equal(await hasProLicense(undefined, { startTrialIfMissing: true }), true);
    assert.equal(harness.globalState.get(TRIAL_STORAGE_KEY), 5_000);
    assert.deepEqual(harness.contextUpdates.at(-1), {
      key: PRO_LICENSE_CONTEXT_KEY,
      value: true,
    });
  });

  test('a stored trial start is never replaced after clear or a later gated open', async () => {
    let currentTime = 1_000;
    const harness = createHarness({ now: () => currentTime });
    initializeProLicenseCommands(harness.context, harness.deps);

    assert.equal(await hasProLicense(undefined, { startTrialIfMissing: true }), true);
    assert.equal(harness.globalState.get(TRIAL_STORAGE_KEY), 1_000);

    await harness.invokeCommand(ENTER_PRO_LICENSE_KEY_COMMAND);
    await harness.invokeCommand(CLEAR_PRO_LICENSE_KEY_COMMAND);
    assert.equal(harness.globalState.get(TRIAL_STORAGE_KEY), 1_000);
    assert.equal(await hasProLicense(), true);

    currentTime += TRIAL_DURATION_MS;
    assert.equal(await hasProLicense(undefined, { startTrialIfMissing: true }), false);
    assert.equal(harness.globalState.get(TRIAL_STORAGE_KEY), 1_000);
  });

  test('a trial that lapses mid-session publishes false on the next periodic re-check', async () => {
    const startedAt = 1_000;
    let currentTime = startedAt + 60_000;
    let recheck: (() => void) | undefined;
    let recheckDisposed = false;
    const harness = createHarness({
      now: () => currentTime,
      scheduleLicenseRecheck: (callback) => {
        recheck = callback;
        return { dispose: () => { recheckDisposed = true; } };
      },
    });
    harness.globalState.set(TRIAL_STORAGE_KEY, startedAt);
    const disposables = initializeProLicenseCommands(harness.context, harness.deps);
    assert.equal(await hasProLicense(), true);
    assert.deepEqual(harness.contextUpdates.at(-1), { key: PRO_LICENSE_CONTEXT_KEY, value: true });

    // No user action happens; only the clock moves past the trial window.
    currentTime = startedAt + TRIAL_DURATION_MS;
    assert.ok(recheck);
    recheck();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(harness.contextUpdates.at(-1), { key: PRO_LICENSE_CONTEXT_KEY, value: false });
    assert.equal(harness.globalState.get(TRIAL_STORAGE_KEY), startedAt);

    for (const disposable of disposables) {
      disposable.dispose();
    }
    assert.equal(recheckDisposed, true);
  });

  test('a license check that throws publishes false instead of leaving the key set', async () => {
    const harness = createHarness();
    initializeProLicenseCommands(harness.context, harness.deps);
    assert.equal(await hasProLicense(undefined, { startTrialIfMissing: true }), true);
    assert.deepEqual(harness.contextUpdates.at(-1), { key: PRO_LICENSE_CONTEXT_KEY, value: true });

    (harness.context as unknown as { secrets: LicenseStorageContext['secrets'] }).secrets = {
      get: async () => {
        throw new Error('secret storage unavailable');
      },
      store: async () => undefined,
      delete: async () => undefined,
    };

    assert.equal(await hasProLicense(), false);
    assert.deepEqual(harness.contextUpdates.at(-1), { key: PRO_LICENSE_CONTEXT_KEY, value: false });
  });

  test('a slow stale check cannot overwrite a newer published result', async () => {
    const harness = createHarness();
    initializeProLicenseCommands(harness.context, harness.deps);
    assert.equal(await hasProLicense(), false);

    let releaseSlow: (() => void) | undefined;
    const realGet = harness.context.secrets.get.bind(harness.context.secrets);
    let calls = 0;
    (harness.context as unknown as { secrets: LicenseStorageContext['secrets'] }).secrets = {
      ...harness.context.secrets,
      get: async (key) => {
        calls += 1;
        if (calls === 1) {
          await new Promise<void>((resolve) => { releaseSlow = resolve; });
          return LICENSE_KEY;
        }
        return realGet(key);
      },
    };

    const stale = hasProLicense();
    assert.equal(await hasProLicense(), false);
    releaseSlow?.();
    assert.equal(await stale, true);
    assert.deepEqual(harness.contextUpdates.at(-1), { key: PRO_LICENSE_CONTEXT_KEY, value: false });
  });

  test('existing trial starts from earlier releases are honoured unchanged', async () => {
    const startedAt = 1_000;
    let currentTime = startedAt + 60_000;
    const harness = createHarness({ now: () => currentTime });
    harness.globalState.set(TRIAL_STORAGE_KEY, startedAt);
    initializeProLicenseCommands(harness.context, harness.deps);

    assert.equal(await hasProLicense(), true);
    assert.equal(harness.globalState.get(TRIAL_STORAGE_KEY), startedAt);
    assert.equal(await hasProLicense(undefined, { startTrialIfMissing: true }), true);
    assert.equal(harness.globalState.get(TRIAL_STORAGE_KEY), startedAt);
  });

  test('registers all commands and round-trips the license secret and context key', async () => {
    const harness = createHarness();
    const disposables = initializeProLicenseCommands(harness.context, harness.deps);
    assert.equal(await hasProLicense(undefined, { startTrialIfMissing: true }), true);

    // Four commands plus the periodic license re-check.
    assert.equal(disposables.length, 5);
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
    // Trial from the feature-open seed remains; clearing a key must not drop it.
    assert.deepEqual(harness.contextUpdates.at(-1), {
      key: PRO_LICENSE_CONTEXT_KEY,
      value: true,
    });

    await harness.invokeCommand(UPGRADE_TO_PRO_COMMAND);
    assert.deepEqual(harness.openedUrls, [PRO_PURCHASE_URL]);
    assert.match(PRO_PURCHASE_URL, /^https:\/\/mwnnkanban\.dev\/#purchase$/);
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
