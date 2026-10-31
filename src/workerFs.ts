/**
 * Filesystem seam for durable worker checkpoints and leases.
 * Production uses node:fs; tests inject an in-memory implementation.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface WorkerFileStat {
  readonly mtimeMs: number;
}

export interface WorkerFileSystem {
  mkdir(directoryPath: string): Promise<void>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, contents: string): Promise<void>;
  /**
   * Create a new file exclusively (`wx`). Throws with `code: 'EEXIST'` when the
   * path already exists — used for lease claiming.
   */
  writeFileExclusive(filePath: string, contents: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  stat(filePath: string): Promise<WorkerFileStat>;
  readdir(directoryPath: string): Promise<readonly string[]>;
}

export function createNodeWorkerFileSystem(): WorkerFileSystem {
  return {
    async mkdir(directoryPath) {
      await fs.mkdir(directoryPath, { recursive: true });
    },
    async readFile(filePath) {
      return fs.readFile(filePath, 'utf8');
    },
    async writeFile(filePath, contents) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contents, 'utf8');
    },
    async writeFileExclusive(filePath, contents) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const handle = await fs.open(filePath, 'wx');
      try {
        await handle.writeFile(contents, 'utf8');
      } catch (error) {
        try {
          await handle.close();
        } catch {
          // Preserve the write failure.
        }
        try {
          await fs.unlink(filePath);
        } catch {
          // Preserve the write failure.
        }
        throw error;
      }
      await handle.close();
    },
    async rename(oldPath, newPath) {
      await fs.rename(oldPath, newPath);
    },
    async unlink(filePath) {
      await fs.unlink(filePath);
    },
    async stat(filePath) {
      const result = await fs.stat(filePath);
      return { mtimeMs: result.mtimeMs };
    },
    async readdir(directoryPath) {
      return fs.readdir(directoryPath);
    },
  };
}

interface MemoryEntry {
  contents: string;
  mtimeMs: number;
}

/** In-memory filesystem for unit tests. Paths use `/` separators. */
export function createMemoryWorkerFileSystem(now: () => number = Date.now): WorkerFileSystem {
  const files = new Map<string, MemoryEntry>();
  const dirs = new Set<string>(['/']);

  const normalize = (filePath: string): string => {
    const trimmed = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
    return trimmed.length === 0 ? '/' : trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  };

  const ensureParent = (filePath: string): void => {
    const parts = normalize(filePath).split('/').filter((part) => part.length > 0);
    let current = '';
    for (const part of parts.slice(0, -1)) {
      current += `/${part}`;
      dirs.add(current);
    }
  };

  return {
    async mkdir(directoryPath) {
      const normalized = normalize(directoryPath);
      dirs.add(normalized);
      const parts = normalized.split('/').filter((part) => part.length > 0);
      let current = '';
      for (const part of parts) {
        current += `/${part}`;
        dirs.add(current);
      }
    },
    async readFile(filePath) {
      const entry = files.get(normalize(filePath));
      if (!entry) {
        const error = new Error(`ENOENT: ${filePath}`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return entry.contents;
    },
    async writeFile(filePath, contents) {
      ensureParent(filePath);
      files.set(normalize(filePath), { contents, mtimeMs: now() });
    },
    async writeFileExclusive(filePath, contents) {
      const key = normalize(filePath);
      if (files.has(key)) {
        const error = new Error(`EEXIST: ${filePath}`) as NodeJS.ErrnoException;
        error.code = 'EEXIST';
        throw error;
      }
      ensureParent(filePath);
      files.set(key, { contents, mtimeMs: now() });
    },
    async rename(oldPath, newPath) {
      const from = normalize(oldPath);
      const to = normalize(newPath);
      const entry = files.get(from);
      if (!entry) {
        const error = new Error(`ENOENT: ${oldPath}`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      ensureParent(newPath);
      files.set(to, { ...entry, mtimeMs: now() });
      files.delete(from);
    },
    async unlink(filePath) {
      const key = normalize(filePath);
      if (!files.has(key)) {
        const error = new Error(`ENOENT: ${filePath}`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      files.delete(key);
    },
    async stat(filePath) {
      const entry = files.get(normalize(filePath));
      if (!entry) {
        const error = new Error(`ENOENT: ${filePath}`) as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return { mtimeMs: entry.mtimeMs };
    },
    async readdir(directoryPath) {
      const prefix = normalize(directoryPath) === '/' ? '/' : `${normalize(directoryPath)}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        const rest = key.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name) {
          names.add(name);
        }
      }
      for (const dir of dirs) {
        if (!dir.startsWith(prefix)) {
          continue;
        }
        const rest = dir.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name) {
          names.add(name);
        }
      }
      return [...names];
    },
  };
}

export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}
