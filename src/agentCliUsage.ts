/**
 * Usage snapshots and ranking for the Usage Orchestrator.
 *
 * A snapshot is what one agent CLI says about its own remaining allowance:
 * either a remaining percentage (0-100) with an optional reset time, or
 * "unknown" with a reason. Nothing here synthesizes a figure - an unknown CLI
 * stays unknown, and is ranked by rule, never by an invented percentage.
 *
 * Cursor is special: one Agent CLI id (`cursor`), two usage pools (Auto and
 * Other Models) from one on-disk usage-v1 document. The probe may return both
 * pools; ranking selects the pool that the stage's resolved model draws from.
 *
 * No `vscode` import and no process spawning: the probes live in
 * `agentCliUsageProbe`, the per-run state in `agentCliOrchestrator`, so the
 * whole ranking policy is unit testable.
 */

import { redactSecrets } from './agentCliCredit';
import { AGENT_CLI_LABELS } from './agentCliHandoff';
import { AGENT_CLI_PROVIDER_IDS, type AgentCliProviderId } from './agentCliProviders';
import {
  evaluateCliPace,
  FIVE_HOUR_WINDOW_MS,
  WEEKLY_WINDOW_MS,
  type UsagePaceWindow,
} from './agentCliUsagePace';
import {
  classifyCursorModelPool,
  type CursorUsagePoolId,
} from './cursorModelPool';

/** One usage window as a CLI reports it, already converted to "remaining". */
export interface AgentCliUsageWindow {
  readonly remainingPercent: number;
  /** Used allowance, 0-100, when the source stated it (else `100 - remaining`). */
  readonly usedPercent?: number;
  /** Epoch milliseconds at which this window's allowance resets. */
  readonly resetsAt?: number;
  /** Full window length from the source, when known. */
  readonly lengthMs?: number;
  /** When the CLI last refreshed this reading. */
  readonly asOfMs?: number;
}

/** One Cursor pool reading from the shared usage-v1 document. */
export type CursorPoolReading =
  | {
      readonly status: 'reported';
      readonly remainingPercent: number;
      readonly resetsAt?: number;
      /** Per-window facts for pace; binding remaining/resets stay above. */
      readonly windows?: readonly AgentCliUsageWindow[];
      readonly asOfMs?: number;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: string;
    };

/**
 * A usable ranking / wait figure: reported remaining, or unknown with a reason.
 * Dual-pool Cursor readings are narrowed to this before `rankAgentClis`.
 */
export type AgentCliRankableUsageSnapshot =
  | {
      readonly kind: 'reported';
      readonly provider: AgentCliProviderId;
      /** Remaining allowance of the binding window, 0-100. */
      readonly remainingPercent: number;
      /** Epoch milliseconds at which the binding window resets. */
      readonly resetsAt?: number;
      /**
       * Every reported window, including lengths when the source stated one.
       * Binding remaining/resets above are unchanged for ranking and reset waits.
       */
      readonly windows?: readonly AgentCliUsageWindow[];
      /** When the CLI last refreshed this reading. */
      readonly asOfMs?: number;
    }
  | {
      readonly kind: 'unknown';
      readonly provider: AgentCliProviderId;
      /** Redacted, single-line explanation of why usage could not be read. */
      readonly reason: string;
    };

export type AgentCliUsageSnapshot =
  | AgentCliRankableUsageSnapshot
  | {
      /** Both Cursor pools from one usage-v1 read. Not a second CLI. */
      readonly kind: 'cursor-pools';
      readonly provider: 'cursor';
      readonly auto: CursorPoolReading;
      readonly otherModels: CursorPoolReading;
      readonly asOfMs?: number;
    };

const MAX_REASON_LENGTH = 200;

export function unknownUsage(provider: AgentCliProviderId, reason: string): AgentCliRankableUsageSnapshot {
  const line = redactSecrets(reason).replace(/\s+/g, ' ').trim();
  return {
    kind: 'unknown',
    provider,
    reason: line.length > MAX_REASON_LENGTH ? `${line.slice(0, MAX_REASON_LENGTH - 3)}...` : line,
  };
}

/** Convert one Cursor pool reading into a rankable snapshot for a Cursor identity. */
export function cursorPoolReadingToSnapshot(
  pool: CursorPoolReading,
  provider: AgentCliProviderId = 'cursor',
): AgentCliRankableUsageSnapshot {
  if (pool.status === 'reported') {
    return {
      kind: 'reported',
      provider,
      remainingPercent: pool.remainingPercent,
      ...(pool.resetsAt !== undefined ? { resetsAt: pool.resetsAt } : {}),
      ...(pool.windows !== undefined && pool.windows.length > 0 ? { windows: pool.windows } : {}),
      ...(pool.asOfMs !== undefined ? { asOfMs: pool.asOfMs } : {}),
    };
  }
  return unknownUsage(provider, pool.reason);
}

