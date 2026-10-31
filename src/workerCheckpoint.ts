/**
 * Persisted run checkpoints for restart recovery.
 *
 * One JSON file per run under `<root>/runs/<runId>.json`, plus an active pointer
 * at `<root>/active/<project~card>.json` so a restart finds the in-flight work
 * for a card without scanning every run.
 */

import * as path from 'node:path';
import { cardWorkKey, type WorkerStageKind } from './workerIds';
import { errorCode, type WorkerFileSystem } from './workerFs';

export type WorkerCheckpointStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'stalled';

export interface WorkerCheckpoint {
  readonly v: 1;
  readonly runId: string;
  readonly projectId: string;
  readonly cardId: string;
  readonly stage: WorkerStageKind;
  /** 1-based attempt count for the current stage. */
  readonly attempt: number;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly ownerId: string;
  readonly status: WorkerCheckpointStatus;
  readonly activityBaseline?: number;
  readonly lastActionId?: string;
  readonly lastMessage?: string;
  readonly outcome?: string;
}

export interface WorkerCheckpointStore {
  save(checkpoint: WorkerCheckpoint): Promise<void>;
  load(runId: string): Promise<WorkerCheckpoint | undefined>;
  loadActive(projectId: string, cardId: string): Promise<WorkerCheckpoint | undefined>;
  clearActive(projectId: string, cardId: string): Promise<void>;
}

export function createWorkerCheckpointStore(
  rootPath: string,
  fileSystem: WorkerFileSystem,
  pathJoin: (...parts: string[]) => string = path.join,
): WorkerCheckpointStore {
  const runsDir = pathJoin(rootPath, 'runs');
  const activeDir = pathJoin(rootPath, 'active');

  const runPath = (runId: string): string => pathJoin(runsDir, `${sanitizeFileToken(runId)}.json`);
  const activePath = (projectId: string, cardId: string): string =>
    pathJoin(activeDir, `${sanitizeFileToken(cardWorkKey(projectId, cardId))}.json`);

  return {
    async save(checkpoint) {
      await fileSystem.mkdir(runsDir);
      await fileSystem.mkdir(activeDir);
      const payload = `${JSON.stringify(checkpoint)}\n`;
      const target = runPath(checkpoint.runId);
      const temp = `${target}.${checkpoint.updatedAt}.tmp`;
      await fileSystem.writeFile(temp, payload);
      try {
        await fileSystem.rename(temp, target);
      } catch {
        // Windows can refuse rename-over-existing; fall back to direct write.
        await fileSystem.writeFile(target, payload);
        try {
          await fileSystem.unlink(temp);
        } catch {
          // Best-effort temp cleanup.
        }
      }
      if (checkpoint.status === 'running' || checkpoint.status === 'paused' || checkpoint.status === 'stalled') {
        await fileSystem.writeFile(
          activePath(checkpoint.projectId, checkpoint.cardId),
          `${JSON.stringify({ v: 1, runId: checkpoint.runId })}\n`,
        );
      } else {
        await unlinkQuiet(fileSystem, activePath(checkpoint.projectId, checkpoint.cardId));
      }
    },
    async load(runId) {
      try {
        return parseCheckpoint(await fileSystem.readFile(runPath(runId)));
      } catch (error) {
        if (errorCode(error) === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
    },
    async loadActive(projectId, cardId) {
      let pointer: { runId?: string };
      try {
        pointer = JSON.parse(await fileSystem.readFile(activePath(projectId, cardId))) as { runId?: string };
      } catch (error) {
        if (errorCode(error) === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
      if (typeof pointer.runId !== 'string' || pointer.runId.trim().length === 0) {
        return undefined;
      }
      return this.load(pointer.runId);
    },
    async clearActive(projectId, cardId) {
      await unlinkQuiet(fileSystem, activePath(projectId, cardId));
    },
  };
}

export function createCheckpoint(input: {
  readonly runId: string;
  readonly projectId: string;
  readonly cardId: string;
  readonly ownerId: string;
  readonly stage: WorkerStageKind;
  readonly nowMs: number;
  readonly attempt?: number;
  readonly activityBaseline?: number;
  readonly lastActionId?: string;
  readonly lastMessage?: string;
  readonly status?: WorkerCheckpointStatus;
  readonly outcome?: string;
}): WorkerCheckpoint {
  const checkpoint: WorkerCheckpoint = {
    v: 1,
    runId: input.runId,
    projectId: input.projectId,
    cardId: input.cardId,
    stage: input.stage,
    attempt: input.attempt ?? 1,
    startedAt: input.nowMs,
    updatedAt: input.nowMs,
    ownerId: input.ownerId,
    status: input.status ?? 'running',
  };
  return withOptional(checkpoint, input);
}

export function touchCheckpoint(
  previous: WorkerCheckpoint,
  patch: {
    readonly nowMs: number;
    readonly stage?: WorkerStageKind;
    readonly attempt?: number;
    readonly activityBaseline?: number;
    readonly lastActionId?: string;
    readonly lastMessage?: string;
    readonly status?: WorkerCheckpointStatus;
    readonly outcome?: string;
  },
): WorkerCheckpoint {
  const next: WorkerCheckpoint = {
    ...previous,
    updatedAt: patch.nowMs,
    ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
    ...(patch.attempt !== undefined ? { attempt: patch.attempt } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
  };
  return withOptional(next, patch);
}

function withOptional(
  base: WorkerCheckpoint,
  extras: {
    readonly activityBaseline?: number;
    readonly lastActionId?: string;
    readonly lastMessage?: string;
    readonly outcome?: string;
  },
): WorkerCheckpoint {
  return {
    ...base,
    ...(extras.activityBaseline !== undefined ? { activityBaseline: extras.activityBaseline } : {}),
    ...(extras.lastActionId !== undefined ? { lastActionId: extras.lastActionId } : {}),
    ...(extras.lastMessage !== undefined ? { lastMessage: extras.lastMessage } : {}),
    ...(extras.outcome !== undefined ? { outcome: extras.outcome } : {}),
  };
}

function parseCheckpoint(raw: string): WorkerCheckpoint | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.v !== 1) {
    return undefined;
  }
  if (
    typeof record.runId !== 'string'
    || typeof record.projectId !== 'string'
    || typeof record.cardId !== 'string'
    || typeof record.stage !== 'string'
    || typeof record.attempt !== 'number'
    || typeof record.startedAt !== 'number'
    || typeof record.updatedAt !== 'number'
    || typeof record.ownerId !== 'string'
    || typeof record.status !== 'string'
  ) {
    return undefined;
  }
  const checkpoint: WorkerCheckpoint = {
    v: 1,
    runId: record.runId,
    projectId: record.projectId,
    cardId: record.cardId,
    stage: record.stage as WorkerStageKind,
    attempt: Math.max(1, Math.trunc(record.attempt)),
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    ownerId: record.ownerId,
    status: record.status as WorkerCheckpointStatus,
  };
  return withOptional(checkpoint, {
    ...(typeof record.activityBaseline === 'number' ? { activityBaseline: record.activityBaseline } : {}),
    ...(typeof record.lastActionId === 'string' ? { lastActionId: record.lastActionId } : {}),
    ...(typeof record.lastMessage === 'string' ? { lastMessage: record.lastMessage } : {}),
    ...(typeof record.outcome === 'string' ? { outcome: record.outcome } : {}),
  });
}

function sanitizeFileToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._~-]+/g, '_');
}

async function unlinkQuiet(fileSystem: WorkerFileSystem, filePath: string): Promise<void> {
  try {
    await fileSystem.unlink(filePath);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      throw error;
    }
  }
}
