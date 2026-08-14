import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  createProLicenseManager,
  type LicenseStorageContext,
  type ProLicenseConfiguration,
} from '../../src/pro';

const LICENSE_KEY = 'license-key';
const ORGANIZATION_ID = 'organization-id';
const BENEFIT_ID = 'benefit-id';
const OTHER_BENEFIT_ID = 'other-benefit-id';
const SECRET_STORAGE_KEY = 'mwnn-kanban-pro.licenseKey';
const CACHE_STORAGE_KEY = 'mwnn-kanban-pro.licenseCache';
const TRIAL_STORAGE_KEY = 'mwnn-kanban-pro.trialStartedAt';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

interface Harness {
  readonly context: LicenseStorageContext;
  readonly secrets: Map<string, string>;
  readonly globalState: Map<string, unknown>;
}

function createHarness(): Harness {
  const secrets = new Map<string, string>();
  const globalState = new Map<string, unknown>();

  return {
    secrets,
    globalState,
    context: {
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
    },
  };
}

function createConfiguration(
  overrides: Readonly<Record<string, string>> = {},
): ProLicenseConfiguration {
  const values: Readonly<Record<string, string>> = {
    'polar.organizationId': ORGANIZATION_ID,
    'polar.apiBaseUrl': 'https://sandbox.polar.test/',
    ...overrides,
  };

  return {
    get<T>(section: string, defaultValue: T): T {
      const value = values[section];
      return value === undefined ? defaultValue : value as unknown as T;
    },
  };
}

