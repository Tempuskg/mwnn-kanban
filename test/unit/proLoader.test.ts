import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import type * as vscode from 'vscode';
import {
  activateProFeatures,
  loadProFeatureRegistrar,
  type ProFeatureRegistrationContext,
} from '../../src/pro';

const TEST_MODULE_SPECIFIER = 'mwnn-kanban-pro-test';
const TEST_RESOLVED_PATH = 'C:/temp/mwnn-kanban-pro/index.js';

function createModuleNotFoundError(specifier: string): NodeJS.ErrnoException {
  const error = new Error(`Cannot find module '${specifier}'`) as NodeJS.ErrnoException;
  error.code = 'MODULE_NOT_FOUND';
  return error;
}

function createRegistrationContext(
  logs: string[],
  registrations: vscode.Disposable[] = [],
): ProFeatureRegistrationContext {
  return {
    extensionContext: {} as vscode.ExtensionContext,
    hasProLicense: async () => false,
    showUpgradePrompt: async () => undefined,
    log: (message) => {
      logs.push(message);
    },
    registerDisposable: (disposable) => {
      registrations.push(disposable);
    },
  };
}

suite('Pro feature loader', () => {
  test('returns not-found and logs when the optional package is absent', async () => {
    const logs: string[] = [];

    const result = await activateProFeatures(
      createRegistrationContext(logs),
      {
        moduleSpecifier: TEST_MODULE_SPECIFIER,
        resolveModule: () => {
          throw createModuleNotFoundError(TEST_MODULE_SPECIFIER);
        },
        requireModule: () => {
          throw new Error('requireModule should not be called');
        },
      },
    );

    assert.equal(result.kind, 'unavailable');
    if (result.kind === 'unavailable') {
      assert.equal(result.reason, 'not-found');
      assert.match(result.detail, /continuing with free features only/i);
    }
    assert.deepEqual(logs, [result.detail]);
  });

  test('returns invalid-module when the package has no registrar export', () => {
    const result = loadProFeatureRegistrar({
      moduleSpecifier: TEST_MODULE_SPECIFIER,
      resolveModule: () => TEST_RESOLVED_PATH,
      requireModule: () => ({ default: {} }),
    });

    assert.equal(result.kind, 'unavailable');
    if (result.kind === 'unavailable') {
      assert.equal(result.reason, 'invalid-module');
    }
  });

  test('returns load-failed when requiring the resolved package throws', () => {
    const result = loadProFeatureRegistrar({
      moduleSpecifier: TEST_MODULE_SPECIFIER,
      resolveModule: () => TEST_RESOLVED_PATH,
      requireModule: () => {
        throw new Error('broken dependency');
      },
    });

    assert.equal(result.kind, 'unavailable');
    if (result.kind === 'unavailable') {
      assert.equal(result.reason, 'load-failed');
      assert.match(result.detail, /broken dependency/);
    }
  });

  test('returns register-failed and logs when the registrar rejects', async () => {
    const logs: string[] = [];
    const result = await activateProFeatures(
      createRegistrationContext(logs),
      {
        moduleSpecifier: TEST_MODULE_SPECIFIER,
        resolveModule: () => TEST_RESOLVED_PATH,
        requireModule: () => ({
          registerProFeatures: async () => {
            throw new Error('registration failed');
          },
        }),
      },
    );

    assert.equal(result.kind, 'unavailable');
    if (result.kind === 'unavailable') {
      assert.equal(result.reason, 'register-failed');
      assert.match(result.detail, /registration failed/);
      assert.deepEqual(logs, [result.detail]);
    }
  });

  test('unwraps a default export and registers returned disposables', async () => {
    const logs: string[] = [];
    const registrations: vscode.Disposable[] = [];
    const disposable = { dispose: () => undefined } satisfies vscode.Disposable;

    const result = await activateProFeatures(
      createRegistrationContext(logs, registrations),
      {
        moduleSpecifier: TEST_MODULE_SPECIFIER,
        resolveModule: () => TEST_RESOLVED_PATH,
        requireModule: () => ({
          default: {
            registerProFeatures: async () => disposable,
          },
        }),
      },
    );

    assert.equal(result.kind, 'available');
    assert.deepEqual(registrations, [disposable]);
    assert.ok(logs.some((message) => message.includes('Loaded Pro features')));
  });
});
