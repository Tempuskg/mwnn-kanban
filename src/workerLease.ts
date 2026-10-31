/**
 * Exclusive mutating leases for a repository and/or card.
 *
 * Leases are files under `<root>/leases/<key>.json`, claimed with exclusive
 * create so two processes cannot both own the same mutation. A lease carries a
 * TTL heartbeated by the owner; an expired lease may be reclaimed.
 */

import * as path from 'node:path';
import { errorCode, type WorkerFileSystem } from './workerFs';

export interface WorkerLeaseRecord {
  readonly v: 1;
  readonly key: string;
  readonly ownerId: string;
  readonly runId: string;
  readonly acquiredAt: number;
  readonly renewedAt: number;
  readonly expiresAt: number;
}

export type WorkerLeaseAcquireResult =
  | { readonly ok: true; readonly lease: WorkerLeaseRecord }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly holder?: WorkerLeaseRecord;
    };

export interface WorkerLeaseStore {
  acquire(input: {
    readonly key: string;
    readonly ownerId: string;
    readonly runId: string;
    readonly nowMs: number;
    readonly ttlMs: number;
  }): Promise<WorkerLeaseAcquireResult>;
  renew(input: {
    readonly key: string;
    readonly ownerId: string;
    readonly nowMs: number;
    readonly ttlMs: number;
  }): Promise<WorkerLeaseAcquireResult>;
  release(input: {
    readonly key: string;
    readonly ownerId: string;
  }): Promise<boolean>;
  read(key: string): Promise<WorkerLeaseRecord | undefined>;
}

export function createWorkerLeaseStore(
  rootPath: string,
  fileSystem: WorkerFileSystem,
  pathJoin: (...parts: string[]) => string = path.join,
): WorkerLeaseStore {
  const leasesDir = pathJoin(rootPath, 'leases');
  const leasePath = (key: string): string =>
    pathJoin(leasesDir, `${sanitizeFileToken(key)}.json`);

  const read = async (key: string): Promise<WorkerLeaseRecord | undefined> => {
    try {
      return parseLease(await fileSystem.readFile(leasePath(key)));
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  };

  const writeExclusive = async (record: WorkerLeaseRecord): Promise<boolean> => {
    await fileSystem.mkdir(leasesDir);
    try {
      await fileSystem.writeFileExclusive(leasePath(record.key), `${JSON.stringify(record)}\n`);
      return true;
    } catch (error) {
      if (errorCode(error) === 'EEXIST') {
        return false;
      }
      throw error;
    }
  };

  const overwrite = async (record: WorkerLeaseRecord): Promise<void> => {
    await fileSystem.mkdir(leasesDir);
    await fileSystem.writeFile(leasePath(record.key), `${JSON.stringify(record)}\n`);
  };

  return {
    read,
    async acquire(input) {
      const fresh: WorkerLeaseRecord = {
        v: 1,
        key: input.key,
        ownerId: input.ownerId,
        runId: input.runId,
        acquiredAt: input.nowMs,
        renewedAt: input.nowMs,
        expiresAt: input.nowMs + Math.max(1, input.ttlMs),
      };
      if (await writeExclusive(fresh)) {
        return { ok: true, lease: fresh };
      }

      const holder = await read(input.key);
      if (!holder) {
        // Race: vanished between EEXIST and read — try once more.
        if (await writeExclusive(fresh)) {
          return { ok: true, lease: fresh };
        }
        return { ok: false, reason: `Lease "${input.key}" is held by another worker.` };
      }

      if (holder.ownerId === input.ownerId && holder.runId === input.runId) {
        const renewed = {
          ...holder,
          renewedAt: input.nowMs,
          expiresAt: input.nowMs + Math.max(1, input.ttlMs),
        };
        await overwrite(renewed);
        return { ok: true, lease: renewed };
      }

      if (holder.expiresAt <= input.nowMs) {
        // Expired: delete then exclusive-create. If another reclaim wins, we lose.
        try {
          await fileSystem.unlink(leasePath(input.key));
        } catch (error) {
          if (errorCode(error) !== 'ENOENT') {
            throw error;
          }
        }
        if (await writeExclusive(fresh)) {
          return { ok: true, lease: fresh };
        }
        const again = await read(input.key);
        return {
          ok: false,
          reason: `Lease "${input.key}" was reclaimed by another worker.`,
          ...(again ? { holder: again } : {}),
        };
      }

      return {
        ok: false,
        reason: formatHeldReason(input.key, holder, input.nowMs),
        holder,
      };
    },
    async renew(input) {
      const holder = await read(input.key);
      if (!holder) {
        return { ok: false, reason: `Lease "${input.key}" is not held.` };
      }
      if (holder.ownerId !== input.ownerId) {
        return {
          ok: false,
          reason: formatHeldReason(input.key, holder, input.nowMs),
          holder,
        };
      }
      if (holder.expiresAt <= input.nowMs) {
        return {
          ok: false,
          reason: `Lease "${input.key}" expired before it could be renewed.`,
          holder,
        };
      }
      const renewed: WorkerLeaseRecord = {
        ...holder,
        renewedAt: input.nowMs,
        expiresAt: input.nowMs + Math.max(1, input.ttlMs),
      };
      await overwrite(renewed);
      return { ok: true, lease: renewed };
    },
    async release(input) {
      const holder = await read(input.key);
      if (!holder) {
        return true;
      }
      if (holder.ownerId !== input.ownerId) {
        return false;
      }
      try {
        await fileSystem.unlink(leasePath(input.key));
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          throw error;
        }
      }
      return true;
    },
  };
}

function formatHeldReason(key: string, holder: WorkerLeaseRecord, nowMs: number): string {
  const remainingMs = Math.max(0, holder.expiresAt - nowMs);
  return [
    `Lease "${key}" is held by worker ${holder.ownerId} for run ${holder.runId}.`,
    `It expires in ${Math.ceil(remainingMs / 1000)}s.`,
  ].join(' ');
}

function parseLease(raw: string): WorkerLeaseRecord | undefined {
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
  if (
    record.v !== 1
    || typeof record.key !== 'string'
    || typeof record.ownerId !== 'string'
    || typeof record.runId !== 'string'
    || typeof record.acquiredAt !== 'number'
    || typeof record.renewedAt !== 'number'
    || typeof record.expiresAt !== 'number'
  ) {
    return undefined;
  }
  return {
    v: 1,
    key: record.key,
    ownerId: record.ownerId,
    runId: record.runId,
    acquiredAt: record.acquiredAt,
    renewedAt: record.renewedAt,
    expiresAt: record.expiresAt,
  };
}

function sanitizeFileToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._~:-]+/g, '_');
}
