import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  COPILOT_USAGE_ENDPOINT,
  createCopilotUsageCapability,
} from '../../src/pro/copilotUsage';

const NOW = Date.parse('2026-10-23T20:00:00.000Z');
const RESET = '2026-11-01T00:00:00.000Z';
const TOKEN = 'secret-access-token';

function usagePayload() {
  return {
    login: 'private-account-name',
    organization_list: [{ login: 'private-org', name: 'Private Org' }],
    analytics_tracking_id: 'private-analytics-id',
    quotaSnapshots: {
      premium_interactions: {
        entitlementRequests: 300,
        usedRequests: 60,
        remainingPercentage: 80,
        resetDate: RESET,
      },
      completions: {
        entitlementRequests: 2000,
        usedRequests: 800,
        remainingPercentage: 60,
      },
    },
  };
}

suite('Copilot premium usage capability', () => {
  test('requests the approved endpoint and returns only the premium quota fields', async () => {
    const requests: { url: string; token: string; accept: string; signal: AbortSignal }[] = [];
    const capability = createCopilotUsageCapability({
      getSession: async () => ({ accessToken: TOKEN }),
      now: () => NOW,
      request: async (url, init) => {
        requests.push({
          url,
          token: init.headers.Authorization ?? '',
          accept: init.headers.Accept ?? '',
          signal: init.signal,
        });
        return {
          ok: true,
          status: 200,
          json: async () => usagePayload(),
        };
      },
    });

    const result = await capability.readPremiumUsage();

    assert.equal(capability.version, 1);
    assert.deepEqual(requests.map(({ url, token, accept }) => ({ url, token, accept })), [{
      url: COPILOT_USAGE_ENDPOINT,
      token: `Bearer ${TOKEN}`,
      accept: 'application/json',
    }]);
    assert.ok(requests[0]?.signal instanceof AbortSignal);
    assert.deepEqual(result, {
      status: 'ok',
      reading: {
        asOfMs: NOW,
        used: 60,
        remaining: 240,
        entitlement: 300,
        resetsAtMs: Date.parse(RESET),
        quotaKind: 'premium',
      },
    });
    assert.ok(!JSON.stringify(result).includes(TOKEN));
    assert.ok(!JSON.stringify(result).includes('private-account-name'));
    assert.ok(!JSON.stringify(result).includes('private-org'));
    assert.ok(!JSON.stringify(result).includes('private-analytics-id'));
  });

  test('does not make a request when no GitHub session is available', async () => {
    let requestCount = 0;
    const capability = createCopilotUsageCapability({
      getSession: async () => undefined,
      request: async () => {
        requestCount += 1;
        throw new Error('must not request');
      },
    });

    assert.deepEqual(await capability.readPremiumUsage(), {
      status: 'unavailable',
      reason: 'GitHub authentication is not available',
    });
    assert.equal(requestCount, 0);
  });

  test('continues to accept quota and reset fields from the internal endpoint', async () => {
    const capability = createCopilotUsageCapability({
      getSession: async () => ({ accessToken: TOKEN }),
      now: () => NOW,
      request: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          quota_reset_date_utc: RESET,
          quota_snapshots: {
            premium: {
              quota_id: 'premium_interactions',
              entitlement: 300,
              quota_remaining: 240,
              timestamp_utc: '2026-10-23T19:59:00.000Z',
            },
          },
        }),
      }),
    });
    assert.deepEqual(await capability.readPremiumUsage(), {
      status: 'ok',
      reading: {
        asOfMs: Date.parse('2026-10-23T19:59:00.000Z'),
        used: 60,
        remaining: 240,
        entitlement: 300,
        resetsAtMs: Date.parse(RESET),
        quotaKind: 'premium',
      },
    });
  });

  test('uses the chat allowance for accounts with no premium request entitlement', async () => {
    const capability = createCopilotUsageCapability({
      getSession: async () => ({ accessToken: TOKEN }),
      now: () => NOW,
      request: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          quotaSnapshots: {
            chat: {
              entitlementRequests: 200,
              usedRequests: 1,
              remainingPercentage: 99.5,
              resetDate: RESET,
            },
            premium_interactions: {
              entitlementRequests: 0,
              usedRequests: 0,
              remainingPercentage: 0,
              resetDate: '2026-10-09T05:21:20.137-07:00',
              hasQuota: false,
            },
          },
        }),
      }),
    });

    assert.deepEqual(await capability.readPremiumUsage(), {
      status: 'ok',
      reading: {
        asOfMs: NOW,
        used: 1,
        remaining: 199,
        entitlement: 200,
        resetsAtMs: Date.parse(RESET),
        quotaKind: 'chat',
      },
    });
  });

  test('does not surface endpoint errors or response data on access denial', async () => {
    const capability = createCopilotUsageCapability({
      getSession: async () => ({ accessToken: TOKEN }),
      request: async () => ({
        ok: false,
        status: 403,
        json: async () => ({ login: 'private-account-name', message: 'private response detail' }),
      }),
    });

    const result = await capability.readPremiumUsage();

    assert.deepEqual(result, {
      status: 'unavailable',
      reason: 'GitHub denied access to Copilot usage',
    });
    assert.ok(!JSON.stringify(result).includes(TOKEN));
    assert.ok(!JSON.stringify(result).includes('private-account-name'));
    assert.ok(!JSON.stringify(result).includes('private response detail'));
  });

  test('rejects malformed or incomplete premium quota data without guessing', async () => {
    for (const payload of [
      {},
      { quota_snapshots: {}, quota_reset_date_utc: RESET },
      {
        quota_snapshots: {
          premium: {
            quota_id: 'premium_interactions',
            entitlement: 300,
            quota_remaining: 400,
          },
        },
      },
    ]) {
      const capability = createCopilotUsageCapability({
        getSession: async () => ({ accessToken: TOKEN }),
        request: async () => ({ ok: true, status: 200, json: async () => payload }),
      });
      const result = await capability.readPremiumUsage();
      assert.equal(result.status, 'unavailable');
    }
  });

  test('reports valid quota data even when GitHub omits its reset date', async () => {
    const capability = createCopilotUsageCapability({
      getSession: async () => ({ accessToken: TOKEN }),
      now: () => NOW,
      request: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          quotaSnapshots: {
            premium_interactions: {
              entitlementRequests: 300,
              usedRequests: 10,
              remainingPercentage: 96.7,
            },
          },
        }),
      }),
    });

    assert.deepEqual(await capability.readPremiumUsage(), {
      status: 'ok',
      reading: {
        asOfMs: NOW,
        used: 10,
        remaining: 290,
        entitlement: 300,
        quotaKind: 'premium',
      },
    });
  });
});