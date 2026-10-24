import type {
  CopilotPremiumUsageResult,
  CopilotUsageCapabilityV1,
} from './contracts';

export const COPILOT_USAGE_ENDPOINT = 'https://api.github.com/copilot_internal/user';
export const COPILOT_USAGE_TIMEOUT_MS = 15_000;
export const COPILOT_USAGE_AUTH_SCOPES = ['user:email'] as const;

interface CopilotUsageSession {
  readonly accessToken: string;
}

interface CopilotUsageResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

interface CopilotUsageRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface CopilotUsageCapabilityDeps {
  readonly getSession: () => Promise<CopilotUsageSession | undefined>;
  readonly request: (url: string, init: CopilotUsageRequest) => Promise<CopilotUsageResponse>;
  readonly now?: () => number;
}

type CopilotQuotaKind = 'premium' | 'chat';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unavailable(reason: string): CopilotPremiumUsageResult {
  return { status: 'unavailable', reason };
}

function firstFiniteNumber(...values: readonly unknown[]): number | undefined {
  return values.find((value): value is number => (
    typeof value === 'number' && Number.isFinite(value)
  ));
}

function firstDateMs(...values: readonly unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const epochMs = Date.parse(value);
    if (Number.isFinite(epochMs)) {
      return epochMs;
    }
  }
  return undefined;
}

function quotaSnapshots(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const snapshots = payload.quota_snapshots ?? payload.quotaSnapshots;
  return isRecord(snapshots) ? snapshots : undefined;
}

function findQuota(
  snapshots: Record<string, unknown>,
  name: CopilotQuotaKind,
): Record<string, unknown> | undefined {
  const byName = snapshots[name === 'premium' ? 'premium_interactions' : 'chat'];
  if (isRecord(byName)) {
    return byName;
  }
  const quotaId = name === 'premium' ? 'premium_interactions' : 'chat';
  const found = Object.values(snapshots).find((candidate) => (
    isRecord(candidate) && candidate.quota_id === quotaId
  ));
  return isRecord(found) ? found : undefined;
}

function parseQuota(
  quota: Record<string, unknown>,
  kind: CopilotQuotaKind,
  fetchedAtMs: number,
  payload: Record<string, unknown>,
): CopilotPremiumUsageResult | 'no-entitlement' {
  const entitlement = firstFiniteNumber(quota.entitlement, quota.entitlementRequests);
  if (entitlement === 0 || entitlement === undefined && quota.hasQuota === false) {
    return 'no-entitlement';
  }
  if (entitlement === undefined || entitlement < 0) {
    return unavailable('GitHub returned incomplete premium-request usage');
  }

  const used = firstFiniteNumber(quota.usedRequests);
  const remaining = firstFiniteNumber(quota.remaining, quota.quota_remaining);
  const remainingPercentage = firstFiniteNumber(quota.remainingPercentage);
  const resolvedRemaining = remaining
    ?? (used !== undefined ? entitlement - used : undefined)
    ?? (remainingPercentage !== undefined
      ? entitlement * remainingPercentage / 100
      : undefined);
  if (
    resolvedRemaining === undefined
    || resolvedRemaining < 0
    || resolvedRemaining > entitlement
    || used !== undefined && (used < 0 || used > entitlement)
    || remainingPercentage !== undefined
      && (remainingPercentage < 0 || remainingPercentage > 100)
    || !Number.isFinite(fetchedAtMs)
  ) {
    return unavailable('GitHub returned incomplete premium-request usage');
  }

  const resetsAtMs = firstDateMs(
    quota.resetDate,
    payload.quota_reset_date,
    payload.quota_reset_date_utc,
  );
  return {
    status: 'ok',
    reading: {
      asOfMs: firstDateMs(quota.timestamp_utc) ?? fetchedAtMs,
      used: entitlement - resolvedRemaining,
      remaining: resolvedRemaining,
      entitlement,
      ...(resetsAtMs === undefined ? {} : { resetsAtMs }),
      quotaKind: kind,
    },
  };
}

function parsePremiumUsage(payload: unknown, fetchedAtMs: number): CopilotPremiumUsageResult {
  if (!isRecord(payload)) {
    return unavailable('GitHub returned an unrecognised Copilot usage response');
  }
  const snapshots = quotaSnapshots(payload);
  if (snapshots === undefined) {
    return unavailable('GitHub did not report premium-request usage');
  }
  const premiumQuota = findQuota(snapshots, 'premium');
  if (premiumQuota !== undefined) {
    const premium = parseQuota(premiumQuota, 'premium', fetchedAtMs, payload);
    if (premium !== 'no-entitlement') {
      return premium;
    }
  }

  const chatQuota = findQuota(snapshots, 'chat');
  if (chatQuota !== undefined) {
    const chat = parseQuota(chatQuota, 'chat', fetchedAtMs, payload);
    if (chat !== 'no-entitlement') {
      return chat;
    }
  }
  return unavailable('GitHub did not report a premium-request or chat allowance');
}

export function createCopilotUsageCapability(
  deps: CopilotUsageCapabilityDeps,
): CopilotUsageCapabilityV1 {
  return {
    version: 1,
    async readPremiumUsage(): Promise<CopilotPremiumUsageResult> {
      let session: CopilotUsageSession | undefined;
      try {
        session = await deps.getSession();
      } catch {
        return unavailable('GitHub authentication failed');
      }
      if (session === undefined || session.accessToken.length === 0) {
        return unavailable('GitHub authentication is not available');
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), COPILOT_USAGE_TIMEOUT_MS);
      try {
        const response = await deps.request(COPILOT_USAGE_ENDPOINT, {
          headers: {
            Authorization: `Bearer ${session.accessToken}`,
            Accept: 'application/json',
          },
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          return unavailable('GitHub denied access to Copilot usage');
        }
        if (!response.ok) {
          return unavailable('GitHub Copilot usage is unavailable');
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          return unavailable('GitHub returned invalid Copilot usage data');
        }
        return parsePremiumUsage(payload, (deps.now ?? Date.now)());
      } catch {
        return unavailable('GitHub Copilot usage request failed');
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}