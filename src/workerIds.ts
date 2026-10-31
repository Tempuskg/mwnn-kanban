/**
 * Stable identifiers for durable worker runs, stages, and leases.
 *
 * Card ids are only unique within a board, so every mutating key is
 * `(projectId, cardId)`. Run and stage ids survive editor restarts so a
 * recovered worker can resume the same logical work without inventing a
 * duplicate claim.
 */

import type { AgentCliHandoffKind } from './agentCliStages';

export type WorkerStageKind =
  | AgentCliHandoffKind
  | 'selection'
  | 'advancement'
  | 'done'
  | 'stopped';

/** One logical unit of mutating work: project-qualified card. */
export function cardWorkKey(projectId: string, cardId: string): string {
  return `${escapeKey(projectId)}~${escapeKey(cardId)}`;
}

/** Repository-wide mutation lease key (one mutating worker per project). */
export function repoLeaseKey(projectId: string): string {
  return `repo:${escapeKey(projectId)}`;
}

/** Card-scoped mutation lease key. */
export function cardLeaseKey(projectId: string, cardId: string): string {
  return `card:${cardWorkKey(projectId, cardId)}`;
}

/**
 * Stable action id for one stage attempt inside a run. Retries bump `attempt`
 * so an ambiguous timeout can be reconciled against the exact attempt.
 */
export function stageActionId(runId: string, stage: WorkerStageKind, attempt: number): string {
  return `${runId}:${stage}:${Math.max(1, Math.trunc(attempt))}`;
}

export interface CreateRunIdOptions {
  readonly nowMs?: number;
  readonly random?: () => number;
  /** Optional short tag so tests can pin the suffix. */
  readonly sequence?: number;
}

/** Create a time-based run id: `run-<base36-ms>-<seq>`. */
export function createRunId(options: CreateRunIdOptions = {}): string {
  const nowMs = options.nowMs ?? Date.now();
  const random = options.random ?? Math.random;
  const sequence = options.sequence ?? Math.floor(random() * 36);
  return `run-${toBase36(nowMs)}-${toBase36(sequence)}`;
}

/** Create a worker-instance owner id that outlives a single stage. */
export function createWorkerOwnerId(options: CreateRunIdOptions = {}): string {
  const nowMs = options.nowMs ?? Date.now();
  const random = options.random ?? Math.random;
  const sequence = options.sequence ?? Math.floor(random() * 1296);
  return `worker-${toBase36(nowMs)}-${toBase36(sequence)}`;
}

function escapeKey(value: string): string {
  return value.replace(/~/g, '~~').replace(/:/g, '::');
}

function toBase36(value: number): string {
  return Math.max(0, Math.trunc(value)).toString(36);
}
