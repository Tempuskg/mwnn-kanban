/**
 * Wait-for-reset policy for the AI loop.
 *
 * When the active agent CLI spends its usage allowance and no replacement CLI
 * can take over, the loop may wait for the allowance to reset and then retry
 * the same card stage, instead of ending the run. This module decides whether
 * to wait, how long, and which CLI to resume on, and owns every line of text
 * the wait writes. The runner in `agentCliFallback` performs the effects.
 *
 * The reset time comes only from the CLIs' own usage probes
 * (`AgentCliUsageSnapshot.resetsAt`); exhaustion messages are never parsed for
 * a time. Every wait is capped by `mwnn-kanban.aiLoopUsageResetMaxWaitHours`,
 * so a weekly or monthly reset still stops the run as before.
 *
 * No `vscode` import.
 */

import { redactSecrets } from './agentCliCredit';
import { AGENT_CLI_LABELS } from './agentCliHandoff';
import type { AgentCliProviderId } from './agentCliProviders';
import type { AgentCliHandoffKind } from './agentCliStages';
import type {
  AgentCliPacePrediction,
  AgentCliRankableUsageSnapshot,
} from './agentCliUsage';
/** The user-facing id of the per-wait cap. */
export const AI_LOOP_USAGE_RESET_MAX_WAIT_SETTING = 'mwnn-kanban.aiLoopUsageResetMaxWaitHours';

/** The user-facing id of the behind-pace-only orchestrator option. */
export const USAGE_ORCHESTRATOR_BEHIND_PACE_ONLY_SETTING = 'mwnn-kanban.usageOrchestratorBehindPaceOnly';

/** Long enough to wait out a 5-hour window; short of any weekly reset. */
export const DEFAULT_AI_LOOP_USAGE_RESET_MAX_WAIT_HOURS = 6;

/** One week: any longer is not a wait, it is an abandoned run. */
export const MAX_AI_LOOP_USAGE_RESET_MAX_WAIT_HOURS = 168;

/** Slack after a reported reset, so the retry does not race the CLI's own clock. */
export const USAGE_RESET_GRACE_MS = 90_000;

/** How often a CLI that reported no reset time is probed again. */
export const USAGE_RECHECK_INTERVAL_MS = 30 * 60_000;

/**
 * The longest single sleep. The wait is judged against the wall clock after
 * every tick, so a machine that slept past the reset resumes within one tick.
 */
export const USAGE_WAIT_TICK_MS = 60_000;

/**
 * Read `mwnn-kanban.aiLoopUsageResetMaxWaitHours` from an unvalidated
 * configuration value. `0` disables waiting. Anything non-finite, negative, or
 * not a number falls back to the default; values above one week are clamped.
 */
export function readAiLoopUsageResetMaxWaitHours(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return DEFAULT_AI_LOOP_USAGE_RESET_MAX_WAIT_HOURS;
  }
  return Math.min(value, MAX_AI_LOOP_USAGE_RESET_MAX_WAIT_HOURS);
}

/** One exhausted CLI and what its usage probe reported just now. */
export interface UsageWaitCandidate {
  readonly provider: AgentCliProviderId;
  /** Rankable figure; Cursor dual-pool readings must already be narrowed. */
  readonly snapshot: AgentCliRankableUsageSnapshot;
}

export type UsageWaitPlan =
  /** Sleep until a reported reset (plus grace), then probe that CLI again. */
  | {
      readonly kind: 'reset';
      readonly provider: AgentCliProviderId;
      readonly resetsAt: number;
      readonly until: number;
    }
  /** No reset time was reported: sleep one recheck interval, then probe again. */
  | {
      readonly kind: 'recheck';
      readonly providers: readonly AgentCliProviderId[];
      readonly until: number;
    }
  /** Do not wait: the run stops as it did before this feature existed. */
  | { readonly kind: 'decline'; readonly reason: string };