function createJsonFetch(
  responses: readonly unknown[],
  requests: CapturedRequest[] = [],
): typeof globalThis.fetch {
  let responseIndex = 0;
  const fetcher = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const response = responses[responseIndex];
    responseIndex += 1;
    requests.push({
      url: typeof input === 'string' ? input : input.toString(),
      init,
    });

    if (response instanceof Error) {
      throw response;
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return fetcher as typeof globalThis.fetch;
}

function seedLicenseKey(harness: Harness): void {
  harness.secrets.set(SECRET_STORAGE_KEY, LICENSE_KEY);
}

suite('Pro license manager', () => {
  test('starts a local trial without a key and expires at the 14-day boundary', async () => {
    const harness = createHarness();
    let currentTime = 1_000;
    const manager = createProLicenseManager({
      context: harness.context,
      now: () => currentTime,
    });

    assert.equal(await manager.hasProLicense(), true);
    assert.equal(harness.globalState.get(TRIAL_STORAGE_KEY), 1_000);

    currentTime += TRIAL_DURATION_MS - 1;
    assert.equal(await manager.hasProLicense(), true);

    currentTime += 1;
    assert.equal(await manager.hasProLicense(), false);
    assert.equal(harness.globalState.get(TRIAL_STORAGE_KEY), 1_000);
  });

  test('validates any granted benefit when no benefit id is configured', async () => {
    const harness = createHarness();
    const requests: CapturedRequest[] = [];
    const manager = createProLicenseManager({
      context: harness.context,
      fetch: createJsonFetch([{ status: 'granted' }], requests),
      getConfiguration: () => createConfiguration(),
      showInputBox: async () => LICENSE_KEY,
    });

    assert.equal(await manager.promptEnterKey(), true);
    assert.equal(harness.secrets.get(SECRET_STORAGE_KEY), LICENSE_KEY);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0]?.url,
      'https://sandbox.polar.test/v1/customer-portal/license-keys/validate',
    );
    assert.equal(requests[0]?.init?.method, 'POST');
    assert.equal(requests[0]?.init?.headers instanceof Headers, false);
    assert.deepEqual(requests[0]?.init?.headers, { 'Content-Type': 'application/json' });
    assert.equal(typeof requests[0]?.init?.body, 'string');
    assert.deepEqual(JSON.parse(requests[0]?.init?.body as string), {
      key: LICENSE_KEY,
      organization_id: ORGANIZATION_ID,
    });
    assert.ok(harness.globalState.has(CACHE_STORAGE_KEY));
  });

  test('sends and verifies the configured benefit id', async () => {
    const harness = createHarness();
    seedLicenseKey(harness);
    const requests: CapturedRequest[] = [];
    const manager = createProLicenseManager({
      context: harness.context,
      fetch: createJsonFetch([{
        status: 'granted',
        benefit_id: BENEFIT_ID,
      }], requests),
      getConfiguration: () => createConfiguration({
        'polar.benefitId': ` ${BENEFIT_ID} `,
      }),
    });

    assert.equal(await manager.hasProLicense(), true);
    assert.equal(typeof requests[0]?.init?.body, 'string');
    assert.deepEqual(JSON.parse(requests[0]?.init?.body as string), {
      key: LICENSE_KEY,
      organization_id: ORGANIZATION_ID,
      benefit_id: BENEFIT_ID,
    });
  });

  test('rejects a granted key for a different benefit', async () => {
    const harness = createHarness();
    seedLicenseKey(harness);
    const manager = createProLicenseManager({
      context: harness.context,
      fetch: createJsonFetch([{
        status: 'granted',
        benefit_id: OTHER_BENEFIT_ID,
      }]),
      getConfiguration: () => createConfiguration({
        'polar.benefitId': BENEFIT_ID,
      }),
    });

    assert.equal(await manager.hasProLicense(), false);
  });

  test('rejects a granted response without benefit information when configured', async () => {
    const harness = createHarness();
    seedLicenseKey(harness);
    const manager = createProLicenseManager({
      context: harness.context,
      fetch: createJsonFetch([{ status: 'granted' }]),
      getConfiguration: () => createConfiguration({
        'polar.benefitId': BENEFIT_ID,
      }),
    });

    assert.equal(await manager.hasProLicense(), false);
  });

  test('does not reuse an unscoped cache after a benefit id is configured', async () => {
    const harness = createHarness();
    seedLicenseKey(harness);
    harness.globalState.set(CACHE_STORAGE_KEY, {
      valid: true,
      expiresAt: 2_000,
    });
    const requests: CapturedRequest[] = [];
    const manager = createProLicenseManager({
      context: harness.context,
      fetch: createJsonFetch([{
        status: 'granted',
        benefit_id: OTHER_BENEFIT_ID,
      }], requests),
      getConfiguration: () => createConfiguration({
        'polar.benefitId': BENEFIT_ID,
      }),
      now: () => 1_000,
    });

    assert.equal(await manager.hasProLicense(), false);
    assert.equal(requests.length, 1);
  });

  test('rejects a revoked current-shape response', async () => {
    const harness = createHarness();
    seedLicenseKey(harness);
    const manager = createProLicenseManager({
      context: harness.context,
      fetch: createJsonFetch([{ status: 'revoked' }]),
      getConfiguration: () => createConfiguration(),
    });

    assert.equal(await manager.hasProLicense(), false);
  });

  test('keeps a live trial active when a stored key is rejected', async () => {
    const harness = createHarness();
    seedLicenseKey(harness);
    harness.globalState.set(TRIAL_STORAGE_KEY, 1_000);
    const manager = createProLicenseManager({
      context: harness.context,
      fetch: createJsonFetch([{ status: 'revoked' }]),
      getConfiguration: () => createConfiguration(),
      now: () => 1_000 + TRIAL_DURATION_MS - 1,
    });

    assert.equal(await manager.hasProLicense(), true);
  });

  test('accepts a legacy valid response when no benefit id is configured', async () => {
    const harness = createHarness();
    seedLicenseKey(harness);
    const manager = createProLicenseManager({
      context: harness.context,
      fetch: createJsonFetch([{ valid: true }]),
      getConfiguration: () => createConfiguration(),
    });

    assert.equal(await manager.hasProLicense(), true);
  });

  test('rejects a legacy valid response when a benefit id is configured', async () => {
    const harness = createHarness();
    seedLicenseKey(harness);
    const manager = createProLicenseManager({
      context: harness.context,
      fetch: createJsonFetch([{ valid: true }]),
      getConfiguration: () => createConfiguration({
        'polar.benefitId': BENEFIT_ID,
      }),
    });

    assert.equal(await manager.hasProLicense(), false);
  });

  test('returns false when Polar validation fails on the network', async () => {
    const harness = createHarness();
    seedLicenseKey(harness);
    const manager = createProLicenseManager({
      context: harness.context,
      fetch: createJsonFetch([new Error('offline')]),
      getConfiguration: () => createConfiguration(),
    });

    assert.equal(await manager.hasProLicense(), false);
  });

  test('reuses cached validity for 24 hours and revalidates at expiry', async () => {
    const harness = createHarness();
    seedLicenseKey(harness);
    const requests: CapturedRequest[] = [];
    let currentTime = 1_000;
    const manager = createProLicenseManager({
      context: harness.context,
      fetch: createJsonFetch([
        { status: 'granted' },
        { status: 'revoked' },
      ], requests),
      getConfiguration: () => createConfiguration(),
      now: () => currentTime,
    });

    assert.equal(await manager.hasProLicense(), true);
    currentTime += CACHE_TTL_MS - 1;
    assert.equal(await manager.hasProLicense(), true);
    assert.equal(requests.length, 1);

    currentTime += 1;
    assert.equal(await manager.hasProLicense(), false);
    assert.equal(requests.length, 2);
  });
});
