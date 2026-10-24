/**
 * Pace classification for Usage Orchestrator behind-pace-only mode.
 *
 * Same rule as Pro's AI Provider Usage report (`aiUsagePace` /
 * `aiUsageCurrentPace`): variance is used % minus elapsed % at the reading's
 * as-of time. Below −5 points is behind, within ±5 is on pace, above +5 is
 * ahead. Unknown, stale (older than a tenth of the window), and reset windows
 * cannot be classified. Predictions assume no further use.
 *
 * No `vscode` import.
 */

/** Variance within this many percentage points either side, inclusive, is on pace. */
export const AI_USAGE_PACE_TOLERANCE_POINTS = 5;

/** A reading older than this share of its window is too stale to pace. */
export const AI_USAGE_FRESHNESS_FRACTION = 0.1;

/** Claude Code / Codex fixed 5-hour plan window. */
export const FIVE_HOUR_WINDOW_MS = 300 * 60_000;

/** Claude Code / Codex fixed weekly plan window. */
export const WEEKLY_WINDOW_MS = 10_080 * 60_000;

/**
 * One usage window with the facts pace needs. `lengthMs` may be omitted when
 * the source did not state a length (pace is then unknown).
 */
export interface UsagePaceWindow {
  /** Used allowance, 0–100. */
  readonly usedPercent: number;
  /** Epoch ms when this window's allowance resets. */
  readonly resetsAtMs: number;
  /** Full window length from the source, when known. */
  readonly lengthMs?: number;
  /** When the CLI last refreshed this reading — never the report time. */
  readonly asOfMs: number;
}

export type UsagePaceStatus = 'ahead' | 'behind' | 'onPace';

export interface UsagePace {
  /** Share of the window elapsed at the reading's as-of time, 0–100. */
  readonly elapsedPercent: number;
  /** Used % − elapsed %, in percentage points; positive is ahead of even pace. */
  readonly variancePoints: number;
  readonly status: UsagePaceStatus;
}

export type UsagePaceClassification =
  | { readonly status: 'current'; readonly pace: UsagePace }
  /** The window ended after the reading, so neither its pace nor its used figure applies now. */
  | { readonly status: 'reset' }
  | { readonly status: 'stale'; readonly ageMs: number; readonly limitMs: number }
  /** The source did not state a window length, so pace cannot be computed. */
  | { readonly status: 'noLength' };

/**
 * Compare one window's used percentage with the share of that window elapsed
 * at `asOfMs`. Callers must only pass a window with a known positive length.
 */
export function usagePace(window: UsagePaceWindow, asOfMs: number = window.asOfMs): UsagePace {
  const lengthMs = window.lengthMs;
  if (lengthMs === undefined || lengthMs <= 0) {
    return { elapsedPercent: 0, variancePoints: 0, status: 'onPace' };
  }
  const startMs = window.resetsAtMs - lengthMs;
  const elapsedPercent = clampPercent(((asOfMs - startMs) / lengthMs) * 100);
  const variancePoints = clampPercent(window.usedPercent) - elapsedPercent;
  return { elapsedPercent, variancePoints, status: paceStatus(variancePoints) };
}

/**
 * Pace for one window only when it still describes the present: the window has
 * not reset since the reading, the window length is known, and the reading is
 * no older than a tenth of the window. A reset wins over staleness. A reading
 * stamped slightly in the future (clock skew) counts as age zero.
 */
export function classifyUsagePace(window: UsagePaceWindow, now: number): UsagePaceClassification {
  if (window.resetsAtMs < now) {
    return { status: 'reset' };
  }
  const lengthMs = window.lengthMs;
  if (lengthMs === undefined || lengthMs <= 0) {
    return { status: 'noLength' };
  }
  const limitMs = lengthMs * AI_USAGE_FRESHNESS_FRACTION;
  const ageMs = Math.max(0, now - window.asOfMs);
  if (ageMs > limitMs) {
    return { status: 'stale', ageMs, limitMs };
  }
  return { status: 'current', pace: usagePace(window, window.asOfMs) };
}

/**
 * Earliest wall-clock time at which this window is behind, assuming no further
 * use (used % stays fixed while elapsed grows). When that crossing falls after
 * the reset, the next cycle is assumed to start at 0% used, so behind is
 * tolerance into that new window. Undefined when length is unknown.
 */
