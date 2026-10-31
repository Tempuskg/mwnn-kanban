import * as path from 'node:path';

/** Parent shared by Pro data and the durable worker store. */
export const SHARED_STORE_PARENT_DIRECTORY = 'mwnn-kanban';

/** Durable run checkpoints and leases live under this directory name. */
export const WORKER_STORE_DIRECTORY = 'mwnn-worker';

/** Host facts that decide where per-user application data lives. */
export interface WorkerHostEnvironment {
  readonly platform: string;
  readonly homeDirectory: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Shared, editor-neutral root for durable worker state.
 *
 * `globalStorageUri` is per editor, so rooting checkpoints there would let VS Code
 * and Cursor each claim the same card. This root depends only on the OS user:
 *
 * - Windows: `%APPDATA%\mwnn-kanban\mwnn-worker`
 * - macOS: `~/Library/Application Support/mwnn-kanban/mwnn-worker`
 * - Linux: `$XDG_CONFIG_HOME/mwnn-kanban/mwnn-worker`, else `~/.config/…`
 */
export function resolveSharedWorkerRoot(host: WorkerHostEnvironment): string {
  const pathApi = host.platform === 'win32' ? path.win32 : path.posix;
  return pathApi.join(
    applicationDataDirectory(host, pathApi),
    SHARED_STORE_PARENT_DIRECTORY,
    WORKER_STORE_DIRECTORY,
  );
}

function applicationDataDirectory(
  host: WorkerHostEnvironment,
  pathApi: typeof path.win32 | typeof path.posix,
): string {
  switch (host.platform) {
    case 'win32':
      return nonEmpty(host.env.APPDATA)
        ?? pathApi.join(host.homeDirectory, 'AppData', 'Roaming');
    case 'darwin':
      return pathApi.join(host.homeDirectory, 'Library', 'Application Support');
    default:
      return nonEmpty(host.env.XDG_CONFIG_HOME)
        ?? pathApi.join(host.homeDirectory, '.config');
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}