/** Pace windows from a rankable reported snapshot (binding alone when no list). */
export function paceWindowsFromSnapshot(
  snapshot: AgentCliRankableUsageSnapshot,
  now: number,
): readonly UsagePaceWindow[] {
  if (snapshot.kind !== 'reported') {
    return [];
  }
  const asOfMs = snapshot.asOfMs ?? now;
  const source = snapshot.windows && snapshot.windows.length > 0
    ? snapshot.windows
    : [{
        remainingPercent: snapshot.remainingPercent,
        ...(snapshot.resetsAt !== undefined ? { resetsAt: snapshot.resetsAt } : {}),
      }];
  const out: UsagePaceWindow[] = [];
  for (const window of source) {
    if (window.resetsAt === undefined || !Number.isFinite(window.resetsAt)) {
      continue;
    }
    const usedPercent = window.usedPercent !== undefined && Number.isFinite(window.usedPercent)
      ? Math.min(100, Math.max(0, window.usedPercent))
      : Math.min(100, Math.max(0, 100 - window.remainingPercent));
    out.push({
      usedPercent,
      resetsAtMs: window.resetsAt,
      asOfMs: window.asOfMs ?? asOfMs,
      ...(window.lengthMs !== undefined && window.lengthMs > 0
        ? { lengthMs: window.lengthMs }
        : {}),
    });
  }
  return out;
}

/**
 * Narrow a probe snapshot for ranking or waits by selectable Cursor identity.
 * `cursor` → Auto pool; `cursor-other` → Other Models pool. Dual-pool readings
 * for any other provider id pass through unchanged.
 */
export function selectCursorUsageForProvider(
  snapshot: AgentCliUsageSnapshot,
  provider: AgentCliProviderId,
): AgentCliRankableUsageSnapshot {
  if (snapshot.kind !== 'cursor-pools') {
    return snapshot;
  }
  if (provider === 'cursor-other') {
    return cursorPoolReadingToSnapshot(snapshot.otherModels, 'cursor-other');
  }
  if (provider === 'cursor') {
    return cursorPoolReadingToSnapshot(snapshot.auto, 'cursor');
  }
  return unknownUsage(provider, 'unexpected Cursor usage snapshot for a non-Cursor CLI');
}

/**
 * Narrow a probe snapshot from the resolved model (classifier). Prefer
 * {@link selectCursorUsageForProvider} when the selectable identity is known.
 * Product default is `auto` when omitted, so a nameless Cursor dispatch ranks
 * against the Auto pool.
 */
export function selectCursorUsageForModel(
  snapshot: AgentCliUsageSnapshot,
  model?: string,
  productDefault: string = 'auto',
): AgentCliRankableUsageSnapshot {
  if (snapshot.kind !== 'cursor-pools') {
    return snapshot;
  }
  const pool = classifyCursorModelPool({
    ...(model !== undefined ? { model } : {}),
    productDefault,
  }).pool;
  return cursorPoolReadingToSnapshot(pool === 'auto' ? snapshot.auto : snapshot.otherModels);
}

/** Which Cursor pool a rankable snapshot (or dual reading) represents for a model. */
export function cursorPoolForModel(
  model?: string,
  productDefault: string = 'auto',
): CursorUsagePoolId {
  return classifyCursorModelPool({
    ...(model !== undefined ? { model } : {}),
    productDefault,
  }).pool;
}

/**
 * Parse one Cursor usage-v1 document into both pools. Source field names stay
 * inside this function. Shared as-of / reset; each pool's used percent is its
 * own. Aggregate billing-cycle `%` is ignored. A wholly unusable document is
 * `unknown`; a missing pool percentage makes only that pool unavailable.
 */
export function parseCursorUsageV1(contents: string): AgentCliUsageSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return unknownUsage('cursor', 'the Cursor usage cache is not valid JSON');
  }
  if (!isRecord(parsed)) {
    return unknownUsage('cursor', 'the Cursor usage cache has an unrecognised shape');
  }
  if (parsed.schema !== 'usage-v1' || parsed.provider !== 'cursor') {
    return unknownUsage('cursor', 'the Cursor usage cache has an unrecognised shape');
  }
  if (parsed.status === 'unavailable') {
    return unknownUsage('cursor', 'the Cursor usage cache reports unavailable');
  }
  if (
    parsed.status !== 'live'
    && parsed.status !== 'cached'
    && parsed.status !== 'stale'
  ) {
    return unknownUsage('cursor', 'the Cursor usage cache has an unrecognised shape');
  }
  if (typeof parsed.retrieved_at !== 'string' || !Number.isFinite(Date.parse(parsed.retrieved_at))) {
    return unknownUsage('cursor', 'the Cursor usage cache has an unrecognised shape');
  }
  if (!Array.isArray(parsed.windows)) {
    return unknownUsage('cursor', 'the Cursor usage cache has an unrecognised shape');
  }

  const asOfMs = Date.parse(parsed.retrieved_at);
  const shared = parseCursorSharedWindows(parsed.windows);
  if (shared.status === 'unavailable') {
    return unknownUsage('cursor', shared.reason);
  }

  return {
    kind: 'cursor-pools',
    provider: 'cursor',
    auto: cursorPoolFromDetails(parsed.details, 'auto', shared.window, asOfMs),
    otherModels: cursorPoolFromDetails(parsed.details, 'other-models', shared.window, asOfMs),
    asOfMs,
  };
}