/** Spent, with a reset time the loop can wait for. */
function knownReset(snapshot: AgentCliRankableUsageSnapshot): number | undefined {
  return snapshot.kind === 'reported' && snapshot.remainingPercent <= 0
    ? snapshot.resetsAt
    : undefined;
}

/**
 * Choose what to wait for. The earliest reported reset inside the cap wins;
 * CLIs with no usable reset time are rechecked every 30 minutes until the
 * deadline; otherwise nothing waits.
 *
 * `deadline` is the end of this wait's own cap, measured from when the wait
 * began, so a long wait is capped as a whole rather than per probe.
 */
export function planUsageWait(
  candidates: readonly UsageWaitCandidate[],
  now: number,
  deadline: number,
  maxWaitHours: number,
): UsageWaitPlan {
  if (now >= deadline) {
    // The cap is spent, including on a reset that came and went without the
    // CLI reporting allowance again: never re-arm a wait past it.
    return {
      kind: 'decline',
      reason: formatNoResetWithinMaxWaitReason(candidates.map((candidate) => candidate.provider), maxWaitHours),
    };
  }
  const known = candidates
    .map((candidate) => ({ provider: candidate.provider, resetsAt: knownReset(candidate.snapshot) }))
    .filter((entry): entry is { provider: AgentCliProviderId; resetsAt: number } => entry.resetsAt !== undefined)
    .sort((left, right) => left.resetsAt - right.resetsAt);
  const earliest = known[0];
  if (earliest && earliest.resetsAt <= deadline) {
    return {
      kind: 'reset',
      provider: earliest.provider,
      resetsAt: earliest.resetsAt,
      until: Math.max(earliest.resetsAt, now) + USAGE_RESET_GRACE_MS,
    };
  }
  const unknown = candidates
    .filter((candidate) => knownReset(candidate.snapshot) === undefined)
    .map((candidate) => candidate.provider);
  if (unknown.length > 0) {
    return {
      kind: 'recheck',
      providers: unknown,
      until: Math.min(now + USAGE_RECHECK_INTERVAL_MS, deadline),
    };
  }
  if (!earliest) {
    return { kind: 'decline', reason: formatNoResetWithinMaxWaitReason([], maxWaitHours) };
  }
  return { kind: 'decline', reason: formatResetBeyondCapReason(earliest.provider, earliest.resetsAt, maxWaitHours) };
}

/**
 * After a wait, the CLI to resume on, if any. The CLI whose reset was waited
 * for resumes unless its probe still reports a spent allowance (an unknown
 * probe trusts the reset time it reported before). Any other CLI resumes only
 * on a probe that positively reports allowance left.
 */
export function selectRecoveredCli(
  candidates: readonly UsageWaitCandidate[],
  waitedFor: AgentCliProviderId | undefined,
): AgentCliProviderId | undefined {
  const waited = candidates.find((candidate) => candidate.provider === waitedFor);
  if (waited && !(waited.snapshot.kind === 'reported' && waited.snapshot.remainingPercent <= 0)) {
    return waited.provider;
  }
  return candidates.find((candidate) =>
    candidate.snapshot.kind === 'reported' && candidate.snapshot.remainingPercent > 0)?.provider;
}

export interface UsageWaitClock {
  readonly now: () => number;
  /** Resolves after `ms`, or early when `signal` aborts. */
  readonly delay: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly signal: AbortSignal;
  readonly isCancelled: () => boolean;
}

/**
 * Sleep in ticks of at most a minute until the wall clock reaches `target`.
 * Returns false when the loop was stopped first.
 */
export async function waitUntilWallClock(target: number, clock: UsageWaitClock): Promise<boolean> {
  for (;;) {
    if (clock.signal.aborted || clock.isCancelled()) {
      return false;
    }
    const left = target - clock.now();
    if (left <= 0) {
      return true;
    }
    await clock.delay(Math.min(left, USAGE_WAIT_TICK_MS), clock.signal);
  }
}

/** A real delay that ends early on abort. */
export function delayWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