export function predictBehindAtMs(window: UsagePaceWindow): number | undefined {
  const lengthMs = window.lengthMs;
  if (lengthMs === undefined || lengthMs <= 0) {
    return undefined;
  }
  const startMs = window.resetsAtMs - lengthMs;
  const used = clampPercent(window.usedPercent);
  const targetElapsed = used + AI_USAGE_PACE_TOLERANCE_POINTS;
  if (targetElapsed < 100) {
    return startMs + (targetElapsed / 100) * lengthMs;
  }
  // Never behind before reset with this used figure; after reset, 0% used.
  return window.resetsAtMs + (AI_USAGE_PACE_TOLERANCE_POINTS / 100) * lengthMs;
}

export type CliPaceEligibility =
  | {
      readonly status: 'behind';
      /** Worst (highest) variance among behind windows — for Activity copy. */
      readonly variancePoints: number;
      readonly elapsedPercent: number;
    }
  | {
      readonly status: 'not-behind';
      readonly reason: string;
      /** Latest predicted behind time across known-length windows, when computable. */
      readonly predictedBehindAtMs?: number;
    }
  | {
      readonly status: 'unknown';
      readonly reason: string;
      readonly predictedBehindAtMs?: number;
    };

/**
 * A CLI is eligible only when every known-length window it reports is behind.
 * Windows without a length are ignored for the "every" rule; when no
 * known-length window exists, the CLI is pace-unknown. A stale, reset, or
 * otherwise unclassifiable known-length window also makes the CLI ineligible.
 */
export function evaluateCliPace(
  windows: readonly UsagePaceWindow[],
  now: number,
): CliPaceEligibility {
  const known = windows.filter((window) => window.lengthMs !== undefined && window.lengthMs > 0);
  if (known.length === 0) {
    return { status: 'unknown', reason: 'no known-length usage window' };
  }

  let predictedBehindAtMs: number | undefined;
  let notBehindReason: string | undefined;
  let unknownReason: string | undefined;
  let worstBehind: { variancePoints: number; elapsedPercent: number } | undefined;

  for (const window of known) {
    const predicted = predictBehindAtMs(window);
    if (predicted !== undefined) {
      predictedBehindAtMs = predictedBehindAtMs === undefined
        ? predicted
        : Math.max(predictedBehindAtMs, predicted);
    }

    const current = classifyUsagePace(window, now);
    if (current.status === 'reset') {
      unknownReason ??= 'window reset since last reading';
      continue;
    }
    if (current.status === 'stale') {
      unknownReason ??= 'reading older than a tenth of its window';
      continue;
    }
    if (current.status === 'noLength') {
      unknownReason ??= 'window length was not reported';
      continue;
    }
    const { pace } = current;
    if (pace.status === 'behind') {
      if (!worstBehind || pace.variancePoints > worstBehind.variancePoints) {
        worstBehind = {
          variancePoints: pace.variancePoints,
          elapsedPercent: pace.elapsedPercent,
        };
      }
      continue;
    }
    const points = Math.round(pace.variancePoints * 10) / 10;
    const elapsed = Math.round(pace.elapsedPercent * 10) / 10;
    const signed = points > 0 ? `+${points}` : `${points}`;
    notBehindReason ??= pace.status === 'ahead'
      ? `ahead of pace (${signed} pts, ${elapsed}% elapsed)`
      : `on pace (${signed} pts, ${elapsed}% elapsed)`;
  }

  const prediction = predictedBehindAtMs !== undefined
    ? { predictedBehindAtMs }
    : {};

  if (notBehindReason !== undefined) {
    return { status: 'not-behind', reason: notBehindReason, ...prediction };
  }
  if (unknownReason !== undefined) {
    return { status: 'unknown', reason: unknownReason, ...prediction };
  }
  if (worstBehind === undefined) {
    return { status: 'unknown', reason: 'pace could not be classified', ...prediction };
  }
  return {
    status: 'behind',
    variancePoints: worstBehind.variancePoints,
    elapsedPercent: worstBehind.elapsedPercent,
  };
}

function paceStatus(variancePoints: number): UsagePaceStatus {
  if (variancePoints > AI_USAGE_PACE_TOLERANCE_POINTS) {
    return 'ahead';
  }
  if (variancePoints < -AI_USAGE_PACE_TOLERANCE_POINTS) {
    return 'behind';
  }
  return 'onPace';
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
