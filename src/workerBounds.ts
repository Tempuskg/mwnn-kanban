/**
 * Per-run bounds for stage retries, wall-clock elapsed time, and stalled work.
 *
 * Visibility is deliberate: every stop returns a human-readable reason that the
 * loop can emit on progress and append to card Activity.
 */

export interface WorkerBoundsConfig {
  /** Maximum attempts of one stage inside a run (including the first). */
  readonly maxAttemptsPerStage: number;
  /** Wall-clock limit from run start; `0` disables. */
  readonly maxElapsedMs: number;
  /** No checkpoint heartbeat within this window marks the work stalled; `0` disables. */
  readonly stallTimeoutMs: number;
}

export const DEFAULT_WORKER_BOUNDS: WorkerBoundsConfig = {
  maxAttemptsPerStage: 2,
  maxElapsedMs: 4 * 60 * 60 * 1000,
  stallTimeoutMs: 30 * 60 * 1000,
};

export type WorkerBoundStopKind = 'attempts' | 'elapsed' | 'stalled';

export interface WorkerBoundStop {
  readonly kind: WorkerBoundStopKind;
  readonly message: string;
  readonly attempts?: number;
  readonly limit?: number;
  readonly elapsedMs?: number;
  readonly idleMs?: number;
}

export type WorkerBoundCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly stop: WorkerBoundStop };

export interface WorkerBoundsSnapshot {
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly attempt: number;
  readonly stage: string;
}

/**
 * Read `mwnn-kanban.aiLoopMaxStageAttempts`. Non-positive or non-finite → default.
 */
export function readAiLoopMaxStageAttempts(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_WORKER_BOUNDS.maxAttemptsPerStage;
  }
  const limit = Math.trunc(value);
  if (limit < 1) {
    return DEFAULT_WORKER_BOUNDS.maxAttemptsPerStage;
  }
  return Math.min(limit, 20);
}

/**
 * Read a minutes setting into milliseconds. `0` disables that bound.
 * Non-finite / negative → default minutes.
 */
export function readAiLoopBoundMinutes(
  value: unknown,
  defaultMinutes: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultMinutes * 60 * 1000;
  }
  const minutes = Math.trunc(value);
  if (minutes < 0) {
    return defaultMinutes * 60 * 1000;
  }
  if (minutes === 0) {
    return 0;
  }
  return Math.min(minutes, 7 * 24 * 60) * 60 * 1000;
}

export function createWorkerBoundsConfig(input: {
  readonly maxAttemptsPerStage?: unknown;
  readonly maxElapsedMinutes?: unknown;
  readonly stallTimeoutMinutes?: unknown;
} = {}): WorkerBoundsConfig {
  return {
    maxAttemptsPerStage: readAiLoopMaxStageAttempts(input.maxAttemptsPerStage),
    maxElapsedMs: readAiLoopBoundMinutes(
      input.maxElapsedMinutes,
      DEFAULT_WORKER_BOUNDS.maxElapsedMs / 60_000,
    ),
    stallTimeoutMs: readAiLoopBoundMinutes(
      input.stallTimeoutMinutes,
      DEFAULT_WORKER_BOUNDS.stallTimeoutMs / 60_000,
    ),
  };
}

/** Check whether the next stage attempt is still within configured bounds. */
export function checkWorkerBounds(
  config: WorkerBoundsConfig,
  snapshot: WorkerBoundsSnapshot,
  nowMs: number,
): WorkerBoundCheck {
  if (snapshot.attempt > config.maxAttemptsPerStage) {
    return {
      ok: false,
      stop: {
        kind: 'attempts',
        attempts: snapshot.attempt,
        limit: config.maxAttemptsPerStage,
        message: [
          `AI loop stopped: stage "${snapshot.stage}" exceeded its retry bound`,
          `(attempt ${snapshot.attempt} of ${config.maxAttemptsPerStage}).`,
          'The card was left where it is; reconcile evidence before dispatching again.',
        ].join(' '),
      },
    };
  }

  const elapsedMs = Math.max(0, nowMs - snapshot.startedAt);
  if (config.maxElapsedMs > 0 && elapsedMs >= config.maxElapsedMs) {
    return {
      ok: false,
      stop: {
        kind: 'elapsed',
        elapsedMs,
        limit: config.maxElapsedMs,
        message: [
          `AI loop stopped: run elapsed ${formatDuration(elapsedMs)}`,
          `and reached its wall-clock bound of ${formatDuration(config.maxElapsedMs)}.`,
          'In-flight CLI work is not interrupted mid-process; no further stages will start.',
        ].join(' '),
      },
    };
  }

  const idleMs = Math.max(0, nowMs - snapshot.updatedAt);
  if (config.stallTimeoutMs > 0 && idleMs >= config.stallTimeoutMs) {
    return {
      ok: false,
      stop: {
        kind: 'stalled',
        idleMs,
        limit: config.stallTimeoutMs,
        message: [
          `AI loop stopped: work on stage "${snapshot.stage}" looked stalled`,
          `(no checkpoint for ${formatDuration(idleMs)}; bound ${formatDuration(config.stallTimeoutMs)}).`,
          'Reconcile the card before retrying the ambiguous action.',
        ].join(' '),
      },
    };
  }

  return { ok: true };
}

export function formatWorkerBoundStopEntry(
  stop: WorkerBoundStop,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - AI loop stopped: ${stop.kind} bound`,
    stop.message,
  ].join('\n');
}

export function formatWorkerBoundsProgress(
  config: WorkerBoundsConfig,
  snapshot: WorkerBoundsSnapshot,
  nowMs: number,
): string {
  const parts = [
    `attempt ${snapshot.attempt}/${config.maxAttemptsPerStage}`,
    `elapsed ${formatDuration(Math.max(0, nowMs - snapshot.startedAt))}`,
  ];
  if (config.maxElapsedMs > 0) {
    parts.push(`cap ${formatDuration(config.maxElapsedMs)}`);
  }
  if (config.stallTimeoutMs > 0) {
    parts.push(`stall after ${formatDuration(config.stallTimeoutMs)}`);
  }
  return `Worker bounds: ${parts.join('; ')}.`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export const AI_LOOP_MAX_STAGE_ATTEMPTS_SETTING = 'mwnn-kanban.aiLoopMaxStageAttempts';
export const AI_LOOP_MAX_ELAPSED_MINUTES_SETTING = 'mwnn-kanban.aiLoopMaxElapsedMinutes';
export const AI_LOOP_STALL_TIMEOUT_MINUTES_SETTING = 'mwnn-kanban.aiLoopStallTimeoutMinutes';