const STAGE_LABELS: Record<AgentCliHandoffKind, string> = {
  implementation: 'implementation',
  definition: 'definition',
  triage: 'triage',
  verification: 'verification',
};

function formatHours(hours: number): string {
  return `${Math.round(hours * 100) / 100}-hour`;
}

function labelsOf(providers: readonly AgentCliProviderId[]): string {
  return providers.map((provider) => AGENT_CLI_LABELS[provider]).join(', ');
}

/**
 * Label for `usageWait.providerLabel`. Each selectable identity keeps its
 * Agent CLI label (`Cursor Agent CLI` / `Cursor Agent CLI Other`). The
 * protocol shape is unchanged. `model` is retained for call-site compat.
 */
export function usageWaitProviderLabel(
  provider: AgentCliProviderId,
  model?: string,
): string {
  void model;
  return AGENT_CLI_LABELS[provider];
}

function defaultFormatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatResetBeyondCapReason(
  provider: AgentCliProviderId,
  resetsAt: number,
  maxWaitHours: number,
): string {
  return `${AGENT_CLI_LABELS[provider]}'s usage limit resets at ${new Date(resetsAt).toISOString()}, beyond the ${formatHours(maxWaitHours)} maximum wait set by ${AI_LOOP_USAGE_RESET_MAX_WAIT_SETTING}, so the AI loop did not wait for it.`;
}

export function formatNoResetWithinMaxWaitReason(
  providers: readonly AgentCliProviderId[],
  maxWaitHours: number,
): string {
  return `No usage reset was reported for ${labelsOf(providers)} within the ${formatHours(maxWaitHours)} maximum wait set by ${AI_LOOP_USAGE_RESET_MAX_WAIT_SETTING}, so the AI loop stopped waiting.`;
}

/** The progress-notification and output-channel line shown during a wait. */
export function formatUsageWaitProgress(
  plan: Exclude<UsageWaitPlan, { kind: 'decline' }>,
  formatTime: (at: number) => string = defaultFormatTime,
): string {
  if (plan.kind === 'reset') {
    return `Waiting for ${AGENT_CLI_LABELS[plan.provider]}'s usage limit to reset at ${formatTime(plan.resetsAt)}. Stop ends the run.`;
  }
  return `Waiting for ${labelsOf(plan.providers)}'s usage limit to reset. No reset time was reported, so rechecking every 30 minutes (next at ${formatTime(plan.until)}). Stop ends the run.`;
}

export interface UsageWaitStartRecord {
  readonly at: Date;
  readonly kind: AgentCliHandoffKind;
  /** The CLI whose dispatch just reported exhaustion. */
  readonly exhausted: AgentCliProviderId;
  /** Redacted exhaustion detail from that CLI's own output. */
  readonly detail: string;
  readonly plan: Exclude<UsageWaitPlan, { kind: 'decline' }>;
  readonly maxWaitHours: number;
}

/** The card Activity entry written when a wait begins. */
export function formatUsageWaitStartEntry(record: UsageWaitStartRecord): string {
  const waitingFor = record.plan.kind === 'reset'
    ? AGENT_CLI_LABELS[record.plan.provider]
    : labelsOf(record.plan.providers);
  const resetTime = record.plan.kind === 'reset'
    ? new Date(record.plan.resetsAt).toISOString()
    : 'unknown, rechecking every 30 minutes';
  return redactSecrets([
    `### ${record.at.toISOString()} - AI loop waiting for a usage limit reset`,
    `Stage: ${STAGE_LABELS[record.kind]}. CLI: ${AGENT_CLI_LABELS[record.exhausted]}. Exhaustion reason: ${record.detail}`,
    `Waiting for: ${waitingFor}. Reset time: ${resetTime}. Max wait: ${Math.round(record.maxWaitHours * 100) / 100} hours (${AI_LOOP_USAGE_RESET_MAX_WAIT_SETTING}).`,
    `The card was not advanced; the same ${STAGE_LABELS[record.kind]} stage is retried after the reset.`,
  ].join('\n'));
}