interface CursorSharedWindows {
  readonly resetsAtMs: number;
  readonly lengthMs?: number;
  readonly extras: readonly {
    readonly kind: 'fiveHour' | 'weekly';
    readonly usedPercent: number;
    readonly resetsAtMs: number;
    readonly lengthMs?: number;
  }[];
}

/**
 * Billing-cycle reset and length (`seconds`), plus any 5-hour or weekly slots
 * the cache carries. The billing-cycle aggregate percent is not read.
 */
function parseCursorSharedWindows(
  windows: readonly unknown[],
): { readonly status: 'ready'; readonly window: CursorSharedWindows } | { readonly status: 'unavailable'; readonly reason: string } {
  let billing: { readonly resetsAtMs: number; readonly lengthMs?: number } | undefined;
  const extras: CursorSharedWindows['extras'][number][] = [];
  for (const slot of windows) {
    if (slot === undefined || slot === null) {
      continue;
    }
    if (!isRecord(slot) || typeof slot.name !== 'string') {
      return { status: 'unavailable', reason: 'the Cursor usage cache has an unrecognised shape' };
    }
    const kind = cursorWindowKind(slot.name);
    if (kind === undefined) {
      continue;
    }
    if (kind === 'billingCycle') {
      if (billing !== undefined) {
        continue;
      }
      if (typeof slot.resets_at !== 'string') {
        return { status: 'unavailable', reason: 'the Cursor usage cache has an unrecognised shape' };
      }
      const resetsAtMs = Date.parse(slot.resets_at);
      if (!Number.isFinite(resetsAtMs)) {
        return { status: 'unavailable', reason: 'the Cursor usage cache has an unrecognised shape' };
      }
      const seconds = slot.seconds;
      billing = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
        ? { resetsAtMs, lengthMs: seconds * 1000 }
        : { resetsAtMs };
      continue;
    }
    if (typeof slot.used_pct !== 'number' || !Number.isFinite(slot.used_pct)
      || typeof slot.resets_at !== 'string') {
      continue;
    }
    const resetsAtMs = Date.parse(slot.resets_at);
    if (!Number.isFinite(resetsAtMs) || extras.some((window) => window.kind === kind)) {
      continue;
    }
    const seconds = slot.seconds;
    const lengthMs = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : kind === 'fiveHour'
        ? FIVE_HOUR_WINDOW_MS
        : WEEKLY_WINDOW_MS;
    extras.push({
      kind,
      usedPercent: slot.used_pct,
      resetsAtMs,
      lengthMs,
    });
  }
  if (billing === undefined) {
    return { status: 'unavailable', reason: 'the Cursor usage cache has no reported plan window' };
  }
  return { status: 'ready', window: { ...billing, extras } };
}

function cursorWindowKind(name: string): 'billingCycle' | 'fiveHour' | 'weekly' | undefined {
  const normalised = name.trim().toLowerCase();
  if (normalised === 'billing cycle' || normalised === 'billing-cycle') {
    return 'billingCycle';
  }
  if (normalised === '5-hour' || normalised === '5 hour' || normalised === 'five-hour' || normalised === 'five hour') {
    return 'fiveHour';
  }
  if (normalised === 'weekly' || normalised === 'week') {
    return 'weekly';
  }
  return undefined;
}

/** Finite pool percent → remaining; source keys never leave this function. */
function cursorPoolFromDetails(
  details: unknown,
  pool: CursorUsagePoolId,
  shared: CursorSharedWindows,
  asOfMs: number,
): CursorPoolReading {
  if (!isRecord(details)) {
    return {
      status: 'unavailable',
      reason: pool === 'auto'
        ? 'the Cursor pool percentage was not reported'
        : 'the Cursor Agent CLI Other pool percentage was not reported',
    };
  }
  // Parser-internal names only — never log or surface these keys.
  const used = pool === 'auto' ? details.autoPercentUsed : details.apiPercentUsed;
  if (typeof used !== 'number' || !Number.isFinite(used)) {
    return {
      status: 'unavailable',
      reason: pool === 'auto'
        ? 'the Cursor pool percentage was not reported'
        : 'the Cursor Agent CLI Other pool percentage was not reported',
    };
  }
  const usedPercent = Math.min(100, Math.max(0, used));
  const remainingPercent = Math.min(100, Math.max(0, 100 - usedPercent));
  const billing: AgentCliUsageWindow = {
    remainingPercent,
    usedPercent,
    resetsAt: shared.resetsAtMs,
    asOfMs,
    ...(shared.lengthMs !== undefined ? { lengthMs: shared.lengthMs } : {}),
  };
  const windows: AgentCliUsageWindow[] = [
    billing,
    ...shared.extras.map((extra) => ({
      remainingPercent: Math.min(100, Math.max(0, 100 - extra.usedPercent)),
      usedPercent: Math.min(100, Math.max(0, extra.usedPercent)),
      resetsAt: extra.resetsAtMs,
      asOfMs,
      ...(extra.lengthMs !== undefined ? { lengthMs: extra.lengthMs } : {}),
    })),
  ];
  return {
    status: 'reported',
    remainingPercent,
    resetsAt: shared.resetsAtMs,
    windows,
    asOfMs,
  };
}

