/**
 * Durable worker adapter: checkpoints, leases, bounds, and reconcile around the
 * existing CLI dispatch path. Does not replace handoff or board-loop planning.
 */

import {
  createCheckpoint,
  createWorkerCheckpointStore,
  touchCheckpoint,
  type WorkerCheckpoint,
  type WorkerCheckpointStore,
} from './workerCheckpoint';
import {
  checkWorkerBounds,
  DEFAULT_WORKER_BOUNDS,
  formatWorkerBoundStopEntry,
  formatWorkerBoundsProgress,
  type WorkerBoundStop,
  type WorkerBoundsConfig,
} from './workerBounds';
import {
  createWorkerOwnerId,
  createRunId,
  cardLeaseKey,
  repoLeaseKey,
  stageActionId,
  type WorkerStageKind,
} from './workerIds';
import { createWorkerLeaseStore, type WorkerLeaseStore } from './workerLease';
import {
  formatWorkerReconcileEntry,
  reconcileWorkerStage,
  type WorkerReconcileDecision,
} from './workerReconcile';
import type { WorkerFileSystem } from './workerFs';
import type { AgentCliHandoffKind } from './agentCliStages';
import type { Card } from './types';

export interface DurableWorkerDeps {
  readonly rootPath: string;
  readonly fileSystem: WorkerFileSystem;
  readonly bounds?: WorkerBoundsConfig;
  readonly leaseTtlMs?: number;
  readonly now?: () => number;
  readonly ownerId?: string;
  readonly createRunId?: () => string;
}

export type DurableCardBeginResult =
  | {
      readonly ok: true;
      readonly runId: string;
      readonly checkpoint: WorkerCheckpoint;
      readonly resumed: boolean;
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };

export type DurableStageGateResult =
  | {
      readonly ok: true;
      readonly actionId: string;
      readonly attempt: number;
      readonly checkpoint: WorkerCheckpoint;
      readonly reconcile?: WorkerReconcileDecision;
      readonly progress: string;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly stop?: WorkerBoundStop;
      readonly reconcile?: WorkerReconcileDecision;
      readonly activityEntry?: string;
    };

export interface DurableWorkerSession {
  readonly ownerId: string;
  beginCard(projectId: string, cardId: string): Promise<DurableCardBeginResult>;
  beforeStage(input: {
    readonly projectId: string;
    readonly cardId: string;
    readonly stage: AgentCliHandoffKind;
    readonly card: Card;
    readonly activityBaseline: number;
  }): Promise<DurableStageGateResult>;
  afterStage(input: {
    readonly projectId: string;
    readonly cardId: string;
    readonly stage: AgentCliHandoffKind;
    readonly completed: boolean;
    readonly message?: string;
  }): Promise<WorkerCheckpoint | undefined>;
  heartbeat(projectId: string, cardId: string, message?: string): Promise<void>;
  finishCard(input: {
    readonly projectId: string;
    readonly cardId: string;
    readonly status: 'completed' | 'failed' | 'stopped';
    readonly outcome?: string;
  }): Promise<void>;
  release(): Promise<void>;
}

const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;