/** The card Activity entry written when the waited stage resumes. */
export function formatUsageWaitResumeEntry(
  at: Date,
  kind: AgentCliHandoffKind,
  provider: AgentCliProviderId,
): string {
  const label = AGENT_CLI_LABELS[provider];
  return [
    `### ${at.toISOString()} - AI loop resumed after a usage limit reset`,
    `${label}'s usage allowance is available again; retrying the ${STAGE_LABELS[kind]} stage on ${label}.`,
  ].join('\n');
}

/** Appended to the retried prompt so the CLI keeps the interrupted work. */
export function formatUsageResetHandoffNote(
  previous: AgentCliProviderId,
  kind: AgentCliHandoffKind,
  detail: string,
): string {
  return redactSecrets([
    '## Handoff note',
    `The previous attempt at this ${STAGE_LABELS[kind]} stage stopped because ${AGENT_CLI_LABELS[previous]} hit its usage limit (${detail}). The loop waited for the limit to reset and is retrying the same stage.`,
    'You are continuing the same stage for the same card in the same workspace. Any files already changed, acceptance criteria already checked, and Activity entries already written are still in place - keep them, finish only what is left, and do not restart completed work.',
    'The stage instructions and required completion markers above still apply in full: the card advances only after you satisfy them.',
  ].join('\n'));
}

export type PaceWaitPlan =
  /** Sleep until a predicted behind time (plus grace), then re-rank. */
  | {
      readonly kind: 'pace';
      readonly provider: AgentCliProviderId;
      readonly predictedBehindAt: number;
      readonly until: number;
    }
  /** No computable prediction: sleep one recheck interval, then probe again. */
  | {
      readonly kind: 'recheck';
      readonly until: number;
    }
  /** Do not wait: same outcome as today's "no eligible CLI". */
  | { readonly kind: 'decline'; readonly reason: string };

/**
 * Choose a behind-pace wait. The earliest predicted behind time inside the cap
 * wins; when none is computable the loop rechecks every 30 minutes until the
 * deadline; otherwise the run ends the same way as no eligible CLI.
 *
 * `maxWaitHours` of `0` disables pace waits.
 */
export function planPaceWait(
  predictions: readonly AgentCliPacePrediction[],
  now: number,
  deadline: number,
  maxWaitHours: number,
): PaceWaitPlan {
  if (maxWaitHours <= 0) {
    return {
      kind: 'decline',
      reason: redactSecrets(
        `No agent CLI is behind pace, and pace waits are disabled because ${AI_LOOP_USAGE_RESET_MAX_WAIT_SETTING} is 0.`,
      ),
    };
  }
  if (now >= deadline) {
    return {
      kind: 'decline',
      reason: formatPaceBeyondCapReason(predictions, maxWaitHours),
    };
  }
  const known = predictions
    .filter((entry): entry is AgentCliPacePrediction & { predictedBehindAtMs: number } =>
      entry.predictedBehindAtMs !== undefined && Number.isFinite(entry.predictedBehindAtMs))
    .sort((left, right) => left.predictedBehindAtMs - right.predictedBehindAtMs);
  const earliest = known[0];
  if (earliest && earliest.predictedBehindAtMs <= deadline) {
    return {
      kind: 'pace',
      provider: earliest.provider,
      predictedBehindAt: earliest.predictedBehindAtMs,
      until: Math.max(earliest.predictedBehindAtMs, now) + USAGE_RESET_GRACE_MS,
    };
  }
  if (known.length === 0) {
    return {
      kind: 'recheck',
      until: Math.min(now + USAGE_RECHECK_INTERVAL_MS, deadline),
    };
  }
  return {
    kind: 'decline',
    reason: formatPaceBeyondCapReason(predictions, maxWaitHours, earliest),
  };
}