/**
 * Collapse a multi-window report (for example a 5-hour and a weekly limit) to
 * the binding window: the lowest remaining percentage, with that window's
 * reset time. When two windows are equally low, the later reset binds, because
 * that is how long the CLI stays at that level. No windows means unknown.
 */
export function normalizeUsageWindows(
  provider: AgentCliProviderId,
  windows: readonly AgentCliUsageWindow[],
  asOfMs?: number,
): AgentCliRankableUsageSnapshot {
  let binding: AgentCliUsageWindow | undefined;
  const kept: AgentCliUsageWindow[] = [];
  for (const window of windows) {
    if (!Number.isFinite(window.remainingPercent)) {
      continue;
    }
    const remainingPercent = Math.min(100, Math.max(0, window.remainingPercent));
    const usedPercent = window.usedPercent !== undefined && Number.isFinite(window.usedPercent)
      ? Math.min(100, Math.max(0, window.usedPercent))
      : Math.min(100, Math.max(0, 100 - remainingPercent));
    const candidate: AgentCliUsageWindow = {
      remainingPercent,
      usedPercent,
      ...(window.resetsAt !== undefined && Number.isFinite(window.resetsAt)
        ? { resetsAt: window.resetsAt }
        : {}),
      ...(window.lengthMs !== undefined && window.lengthMs > 0
        ? { lengthMs: window.lengthMs }
        : {}),
      ...(window.asOfMs !== undefined && Number.isFinite(window.asOfMs)
        ? { asOfMs: window.asOfMs }
        : asOfMs !== undefined
          ? { asOfMs }
          : {}),
    };
    kept.push(candidate);
    if (
      !binding
      || candidate.remainingPercent < binding.remainingPercent
      || (candidate.remainingPercent === binding.remainingPercent
        && (candidate.resetsAt ?? -Infinity) > (binding.resetsAt ?? -Infinity))
    ) {
      binding = candidate;
    }
  }
  if (!binding) {
    return unknownUsage(provider, `${AGENT_CLI_LABELS[provider]} reported no usage windows.`);
  }
  return {
    kind: 'reported',
    provider,
    remainingPercent: binding.remainingPercent,
    ...(binding.resetsAt !== undefined ? { resetsAt: binding.resetsAt } : {}),
    ...(kept.length > 0 ? { windows: kept } : {}),
    ...(asOfMs !== undefined ? { asOfMs } : binding.asOfMs !== undefined ? { asOfMs: binding.asOfMs } : {}),
  };
}

/**
 * Parse the `result` of a Codex app-server `account/rateLimits/read` call:
 *
 * ```json
 * { "rateLimits": { "primary": { "usedPercent": 6, "windowDurationMins": 10080, "resetsAt": 1791980642 },
 *                   "secondary": null, "rateLimitReachedType": null } }
 * ```
 *
 * `resetsAt` is Unix seconds. Only the account's default `rateLimits` entry is
 * read; it is the limit every Codex dispatch draws on. Anything that does not
 * match this shape is "unknown" rather than a guess.
 */
export function parseCodexRateLimits(result: unknown): AgentCliRankableUsageSnapshot {
  if (!isRecord(result)) {
    return unknownUsage('codex', 'Codex returned a malformed rate-limit response.');
  }
  const limits = result['rateLimits'];
  if (!isRecord(limits)) {
    return unknownUsage('codex', 'Codex returned no rate limits for this account.');
  }
  const windows: AgentCliUsageWindow[] = [];
  for (const key of ['primary', 'secondary']) {
    const raw = limits[key];
    if (raw === null || raw === undefined) {
      continue;
    }
    if (!isRecord(raw)) {
      return unknownUsage('codex', `Codex returned a malformed ${key} rate-limit window.`);
    }
    const used = raw['usedPercent'];
    if (typeof used !== 'number' || !Number.isFinite(used)) {
      return unknownUsage('codex', `Codex returned a ${key} rate-limit window without a usage percentage.`);
    }
    const resetsAt = readEpochSeconds(raw['resetsAt']);
    const durationMins = raw['windowDurationMins'];
    const lengthMs = typeof durationMins === 'number' && Number.isFinite(durationMins) && durationMins > 0
      ? durationMins * 60_000
      : undefined;
    windows.push({
      remainingPercent: 100 - used,
      usedPercent: used,
      ...(resetsAt !== undefined ? { resetsAt } : {}),
      ...(lengthMs !== undefined ? { lengthMs } : {}),
    });
  }
  const snapshot = normalizeUsageWindows('codex', windows);
  // A limit Codex itself says is reached is spent, whatever the windows say.
  const reached = limits['rateLimitReachedType'];
  if (snapshot.kind === 'reported' && typeof reached === 'string' && reached.length > 0) {
    return { ...snapshot, remainingPercent: 0 };
  }
  return snapshot;
}

