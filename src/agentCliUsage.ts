/**
 * Usage snapshots and ranking for the Usage Orchestrator.
 *
 * A snapshot is what one agent CLI says about its own remaining allowance:
 * either a remaining percentage (0-100) with an optional reset time, or
 * "unknown" with a reason. Nothing here synthesizes a figure - an unknown CLI
 * stays unknown, and is ranked by rule, never by an invented percentage.
 *
 * No `vscode` import and no process spawning: the probes live in
 * `agentCliUsageProbe`, the per-run state in `agentCliOrchestrator`, so the
 * whole ranking policy is unit testable.
 */

import { redactSecrets } from './agentCliCredit';
import { AGENT_CLI_LABELS } from './agentCliHandoff';
import { AGENT_CLI_PROVIDER_IDS, type AgentCliProviderId } from './agentCliProviders';

/** One usage window as a CLI reports it, already converted to "remaining". */
export interface AgentCliUsageWindow {
  readonly remainingPercent: number;
  /** Epoch milliseconds at which this window's allowance resets. */
  readonly resetsAt?: number;
}

export type AgentCliUsageSnapshot =
  | {
      readonly kind: 'reported';
      readonly provider: AgentCliProviderId;
      /** Remaining allowance of the binding window, 0-100. */
      readonly remainingPercent: number;
      /** Epoch milliseconds at which the binding window resets. */
      readonly resetsAt?: number;
    }
  | {
      readonly kind: 'unknown';
      readonly provider: AgentCliProviderId;
      /** Redacted, single-line explanation of why usage could not be read. */
      readonly reason: string;
    };

const MAX_REASON_LENGTH = 200;

export function unknownUsage(provider: AgentCliProviderId, reason: string): AgentCliUsageSnapshot {
  const line = redactSecrets(reason).replace(/\s+/g, ' ').trim();
  return {
    kind: 'unknown',
    provider,
    reason: line.length > MAX_REASON_LENGTH ? `${line.slice(0, MAX_REASON_LENGTH - 3)}...` : line,
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
): AgentCliUsageSnapshot {
  let binding: AgentCliUsageWindow | undefined;
  for (const window of windows) {
    if (!Number.isFinite(window.remainingPercent)) {
      continue;
    }
    const remainingPercent = Math.min(100, Math.max(0, window.remainingPercent));
    const candidate: AgentCliUsageWindow = {
      remainingPercent,
      ...(window.resetsAt !== undefined && Number.isFinite(window.resetsAt)
        ? { resetsAt: window.resetsAt }
        : {}),
    };
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
export function parseCodexRateLimits(result: unknown): AgentCliUsageSnapshot {
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
    windows.push({
      remainingPercent: 100 - used,
      ...(resetsAt !== undefined ? { resetsAt } : {}),
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
    windows.push({
      remainingPercent: 100 - usedPercent,
      resetsAt,
    });
  }

  if (windows.length === 0) {
    return unknownUsage(
      'claude-code',
      'Claude Code did not report subscription plan windows; this account may use an API key or may not expose plan usage.',
    );
  }
  return normalizeUsageWindows('claude-code', windows);
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
  /** Present for available CLIs; a missing snapshot is treated as unknown. */
  readonly snapshot?: AgentCliUsageSnapshot;
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
  readonly snapshot: AgentCliUsageSnapshot;
}

export interface SkippedAgentCli {
  readonly provider: AgentCliProviderId;
  readonly reason: string;
}

export interface AgentCliRanking {
  /** Eligible CLIs, best first. Empty when nothing is eligible. */
  readonly ranked: readonly RankedAgentCli[];
  readonly skipped: readonly SkippedAgentCli[];
}

const RULE_ORDER: Record<AgentCliRankRule, number> = {
  'soonest-reset': 0,
  'unknown-drain': 1,
  'most-remaining': 2,
};

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
 */
export function rankAgentClis(
  candidates: readonly AgentCliRankCandidate[],
  exclusions: AgentCliRunExclusions,
  now: number,
): AgentCliRanking {
  const ranked: RankedAgentCli[] = [];
  const skipped: SkippedAgentCli[] = [];
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
  return { ranked, skipped };
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