export function formatPaceBeyondCapReason(
  predictions: readonly AgentCliPacePrediction[],
  maxWaitHours: number,
  earliest?: { readonly provider: AgentCliProviderId; readonly predictedBehindAtMs: number },
): string {
  const known = earliest ?? predictions
    .filter((entry): entry is AgentCliPacePrediction & { predictedBehindAtMs: number } =>
      entry.predictedBehindAtMs !== undefined && Number.isFinite(entry.predictedBehindAtMs))
    .sort((left, right) => left.predictedBehindAtMs - right.predictedBehindAtMs)[0];
  if (!known) {
    return redactSecrets(
      `No agent CLI is behind pace and none has a computable predicted behind time within the ${formatHours(maxWaitHours)} maximum wait set by ${AI_LOOP_USAGE_RESET_MAX_WAIT_SETTING}, so the AI loop did not wait.`,
    );
  }
  return redactSecrets(
    `No agent CLI is behind pace. The earliest predicted behind time is ${AGENT_CLI_LABELS[known.provider]} at ${new Date(known.predictedBehindAtMs).toISOString()}, beyond the ${formatHours(maxWaitHours)} maximum wait set by ${AI_LOOP_USAGE_RESET_MAX_WAIT_SETTING}, so the AI loop did not wait.`,
  );
}

/** Progress line shown during a behind-pace wait. */
export function formatPaceWaitProgress(
  plan: Exclude<PaceWaitPlan, { kind: 'decline' }>,
  formatTime: (at: number) => string = defaultFormatTime,
): string {
  if (plan.kind === 'pace') {
    return `Waiting for an AI CLI to fall behind pace; ${AGENT_CLI_LABELS[plan.provider]} expected at ${formatTime(plan.predictedBehindAt)}. Stop ends the run.`;
  }
  return `Waiting for an AI CLI to fall behind pace. No predicted behind time was computable, so rechecking every 30 minutes (next at ${formatTime(plan.until)}). Stop ends the run.`;
}

export interface PaceWaitStartRecord {
  readonly at: Date;
  readonly kind: AgentCliHandoffKind;
  readonly predictions: readonly AgentCliPacePrediction[];
  readonly plan: Exclude<PaceWaitPlan, { kind: 'decline' }>;
  readonly maxWaitHours: number;
}

/** Card Activity entry when a behind-pace wait begins. */
export function formatPaceWaitStartEntry(record: PaceWaitStartRecord): string {
  const notBehind = record.predictions.length > 0
    ? record.predictions
      .map((entry) => `${AGENT_CLI_LABELS[entry.provider]}: ${entry.reason}`)
      .join('; ')
    : 'none reported';
  const predicted = record.plan.kind === 'pace'
    ? `${AGENT_CLI_LABELS[record.plan.provider]} at ${new Date(record.plan.predictedBehindAt).toISOString()}`
    : 'unknown, rechecking every 30 minutes';
  return redactSecrets([
    `### ${record.at.toISOString()} - AI loop waiting for an AI CLI to fall behind pace`,
    `Stage: ${STAGE_LABELS[record.kind]}. CLIs not behind: ${notBehind}.`,
    `Predicted: ${predicted}. Max wait: ${Math.round(record.maxWaitHours * 100) / 100} hours (${AI_LOOP_USAGE_RESET_MAX_WAIT_SETTING}).`,
    `The card was not advanced; nothing is dispatched during the wait.`,
  ].join('\n'));
}

/** Card Activity entry when a behind-pace wait ends and a CLI is dispatched. */
export function formatPaceWaitResumeEntry(
  at: Date,
  kind: AgentCliHandoffKind,
  provider: AgentCliProviderId,
): string {
  const label = AGENT_CLI_LABELS[provider];
  return [
    `### ${at.toISOString()} - AI loop resumed after a behind-pace wait`,
    `${label} fell behind pace; dispatching the ${STAGE_LABELS[kind]} stage on ${label}.`,
  ].join('\n');
}