/**
 * Parse the server-level `account.getQuota` result returned by the Copilot
 * CLI. The premium-interactions quota is the allowance that Copilot agent
 * requests consume. An account with no premium allowance at all (Copilot Free)
 * runs agent requests against its `chat` quota instead, so that quota is read
 * when premium interactions report a zero entitlement. A missing reset date is
 * allowed by the snapshot contract; malformed values remain unknown instead of
 * being clamped or guessed.
 */
export function parseCopilotQuota(result: unknown, now: number = Date.now()): AgentCliUsageSnapshot {
  if (!isRecord(result)) {
    return unknownUsage('copilot', 'Copilot returned a malformed account quota response.');
  }
  const quotaSnapshots = result['quotaSnapshots'];
  if (!isRecord(quotaSnapshots) || !Object.hasOwn(quotaSnapshots, 'premium_interactions')) {
    return unknownUsage('copilot', 'Copilot returned no premium-interactions quota for this account.');
  }
  const premium = readCopilotQuota(quotaSnapshots['premium_interactions'], 'premium-interactions', now);
  if (premium !== 'no-entitlement') {
    return premium;
  }
  if (!Object.hasOwn(quotaSnapshots, 'chat')) {
    return unknownUsage('copilot', 'Copilot reports no premium-request allowance for this account.');
  }
  const chat = readCopilotQuota(quotaSnapshots['chat'], 'chat', now);
  return chat !== 'no-entitlement'
    ? chat
    : unknownUsage('copilot', 'Copilot reports no premium-request or chat allowance for this account.');
}

function readCopilotQuota(
  quota: unknown,
  name: string,
  now: number,
): AgentCliUsageSnapshot | 'no-entitlement' {
  if (!isRecord(quota)) {
    return unknownUsage('copilot', `Copilot returned a malformed ${name} quota.`);
  }

  const entitlementRequests = quota['entitlementRequests'];
  if (typeof entitlementRequests !== 'number'
    || !Number.isSafeInteger(entitlementRequests)
    || entitlementRequests < -1) {
    return unknownUsage('copilot', 'Copilot returned an invalid quota entitlement.');
  }
  if (entitlementRequests === -1) {
    return { kind: 'reported', provider: 'copilot', remainingPercent: 100 };
  }
  if (entitlementRequests === 0) {
    // No allowance at all: there is no percentage to spend down, and the
    // reset date reported alongside it is a placeholder.
    return 'no-entitlement';
  }

  const remainingPercent = quota['remainingPercentage'];
  if (typeof remainingPercent !== 'number'
    || !Number.isFinite(remainingPercent)
    || remainingPercent < 0
    || remainingPercent > 100) {
    return unknownUsage('copilot', 'Copilot returned no valid remaining quota percentage.');
  }

  const resetDate = quota['resetDate'];
  if (resetDate === undefined || resetDate === null) {
    return normalizeUsageWindows('copilot', [{ remainingPercent }]);
  }
  if (typeof resetDate !== 'string' || resetDate.trim().length === 0) {
    return unknownUsage('copilot', 'Copilot returned an invalid quota reset date.');
  }
  const resetsAt = parseCopilotResetDate(resetDate);
  if (resetsAt === undefined) {
    return unknownUsage('copilot', 'Copilot returned an unreadable quota reset date.');
  }
  // A fresh read whose reset has already passed is stale, not a refill: the
  // ranker would otherwise treat a spent quota as available again.
  return normalizeUsageWindows(
    'copilot',
    [resetsAt > now ? { remainingPercent, resetsAt } : { remainingPercent }],
  );
}

function parseCopilotResetDate(value: string): number | undefined {
  // Require an absolute ISO date-time so the same reset is ranked identically
  // regardless of the user's local timezone.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return undefined;
  }
  const datePart = value.slice(0, value.indexOf('T'));
  const parts = datePart.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year === undefined || month === undefined || day === undefined) {
    return undefined;
  }
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  if (
    calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
  ) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

/**
 * Parse the JSON result returned by Claude Code's local `/usage` command in
 * print mode. Version-specific command framing is checked by the process
 * probe; this parser accepts only a successful local command that completed
 * without a model turn or API duration.
 *
 * The verified v2.1.295 output formats its 5-hour and weekly windows as
 * human-readable lines, with a local date/time and an IANA time-zone name. We
 * parse only that form and leave usage unknown when it changes or is ambiguous.
 */