export function createDurableWorkerSession(deps: DurableWorkerDeps): DurableWorkerSession {
  const now = deps.now ?? Date.now;
  const bounds = deps.bounds ?? DEFAULT_WORKER_BOUNDS;
  const leaseTtlMs = deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const ownerId = deps.ownerId ?? createWorkerOwnerId({ nowMs: now() });
  const checkpoints: WorkerCheckpointStore = createWorkerCheckpointStore(deps.rootPath, deps.fileSystem);
  const leases: WorkerLeaseStore = createWorkerLeaseStore(deps.rootPath, deps.fileSystem);
  const active = new Map<string, WorkerCheckpoint>();
  const heldKeys = new Set<string>();

  const workKey = (projectId: string, cardId: string): string => `${projectId}\u0000${cardId}`;

  const remember = (checkpoint: WorkerCheckpoint): void => {
    active.set(workKey(checkpoint.projectId, checkpoint.cardId), checkpoint);
  };

  const current = (projectId: string, cardId: string): WorkerCheckpoint | undefined =>
    active.get(workKey(projectId, cardId));

  const renewHeld = async (runId: string, at: number): Promise<void> => {
    for (const key of heldKeys) {
      const result = await leases.renew({ key, ownerId, nowMs: at, ttlMs: leaseTtlMs });
      if (!result.ok) {
        throw new Error(result.reason);
      }
      if (result.lease.runId !== runId && result.lease.ownerId === ownerId) {
        // Same owner, different run: still ours; keep going.
      }
    }
  };

  return {
    ownerId,
    async beginCard(projectId, cardId) {
      const at = now();
      const existing = await checkpoints.loadActive(projectId, cardId);
      const runId = existing && (existing.status === 'running' || existing.status === 'paused' || existing.status === 'stalled')
        ? existing.runId
        : (deps.createRunId?.() ?? createRunId({ nowMs: at }));

      const repo = await leases.acquire({
        key: repoLeaseKey(projectId),
        ownerId,
        runId,
        nowMs: at,
        ttlMs: leaseTtlMs,
      });
      if (!repo.ok) {
        return { ok: false, reason: repo.reason };
      }
      heldKeys.add(repoLeaseKey(projectId));

      const card = await leases.acquire({
        key: cardLeaseKey(projectId, cardId),
        ownerId,
        runId,
        nowMs: at,
        ttlMs: leaseTtlMs,
      });
      if (!card.ok) {
        await leases.release({ key: repoLeaseKey(projectId), ownerId });
        heldKeys.delete(repoLeaseKey(projectId));
        return { ok: false, reason: card.reason };
      }
      heldKeys.add(cardLeaseKey(projectId, cardId));

      const resumed = existing !== undefined
        && existing.runId === runId
        && (existing.status === 'running' || existing.status === 'paused' || existing.status === 'stalled');

      const checkpoint = resumed && existing
        ? touchCheckpoint(
            {
              ...existing,
              ownerId,
            },
            {
              nowMs: at,
              status: 'running',
              lastMessage: `Resumed durable run ${runId} at stage ${existing.stage}.`,
            },
          )
        : createCheckpoint({
            runId,
            projectId,
            cardId,
            ownerId,
            stage: 'selection',
            nowMs: at,
            lastMessage: `Started durable run ${runId}.`,
          });

      await checkpoints.save(checkpoint);
      remember(checkpoint);
      return {
        ok: true,
        runId,
        checkpoint,
        resumed,
        message: resumed
          ? `Resumed run ${runId} from checkpoint stage ${checkpoint.stage} (attempt ${checkpoint.attempt}).`
          : `Claimed leases and started run ${runId} for ${projectId}/${cardId}.`,
      };
    },

    async beforeStage(input) {
      const checkpoint = current(input.projectId, input.cardId);
      if (!checkpoint) {
        return { ok: false, reason: 'No durable run is active for this card.' };
      }

      const at = now();
      await renewHeld(checkpoint.runId, at);

      const sameStage = checkpoint.stage === input.stage
        && (checkpoint.status === 'running' || checkpoint.status === 'paused' || checkpoint.status === 'stalled');
      const interrupted = sameStage && checkpoint.lastActionId !== undefined;

      let reconcile: WorkerReconcileDecision | undefined;
      let attempt = sameStage ? checkpoint.attempt : 1;

      if (interrupted) {
        reconcile = reconcileWorkerStage({
          stage: input.stage,
          card: input.card,
          ...(checkpoint.activityBaseline !== undefined
            ? { activityBaseline: checkpoint.activityBaseline }
            : {}),
          ...(checkpoint.lastActionId !== undefined ? { actionId: checkpoint.lastActionId } : {}),
        });
        if (reconcile.kind === 'already-complete') {
          const next = touchCheckpoint(checkpoint, {
            nowMs: at,
            stage: input.stage,
            status: 'running',
            lastMessage: reconcile.message,
          });
          await checkpoints.save(next);
          remember(next);
          return {
            ok: false,
            reason: reconcile.message,
            reconcile,
            activityEntry: formatWorkerReconcileEntry(reconcile),
          };
        }
        if (reconcile.kind === 'blocked' || reconcile.kind === 'needs-human') {
          const next = touchCheckpoint(checkpoint, {
            nowMs: at,
            status: reconcile.kind === 'blocked' ? 'failed' : 'paused',
            lastMessage: reconcile.message,
            ...(reconcile.kind === 'blocked' ? { outcome: reconcile.reason } : {}),
          });
          await checkpoints.save(next);
          remember(next);
          return {
            ok: false,
            reason: reconcile.message,
            reconcile,
            activityEntry: formatWorkerReconcileEntry(reconcile),
          };
        }
        attempt = checkpoint.attempt + 1;
      } else if (sameStage && checkpoint.lastActionId === undefined) {
        attempt = checkpoint.attempt;
      }

      const boundCheck = checkWorkerBounds(
        bounds,
        {
          startedAt: checkpoint.startedAt,
          updatedAt: checkpoint.updatedAt,
          attempt,
          stage: input.stage,
        },
        at,
      );
      if (!boundCheck.ok) {
        const next = touchCheckpoint(checkpoint, {
          nowMs: at,
          status: boundCheck.stop.kind === 'stalled' ? 'stalled' : 'stopped',
          lastMessage: boundCheck.stop.message,
          outcome: boundCheck.stop.kind,
        });
        await checkpoints.save(next);
        remember(next);
        return {
          ok: false,
          reason: boundCheck.stop.message,
          stop: boundCheck.stop,
          activityEntry: formatWorkerBoundStopEntry(boundCheck.stop),
          ...(reconcile ? { reconcile } : {}),
        };
      }

      const actionId = stageActionId(checkpoint.runId, input.stage, attempt);
      const next = touchCheckpoint(checkpoint, {
        nowMs: at,
        stage: input.stage,
        attempt,
        activityBaseline: input.activityBaseline,
        lastActionId: actionId,
        status: 'running',
        lastMessage: reconcile?.message
          ?? `Dispatching ${input.stage} as ${actionId}.`,
      });
      await checkpoints.save(next);
      remember(next);

      const progress = [
        `run ${checkpoint.runId}`,
        `action ${actionId}`,
        formatWorkerBoundsProgress(bounds, {
          startedAt: next.startedAt,
          updatedAt: next.updatedAt,
          attempt,
          stage: input.stage,
        }, at),
        ...(reconcile ? [reconcile.message] : []),
      ].join(' · ');

      return {
        ok: true,
        actionId,
        attempt,
        checkpoint: next,
        progress,
        ...(reconcile ? { reconcile } : {}),
      };
    },

    async afterStage(input) {
      const checkpoint = current(input.projectId, input.cardId);
      if (!checkpoint) {
        return undefined;
      }
      const at = now();
      await renewHeld(checkpoint.runId, at);
      const lastMessage = input.message
        ?? (input.completed
          ? `Stage ${input.stage} completed.`
          : `Stage ${input.stage} finished without completion evidence.`);
      // On success, drop lastActionId/activityBaseline so the next stage starts clean.
      // On failure, keep them so restart/reconcile can inspect the ambiguous attempt.
      const saved: WorkerCheckpoint = input.completed
        ? {
            v: 1,
            runId: checkpoint.runId,
            projectId: checkpoint.projectId,
            cardId: checkpoint.cardId,
            stage: input.stage,
            attempt: checkpoint.attempt,
            startedAt: checkpoint.startedAt,
            updatedAt: at,
            ownerId: checkpoint.ownerId,
            status: 'running',
            lastMessage,
            ...(checkpoint.outcome !== undefined ? { outcome: checkpoint.outcome } : {}),
          }
        : touchCheckpoint(checkpoint, {
            nowMs: at,
            stage: input.stage,
            status: 'running',
            lastMessage,
          });
      await checkpoints.save(saved);
      remember(saved);
      return saved;
    },

    async heartbeat(projectId, cardId, message) {
      const checkpoint = current(projectId, cardId);
      if (!checkpoint) {
        return;
      }
      const at = now();
      await renewHeld(checkpoint.runId, at);
      const next = touchCheckpoint(checkpoint, {
        nowMs: at,
        ...(message !== undefined ? { lastMessage: message } : {}),
      });
      await checkpoints.save(next);
      remember(next);
    },

    async finishCard(input) {
      const checkpoint = current(input.projectId, input.cardId);
      const at = now();
      if (checkpoint) {
        const stage: WorkerStageKind = input.status === 'completed' ? 'done' : 'stopped';
        const next = touchCheckpoint(checkpoint, {
          nowMs: at,
          stage,
          status: input.status,
          ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
          lastMessage: input.outcome ?? `Run ${checkpoint.runId} ${input.status}.`,
        });
        await checkpoints.save(next);
        active.delete(workKey(input.projectId, input.cardId));
      } else {
        await checkpoints.clearActive(input.projectId, input.cardId);
      }
      await leases.release({ key: cardLeaseKey(input.projectId, input.cardId), ownerId });
      heldKeys.delete(cardLeaseKey(input.projectId, input.cardId));
      await leases.release({ key: repoLeaseKey(input.projectId), ownerId });
      heldKeys.delete(repoLeaseKey(input.projectId));
    },

    async release() {
      for (const key of [...heldKeys]) {
        await leases.release({ key, ownerId });
        heldKeys.delete(key);
      }
      active.clear();
    },
  };
}

export {
  createWorkerBoundsConfig,
  DEFAULT_WORKER_BOUNDS,
  formatWorkerBoundStopEntry,
  AI_LOOP_MAX_STAGE_ATTEMPTS_SETTING,
  AI_LOOP_MAX_ELAPSED_MINUTES_SETTING,
  AI_LOOP_STALL_TIMEOUT_MINUTES_SETTING,
} from './workerBounds';
export { resolveSharedWorkerRoot } from './workerStoreLocation';
export { createNodeWorkerFileSystem, createMemoryWorkerFileSystem } from './workerFs';