export function parseClaudeCodeUsageOutput(
  output: string,
  now: number = Date.now(),
): AgentCliUsageSnapshot {
  let result: unknown;
  try {
    result = JSON.parse(output.trim());
  } catch {
    return unknownUsage('claude-code', 'Claude Code returned malformed usage output.');
  }
  if (!isRecord(result)
    || result['type'] !== 'result'
    || result['subtype'] !== 'success'
    || result['is_error'] !== false
    || result['local_command'] !== 'usage'
    || result['num_turns'] !== 0
    || result['duration_api_ms'] !== 0
    || typeof result['result'] !== 'string') {
    return unknownUsage(
      'claude-code',
      'Claude Code did not return a zero-turn local /usage result; usage was not used.',
    );
  }

  const windows: AgentCliUsageWindow[] = [];
  const seen = new Set<string>();
  for (const line of result['result'].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/^Current (?:session|week)\b/i.test(trimmed)) {
      continue;
    }
    const match = /^Current (session|week)(?:\s+\([^\r\n)]{0,80}\))?:\s*(\d+(?:\.\d+)?)%\s+used(?:\s*[·•]\s*resets\s+(.+?))?\s*$/i.exec(trimmed);
    if (!match) {
      return unknownUsage('claude-code', 'Claude Code returned a malformed plan usage window.');
    }
    const windowName = match[1]?.toLowerCase();
    if (!windowName || seen.has(windowName)) {
      return unknownUsage('claude-code', 'Claude Code returned duplicate plan usage windows.');
    }
    seen.add(windowName);

    const usedPercent = Number(match[2]);
    if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
      return unknownUsage('claude-code', 'Claude Code returned an invalid plan usage percentage.');
    }
    const resetText = match[3];
    if (resetText === undefined) {
      return unknownUsage('claude-code', 'Claude Code plan usage window is missing its reset time.');
    }
    const resetsAt = parseClaudeResetTime(resetText, now);
    if (resetsAt === undefined) {
      return unknownUsage('claude-code', 'Claude Code returned an unreadable plan reset time.');
    }
    const lengthMs = windowName === 'session' ? FIVE_HOUR_WINDOW_MS : WEEKLY_WINDOW_MS;
    windows.push({
      remainingPercent: 100 - usedPercent,
      usedPercent,
      resetsAt,
      lengthMs,
      asOfMs: now,
    });
  }

  if (windows.length === 0) {
    return unknownUsage(
      'claude-code',
      'Claude Code did not report subscription plan windows; this account may use an API key or may not expose plan usage.',
    );
  }
  return normalizeUsageWindows('claude-code', windows, now);
}

const CLAUDE_MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

interface ZonedDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function parseClaudeResetTime(value: string, now: number): number | undefined {
  const match = /^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(?:(\d{4}),\s+)?(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?\s*(am|pm)\s+\(([^()\r\n]{1,80})\)$/i.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const monthName = match[1]?.toLowerCase();
  const month = monthName ? CLAUDE_MONTHS[monthName] : undefined;
  const day = Number(match[2]);
  const explicitYear = match[3] === undefined ? undefined : Number(match[3]);
  const hour12 = Number(match[4]);
  // Claude drops the minutes on the hour: "resets Oct 12, 3am".
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const meridiem = match[7]?.toLowerCase();
  const timeZone = match[8]?.trim();
  if (!month || !Number.isInteger(day) || day < 1 || day > 31
    || !Number.isInteger(hour12) || hour12 < 1 || hour12 > 12
    || !Number.isInteger(minute) || minute > 59
    || !Number.isInteger(second) || second > 59
    || (meridiem !== 'am' && meridiem !== 'pm')
    || !timeZone) {
    return undefined;
  }

  const hour = (hour12 % 12) + (meridiem === 'pm' ? 12 : 0);
  const referenceParts = getZonedDateParts(now, timeZone);
  if (!referenceParts) {
    return undefined;
  }
  const years = explicitYear === undefined
    ? [referenceParts.year, referenceParts.year + 1]
    : [explicitYear];
  const candidates = years
    .map((year) => zonedDateTimeToEpoch({ year, month, day, hour, minute, second }, timeZone))
    .filter((candidate): candidate is number => candidate !== undefined && candidate > now)
    .sort((left, right) => left - right);
  const nextReset = candidates[0];
  // Plan windows are at most weekly. A farther date indicates a stale or
  // malformed line, so do not feed it to the ranker as a real reset.
  return nextReset !== undefined && nextReset - now <= 8 * 24 * 60 * 60 * 1000
    ? nextReset
    : undefined;
}

function getZonedDateParts(epochMs: number, timeZone: string): ZonedDateParts | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(epochMs));
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const result = {
      year: Number(values.get('year')),
      month: Number(values.get('month')),
      day: Number(values.get('day')),
      hour: Number(values.get('hour')),
      minute: Number(values.get('minute')),
      second: Number(values.get('second')),
    };
    return Object.values(result).every(Number.isFinite) ? result : undefined;
  } catch {
    return undefined;
  }
}

function zonedDateTimeToEpoch(parts: ZonedDateParts, timeZone: string): number | undefined {
  const intendedWallTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let candidate = intendedWallTime;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = getZonedDateParts(candidate, timeZone);
    if (!actual) {
      return undefined;
    }
    const representedWallTime = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const correction = intendedWallTime - representedWallTime;
    if (correction === 0) {
      break;
    }
    candidate += correction;
  }

  const resolved = getZonedDateParts(candidate, timeZone);
  if (!resolved || !sameZonedDateParts(resolved, parts)) {
    return undefined;
  }
  // A wall time inside a daylight-saving fall-back fold maps to two instants.
  // The CLI output does not disambiguate those instants, so do not guess.
  for (const offset of [-90, -60, -30, 30, 60, 90].map((minutes) => minutes * 60 * 1000)) {
    const alternative = getZonedDateParts(candidate + offset, timeZone);
    if (alternative && sameZonedDateParts(alternative, parts)) {
      return undefined;
    }
  }
  return candidate;
}

function sameZonedDateParts(left: ZonedDateParts, right: ZonedDateParts): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second;
}

function readEpochSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  // Seconds today; tolerate a future switch to milliseconds without misreading
  // a timestamp as 50,000 years away.
  return value > 1e12 ? value : value * 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Which ranking rule placed a candidate. */
export type AgentCliRankRule = 'soonest-reset' | 'unknown-drain' | 'most-remaining';

export interface AgentCliRankCandidate {
  readonly provider: AgentCliProviderId;
  /** False when the executable could not be resolved. */
  readonly available: boolean;
  /** Why it is unavailable; used only when `available` is false. */
  readonly unavailableReason?: string;
  /**
   * Present for available CLIs; a missing snapshot is treated as unknown.
   * Cursor dual-pool readings must be narrowed with `selectCursorUsageForModel`
   * before ranking so a full sibling pool cannot block the other.
   */
  readonly snapshot?: AgentCliRankableUsageSnapshot;
}

/**
 * Per-run exclusions: a CLI that stopped accepting work. With a reset time it
 * is eligible again once that time passes; without one it is out for the rest
 * of the run.
 */
export type AgentCliRunExclusions = ReadonlyMap<AgentCliProviderId, { readonly until?: number }>;

export interface RankedAgentCli {
  readonly provider: AgentCliProviderId;
  readonly rule: AgentCliRankRule;
  readonly snapshot: AgentCliRankableUsageSnapshot;
  /** Present when behind-pace-only ranking selected this CLI. */
  readonly paceVariancePoints?: number;
  readonly paceElapsedPercent?: number;
}

export interface SkippedAgentCli {
  readonly provider: AgentCliProviderId;
  readonly reason: string;
}

/** Predicted wake time for one CLI under behind-pace-only waiting. */
export interface AgentCliPacePrediction {
  readonly provider: AgentCliProviderId;
  /** Latest predicted behind time across that CLI's windows, when computable. */
  readonly predictedBehindAtMs?: number;
  /** Why it was not eligible right now (ahead / on pace / unknown). */
  readonly reason: string;
}

export interface AgentCliRanking {
  /** Eligible CLIs, best first. Empty when nothing is eligible. */
  readonly ranked: readonly RankedAgentCli[];
  readonly skipped: readonly SkippedAgentCli[];
  /**
   * Behind-pace-only: every available CLI that was not behind, with its
   * predicted behind time when computable. Used to plan a pace wait.
   */
  readonly pacePredictions?: readonly AgentCliPacePrediction[];
}

const RULE_ORDER: Record<AgentCliRankRule, number> = {
  'soonest-reset': 0,
  'unknown-drain': 1,
  'most-remaining': 2,
};

export interface RankAgentClisOptions {
  /**
   * When true, only CLIs behind on every known-length window are eligible.
   * Unknown-usage CLIs are skipped (not drained). Relative order among the
   * behind CLIs matches the ordinary ranking.
   */
  readonly behindPaceOnly?: boolean;
}

/**
 * Rank the CLIs for one dispatch:
 *
 * 1. Reporting CLIs with a reset time, soonest reset first (unused allowance
 *    is lost at reset); equal resets by higher remaining percentage.
 * 2. Unknown-usage CLIs in built-in provider order. The first one takes every
 *    dispatch rule 1 does not, until it stops accepting work and is excluded.
 * 3. Reporting CLIs without a reset time, by higher remaining percentage.
 *
 * A reporting CLI at 0% is skipped until its reset time passes (for good when
 * it has none); an unavailable executable is skipped; remaining ties fall to
 * the built-in provider order.
 *
 * With `behindPaceOnly`, step 2 is skipped and only behind-pace CLIs stay
 * ranked; every other available CLI is listed as skipped with its pace reason.
 */
export function rankAgentClis(
  candidates: readonly AgentCliRankCandidate[],
  exclusions: AgentCliRunExclusions,
  now: number,
  options?: RankAgentClisOptions,
): AgentCliRanking {
  const behindPaceOnly = options?.behindPaceOnly === true;
  const ranked: RankedAgentCli[] = [];
  const skipped: SkippedAgentCli[] = [];
  const pacePredictions: AgentCliPacePrediction[] = [];
  for (const candidate of candidates) {
    const { provider } = candidate;
    const label = AGENT_CLI_LABELS[provider];
    if (!candidate.available) {
      skipped.push({
        provider,
        reason: candidate.unavailableReason ?? `${label}: executable unavailable.`,
      });
      continue;
    }
    const exclusion = exclusions.get(provider);
    if (exclusion && (exclusion.until === undefined || exclusion.until > now)) {
      skipped.push({
        provider,
        reason: exclusion.until === undefined
          ? `${label} stopped accepting work earlier in this run and reports no reset time.`
          : `${label} stopped accepting work earlier in this run; eligible again after ${new Date(exclusion.until).toISOString()}.`,
      });
      continue;
    }
    const snapshot = candidate.snapshot
      ?? unknownUsage(provider, `${label} usage was not read.`);
    if (snapshot.kind === 'unknown') {
      if (behindPaceOnly) {
        const reason = `pace unknown (usage unknown: ${snapshot.reason})`;
        skipped.push({ provider, reason: `${label}: ${reason}.` });
        pacePredictions.push({ provider, reason });
        continue;
      }
      ranked.push({ provider, rule: 'unknown-drain', snapshot });
      continue;
    }
    if (snapshot.remainingPercent <= 0) {
      if (snapshot.resetsAt === undefined) {
        skipped.push({ provider, reason: `${label} reports 0% remaining and no reset time.` });
        continue;
      }
      if (snapshot.resetsAt > now) {
        skipped.push({
          provider,
          reason: `${label} reports 0% remaining until ${new Date(snapshot.resetsAt).toISOString()}.`,
        });
        continue;
      }
    }
    if (behindPaceOnly) {
      const pace = evaluateCliPace(paceWindowsFromSnapshot(snapshot, now), now);
      if (pace.status !== 'behind') {
        const reason = pace.status === 'unknown'
          ? `pace unknown (${pace.reason})`
          : pace.reason;
        skipped.push({ provider, reason: `${label}: ${reason}.` });
        pacePredictions.push({
          provider,
          reason,
          ...(pace.predictedBehindAtMs !== undefined
            ? { predictedBehindAtMs: pace.predictedBehindAtMs }
            : {}),
        });
        continue;
      }
      ranked.push({
        provider,
        rule: snapshot.resetsAt !== undefined ? 'soonest-reset' : 'most-remaining',
        snapshot,
        paceVariancePoints: pace.variancePoints,
        paceElapsedPercent: pace.elapsedPercent,
      });
      continue;
    }
    ranked.push({
      provider,
      rule: snapshot.resetsAt !== undefined ? 'soonest-reset' : 'most-remaining',
      snapshot,
    });
  }

  ranked.sort((left, right) => {
    const byRule = RULE_ORDER[left.rule] - RULE_ORDER[right.rule];
    if (byRule !== 0) {
      return byRule;
    }
    if (left.snapshot.kind === 'reported' && right.snapshot.kind === 'reported') {
      if (left.rule === 'soonest-reset') {
        const byReset = (left.snapshot.resetsAt ?? 0) - (right.snapshot.resetsAt ?? 0);
        if (byReset !== 0) {
          return byReset;
        }
      }
      const byRemaining = right.snapshot.remainingPercent - left.snapshot.remainingPercent;
      if (byRemaining !== 0) {
        return byRemaining;
      }
    }
    return providerOrder(left.provider) - providerOrder(right.provider);
  });
  return {
    ranked,
    skipped,
    ...(behindPaceOnly && pacePredictions.length > 0 ? { pacePredictions } : {}),
  };
}

function providerOrder(provider: AgentCliProviderId): number {
  return AGENT_CLI_PROVIDER_IDS.indexOf(provider);
}

/** One-line, user-facing reason a ranked CLI sits where it does. */
export function describeRankedAgentCli(entry: RankedAgentCli): string {
  const label = AGENT_CLI_LABELS[entry.provider];
  const { snapshot } = entry;
  if (snapshot.kind === 'unknown') {
    return `${label}: usage unknown (${snapshot.reason}); drained until it stops accepting work.`;
  }
  const remaining = `${formatPercent(snapshot.remainingPercent)} remaining`;
  return snapshot.resetsAt !== undefined
    ? `${label}: ${remaining}, resets ${new Date(snapshot.resetsAt).toISOString()}.`
    : `${label}: ${remaining}, no reset time reported.`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}
