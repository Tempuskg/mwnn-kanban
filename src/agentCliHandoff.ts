import { spawn, type ChildProcess } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { cardNeedsDefinition } from './cardDefinition';
import { parseVerificationVerdict } from './cardVerification';
import type { BoardState, Card } from './types';

export const AGENT_CLI_PROVIDER_IDS = ['copilot', 'codex', 'claude-code', 'cursor'] as const;

export type AgentCliProviderId = (typeof AGENT_CLI_PROVIDER_IDS)[number];
export type AgentCliPathOverrides = Partial<Record<AgentCliProviderId, string>>;
export type AgentCliHandoffKind = 'implementation' | 'definition' | 'triage' | 'verification';
export type AgentCliLauncher = 'standalone' | 'gh-copilot';

export const AGENT_CLI_LABELS: Record<AgentCliProviderId, string> = {
  copilot: 'GitHub Copilot CLI',
  codex: 'OpenAI Codex CLI',
  'claude-code': 'Anthropic Claude Code CLI',
  cursor: 'Cursor Agent CLI',
};

interface AgentCliProviderSpec {
  readonly defaultCommands: readonly string[];
  /** Fixed, single-line argv. The prompt itself always travels over stdin. */
  readonly args: readonly string[];
}

/**
 * Every provider receives the same existing MWNN hand-off prompt, delivered on
 * stdin rather than argv: npm installs these CLIs as .cmd shims on Windows,
 * which must be launched through cmd.exe, and cmd.exe ends its command line at
 * the first newline no matter how an argument is quoted — a multi-line prompt
 * argument is silently cut to its first line. Only this registry knows the
 * small CLI-specific differences; board-loop orchestration remains
 * provider-agnostic.
 *
 * Official non-interactive modes, each reading the piped prompt:
 * - Copilot: piped stdin runs programmatic mode; tools pre-approved and user
 *   questions disabled. No `-p` — Copilot ignores stdin when `-p` is passed.
 * - Codex: `exec -` reads instructions from stdin, with the workspace-write
 *   sandbox needed for card/code edits.
 * - Claude Code: print mode reads the piped prompt; non-interactive
 *   permission bypass.
 * - Cursor: print mode plus `--force` (file edits in headless mode). Do not
 *   put a dummy prompt on argv: Cursor treats that argument as the whole
 *   task and ignores piped stdin. The Windows `cursor-agent.cmd` shim
 *   relaunches through PowerShell and drops stdin, so the launcher unwraps
 *   to that install's `node.exe` + `index.js` when present. If unwrap is
 *   unavailable, the prompt is written to a temp file and a single-line
 *   `-p` pointer names that file (cmd.exe-safe).
 */
const PROVIDER_SPECS: Record<AgentCliProviderId, AgentCliProviderSpec> = {
  copilot: {
    defaultCommands: ['copilot'],
    args: ['--allow-all-tools', '--no-ask-user', '--silent'],
  },
  codex: {
    defaultCommands: ['codex'],
    args: ['exec', '--sandbox', 'workspace-write', '-'],
  },
  'claude-code': {
    defaultCommands: ['claude'],
    args: ['-p', '--permission-mode', 'bypassPermissions', '--output-format', 'text'],
  },
  cursor: {
    defaultCommands: ['cursor-agent'],
    args: ['-p', '--force', '--output-format', 'text'],
  },
};

export interface AgentCliTarget {
  readonly provider: AgentCliProviderId;
  readonly label: string;
  /** Resolved executable or script path. Kept separate from arguments. */
  readonly executable: string;
  /** Whether the executable is the agent itself or GitHub CLI's Copilot passthrough. */
  readonly launcher: AgentCliLauncher;
}

export interface AgentCliResolutionFailure {
  readonly available: false;
  readonly provider: AgentCliProviderId;
  readonly attemptedCommand: string;
  readonly reason: string;
}

export type AgentCliResolution =
  | { readonly available: true; readonly target: AgentCliTarget }
  | AgentCliResolutionFailure;

export interface ExecutableDiscoveryOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly canExecute?: (candidate: string, platform: NodeJS.Platform) => Promise<boolean>;
  readonly probeGhCopilot?: (executable: string, cwd: string) => Promise<GhCopilotProbeResult>;
}

export interface GhCopilotProbeResult {
  readonly supported: boolean;
  readonly reason?: string;
}

/**
 * Resolve a selected provider before a card is moved or dispatched. A
 * configured value is an executable path/name only (never a shell command), so
 * paths containing spaces remain one safe spawn argument.
 */
export async function resolveAgentCliTarget(
  provider: AgentCliProviderId,
  configuredPaths: AgentCliPathOverrides = {},
  options: ExecutableDiscoveryOptions = {},
): Promise<AgentCliResolution> {
  const configured = normalizeConfiguredPath(configuredPaths[provider]);
  if (provider === 'copilot') {
    return resolveCopilotCliTarget(configured, options);
  }

  const commands = configured ? [configured] : PROVIDER_SPECS[provider].defaultCommands;
  for (const command of commands) {
    const executable = await findExecutable(command, options);
    if (executable) {
      return {
        available: true,
        target: {
          provider,
          label: AGENT_CLI_LABELS[provider],
          executable,
          launcher: 'standalone',
        },
      };
    }
  }

  const attemptedCommand = commands[0] ?? provider;
  const setting = `mwnn-kanban.agentCliPaths["${provider}"]`;
  const source = configured ? `configured path "${attemptedCommand}"` : `command "${attemptedCommand}" on PATH`;
  return {
    available: false,
    provider,
    attemptedCommand,
    reason: `${AGENT_CLI_LABELS[provider]} is selected, but its ${source} was not found or is not executable. Install the CLI or set ${setting} to its full executable path; paths containing spaces are supported.`,
  };
}

async function resolveCopilotCliTarget(
  configured: string | undefined,
  options: ExecutableDiscoveryOptions,
): Promise<AgentCliResolution> {
  if (configured) {
    const executable = await findExecutable(configured, options);
    if (!executable) {
      return copilotResolutionFailure(
        configured,
        `its configured path "${configured}" was not found or is not executable`,
      );
    }
    if (isGitHubCliExecutable(executable, options.platform ?? process.platform)) {
      return resolveGhCopilotTarget(executable, configured, true, options);
    }
    return {
      available: true,
      target: {
        provider: 'copilot',
        label: AGENT_CLI_LABELS.copilot,
        executable,
        launcher: 'standalone',
      },
    };
  }

  const standalone = await findExecutable('copilot', options);
  if (standalone) {
    return {
      available: true,
      target: {
        provider: 'copilot',
        label: AGENT_CLI_LABELS.copilot,
        executable: standalone,
        launcher: 'standalone',
      },
    };
  }

  const gh = await findExecutable('gh', options);
  if (!gh) {
    return copilotResolutionFailure(
      'copilot, gh',
      'neither standalone command "copilot" nor GitHub CLI command "gh" was found on PATH',
    );
  }
  return resolveGhCopilotTarget(gh, 'gh', false, options);
}

async function resolveGhCopilotTarget(
  executable: string,
  attemptedCommand: string,
  configured: boolean,
  options: ExecutableDiscoveryOptions,
): Promise<AgentCliResolution> {
  const cwd = options.cwd ?? process.cwd();
  const probe = options.probeGhCopilot ?? defaultProbeGhCopilot;
  let support: GhCopilotProbeResult;
  try {
    support = await probe(executable, cwd);
  } catch (error: unknown) {
    support = {
      supported: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (support.supported) {
    return {
      available: true,
      target: {
        provider: 'copilot',
        label: AGENT_CLI_LABELS.copilot,
        executable,
        launcher: 'gh-copilot',
      },
    };
  }

  const source = configured
    ? `the configured GitHub CLI path "${attemptedCommand}"`
    : `GitHub CLI at "${executable}"`;
  const detail = support.reason?.trim()
    ? ` ${support.reason.trim()}`
    : '';
  return copilotResolutionFailure(
    attemptedCommand,
    `${source} does not provide the modern built-in \`gh copilot\` passthrough.${detail}`,
  );
}

function copilotResolutionFailure(
  attemptedCommand: string,
  problem: string,
): AgentCliResolutionFailure {
  const normalizedProblem = problem.trim().replace(/\.+$/, '');
  return {
    available: false,
    provider: 'copilot',
    attemptedCommand,
    reason: `${AGENT_CLI_LABELS.copilot} is selected, but ${normalizedProblem}. Install the standalone Copilot CLI or update GitHub CLI to a version with the modern \`gh copilot\` passthrough, then rerun; the retired \`github/gh-copilot\` suggestion/explanation extension is not supported. The mwnn-kanban.agentCliPaths["copilot"] setting can point to either executable; paths containing spaces are supported.`,
  };
}

function isGitHubCliExecutable(executable: string, platform: NodeJS.Platform): boolean {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const basename = pathApi.basename(executable).toLowerCase();
  return basename.replace(/\.(?:com|exe|bat|cmd)$/i, '') === 'gh';
}

/**
 * Probe GitHub CLI's own help instead of invoking the nested Copilot binary.
 * The modern built-in command describes itself as the GitHub Copilot CLI;
 * the retired `github/gh-copilot` extension exposes suggest/explain help and
 * therefore cannot satisfy this capability check.
 */
async function defaultProbeGhCopilot(
  executable: string,
  cwd: string,
): Promise<GhCopilotProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const result = await runAgentCliProcess(
      {
        provider: 'copilot',
        label: 'GitHub CLI Copilot capability check',
        command: executable,
        args: ['copilot', '--help'],
        stdin: '',
        cwd,
      },
      controller.signal,
    );
    if (result.cancelled) {
      return { supported: false, reason: 'The capability check timed out.' };
    }
    if (!result.started) {
      return {
        supported: false,
        reason: `The capability check could not start: ${result.error?.trim() || 'the operating system rejected the process start'}.`,
      };
    }
    if (result.exitCode !== 0 || result.error) {
      const output = conciseProcessOutput(result.stderr || result.stdout);
      return {
        supported: false,
        reason: `The capability check failed${output ? `: ${output}` : ''}.`,
      };
    }
    const help = `${result.stdout}\n${result.stderr}`;
    if (!/\bRuns? the GitHub Copilot CLI\b/i.test(help)) {
      return {
        supported: false,
        reason: 'Its Copilot help is not the modern agentic passthrough; update GitHub CLI.',
      };
    }
    return { supported: true };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveAllAgentCliTargets(
  configuredPaths: AgentCliPathOverrides = {},
  options: ExecutableDiscoveryOptions = {},
): Promise<readonly AgentCliResolution[]> {
  return Promise.all(
    AGENT_CLI_PROVIDER_IDS.map((provider) => resolveAgentCliTarget(provider, configuredPaths, options)),
  );
}

function normalizeConfiguredPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function findExecutable(
  command: string,
  options: ExecutableDiscoveryOptions,
): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const canExecute = options.canExecute ?? defaultCanExecute;

  const candidates = executableCandidates(command, cwd, env, platform);
  for (const candidate of candidates) {
    if (await canExecute(candidate, platform)) {
      return candidate;
    }
  }
  return undefined;
}

function executableCandidates(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const hasPath = pathApi.isAbsolute(command) || command.includes('/') || command.includes('\\');
  const bases = hasPath
    ? [pathApi.isAbsolute(command) ? command : pathApi.resolve(cwd, command)]
    : pathEntries(env, platform, cwd).map((entry) => pathApi.join(entry, command));
  const extensions = platform === 'win32' ? windowsExecutableExtensions(command, env) : [''];
  const candidates: string[] = [];
  for (const base of bases) {
    for (const extension of extensions) {
      const candidate = `${base}${extension}`;
      if (!candidates.some((existing) => existing.toLowerCase() === candidate.toLowerCase())) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function pathEntries(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  cwd: string,
): string[] {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  const rawPath = pathKey ? env[pathKey] : undefined;
  return (rawPath ?? '')
    .split(pathApi.delimiter)
    .map((entry) => normalizeConfiguredPath(entry))
    .filter((entry): entry is string => entry !== undefined)
    .map((entry) => (pathApi.isAbsolute(entry) ? entry : pathApi.resolve(cwd, entry)))
    .filter((entry, index, entries) =>
      entries.findIndex((candidate) =>
        platform === 'win32'
          ? candidate.toLowerCase() === entry.toLowerCase()
          : candidate === entry,
      ) === index);
}

function windowsExecutableExtensions(command: string, env: NodeJS.ProcessEnv): string[] {
  if (path.win32.extname(command)) {
    return [''];
  }
  const pathExtKey = Object.keys(env).find((key) => key.toLowerCase() === 'pathext');
  const pathExt = pathExtKey ? env[pathExtKey] : undefined;
  const configured = (pathExt ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim())
    .filter((extension) => extension.length > 0)
    .map((extension) => extension.startsWith('.') ? extension : `.${extension}`);
  // Windows command lookup follows PATHEXT. npm also writes extensionless
  // POSIX shims beside its runnable .cmd files; accepting the bare file would
  // discover it successfully and then fail at CreateProcess time.
  return configured;
}

async function defaultCanExecute(candidate: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) {
      return false;
    }
    await fs.access(candidate, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface AgentCliInvocation {
  readonly provider: AgentCliProviderId;
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  /** Hand-off prompt, written to the process's stdin; argv stays single-line. */
  readonly stdin: string;
  readonly cwd: string;
}

export function buildAgentCliInvocation(
  target: AgentCliTarget,
  prompt: string,
  cwd: string,
): AgentCliInvocation {
  const providerArgs = [...PROVIDER_SPECS[target.provider].args];
  return {
    provider: target.provider,
    label: target.label,
    command: target.executable,
    args: target.launcher === 'gh-copilot'
      ? ['copilot', '--', ...providerArgs]
      : providerArgs,
    stdin: prompt,
    cwd,
  };
}

export interface PreparedAgentCliInvocation {
  readonly invocation: AgentCliInvocation;
  readonly cleanup?: () => Promise<void>;
}

export interface PrepareAgentCliInvocationOptions {
  readonly platform?: NodeJS.Platform;
}

/**
 * Cursor's Windows `.cmd` shim relaunches through PowerShell and does not
 * forward piped stdin to `node.exe`. Unwrap to the versioned Node entrypoint
 * when that layout is present; otherwise point `-p` at a temp prompt file.
 */
export async function prepareAgentCliInvocation(
  target: AgentCliTarget,
  prompt: string,
  cwd: string,
  options: PrepareAgentCliInvocationOptions = {},
): Promise<PreparedAgentCliInvocation> {
  const invocation = buildAgentCliInvocation(target, prompt, cwd);
  if (target.provider !== 'cursor') {
    return { invocation };
  }

  const platform = options.platform ?? process.platform;
  const unwrapped = await resolveCursorWindowsLaunch(target.executable, platform);
  if (unwrapped) {
    return {
      invocation: {
        ...invocation,
        command: unwrapped.command,
        args: [unwrapped.script, ...PROVIDER_SPECS.cursor.args],
      },
    };
  }

  if (platform === 'win32' && /\.(?:cmd|bat|ps1)$/i.test(target.executable)) {
    const pointer = await writeCursorPromptPointer(prompt);
    return {
      invocation: {
        ...invocation,
        args: [...PROVIDER_SPECS.cursor.args, pointer.pointer],
      },
      cleanup: pointer.cleanup,
    };
  }

  return { invocation };
}

const CURSOR_VERSION_DIR = /^\d{4}\.\d{1,2}\.\d{1,2}(?:-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/i;

export async function resolveCursorWindowsLaunch(
  executable: string,
  platform: NodeJS.Platform = process.platform,
): Promise<{ readonly command: string; readonly script: string } | undefined> {
  if (platform !== 'win32') {
    return undefined;
  }
  const pathApi = path.win32;
  const versionsRoot = pathApi.join(pathApi.dirname(executable), 'versions');
  let names: string[];
  try {
    names = await fs.readdir(versionsRoot);
  } catch {
    return undefined;
  }

  const ranked = names
    .filter((name) => CURSOR_VERSION_DIR.test(name))
    .sort((left, right) => {
      const rank = cursorVersionRank(right) - cursorVersionRank(left);
      return rank !== 0 ? rank : right.localeCompare(left);
    });
  for (const name of ranked) {
    const command = pathApi.join(versionsRoot, name, 'node.exe');
    const script = pathApi.join(versionsRoot, name, 'index.js');
    if (await isRegularFile(command) && await isRegularFile(script)) {
      return { command, script };
    }
  }
  return undefined;
}

function cursorVersionRank(name: string): number {
  const datePart = name.split('-')[0];
  const parts = datePart?.split('.') ?? [];
  if (parts.length !== 3) {
    return 0;
  }
  const year = parts[0] ?? '';
  const month = (parts[1] ?? '').padStart(2, '0');
  const day = (parts[2] ?? '').padStart(2, '0');
  const rank = Number(`${year}${month}${day}`);
  return Number.isFinite(rank) ? rank : 0;
}

async function isRegularFile(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function writeCursorPromptPointer(prompt: string): Promise<{
  readonly pointer: string;
  readonly cleanup: () => Promise<void>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-cursor-handoff-'));
  const file = path.join(dir, 'handoff.txt');
  try {
    await fs.writeFile(file, prompt, { encoding: 'utf8', mode: 0o600 });
  } catch (error: unknown) {
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    pointer: `Read the UTF-8 file at ${file} first and carry out those complete hand-off instructions. That file is the full prompt.`,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export interface AgentCliProcessResult {
  readonly started: boolean;
  readonly cancelled: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}

/**
 * Live view of one CLI process for user-facing feedback surfaces (output
 * channel, progress text, board UI). Purely observational: callbacks must not
 * influence the run, and omitting the observer changes nothing.
 */
export interface AgentCliProcessObserver {
  readonly onStart?: (invocation: AgentCliInvocation) => void;
  readonly onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
  readonly onExit?: (result: AgentCliProcessResult) => void;
}

export type AgentCliProcessRunner = (
  invocation: AgentCliInvocation,
  signal: AbortSignal,
  observer?: AgentCliProcessObserver,
) => Promise<AgentCliProcessResult>;

const MAX_CAPTURED_OUTPUT = 64 * 1024;

/**
 * Launch a provider without a shell, except for Windows .cmd/.bat shims. The
 * prompt is piped to the child's stdin so it survives cmd.exe verbatim.
 */
export async function runAgentCliProcess(
  invocation: AgentCliInvocation,
  signal: AbortSignal,
  observer: AgentCliProcessObserver = {},
): Promise<AgentCliProcessResult> {
  if (signal.aborted) {
    return emptyProcessResult(false, true);
  }

  return new Promise((resolve) => {
    let settled = false;
    let started = false;
    let stdout = '';
    let stderr = '';
    let child: ChildProcess | undefined;
    let forceCancellationTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: AgentCliProcessResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (forceCancellationTimer !== undefined) {
        clearTimeout(forceCancellationTimer);
      }
      signal.removeEventListener('abort', cancel);
      observer.onExit?.(result);
      resolve(result);
    };

    const cancel = (): void => {
      if (!child) {
        finish(emptyProcessResult(started, true));
        return;
      }
      terminateProcess(child);
      forceCancellationTimer = setTimeout(() => {
        if (child && !settled) {
          child.kill('SIGKILL');
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref();
          finish({
            started,
            cancelled: true,
            exitCode: child.exitCode,
            signal: child.signalCode,
            stdout,
            stderr,
          });
        }
      }, 1_000);
    };

    observer.onStart?.(invocation);
    try {
      const launch = process.platform === 'win32'
        ? windowsLaunchCommand(invocation.command, invocation.args)
        : {
            command: invocation.command,
            args: [...invocation.args],
            windowsVerbatimArguments: false,
          };
      child = spawn(launch.command, launch.args, {
        cwd: invocation.cwd,
        windowsHide: true,
        detached: process.platform !== 'win32',
        shell: false,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      finish({ ...emptyProcessResult(false, false), error: message });
      return;
    }

    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
    }

    child.once('spawn', () => {
      started = true;
    });
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout = captureTail(stdout, chunk);
      observer.onOutput?.(chunk.toString(), 'stdout');
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = captureTail(stderr, chunk);
      observer.onOutput?.(chunk.toString(), 'stderr');
    });
    child.once('error', (error: Error) => {
      if (signal.aborted) {
        finish({
          started,
          cancelled: true,
          exitCode: null,
          signal: null,
          stdout,
          stderr,
        });
        return;
      }
      finish({
        started,
        cancelled: false,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        error: error.message,
      });
    });
    child.once('exit', (exitCode, exitSignal) => {
      finish({
        started,
        cancelled: signal.aborted,
        exitCode,
        signal: exitSignal,
        stdout,
        stderr,
      });
    });
    child.stdin?.on('error', () => {
      // A CLI that exits before draining its stdin raises EPIPE here; the
      // exit handler reports the real outcome.
    });
    child.stdin?.end(invocation.stdin);
  });
}

function emptyProcessResult(started: boolean, cancelled: boolean): AgentCliProcessResult {
  return {
    started,
    cancelled,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
  };
}

function captureTail(current: string, chunk: Buffer | string): string {
  const combined = `${current}${chunk.toString()}`;
  return combined.length <= MAX_CAPTURED_OUTPUT
    ? combined
    : combined.slice(combined.length - MAX_CAPTURED_OUTPUT);
}

function windowsLaunchCommand(
  command: string,
  args: readonly string[],
): {
  readonly command: string;
  readonly args: string[];
  readonly windowsVerbatimArguments: boolean;
} {
  if (!/\.(?:cmd|bat)$/i.test(command)) {
    return { command, args: [...args], windowsVerbatimArguments: false };
  }

  // cmd.exe ends its command line at the first newline regardless of quoting;
  // everything after it would be silently dropped. Multi-line text (the
  // hand-off prompt) must travel over stdin instead of argv.
  const unsafe = [command, ...args].find((part) => /[\r\n]/.test(part));
  if (unsafe !== undefined) {
    throw new Error(
      'A cmd.exe shim argument contains a newline, which cmd.exe would silently truncate; pass multi-line text via stdin instead.',
    );
  }

  const commandLine = [command, ...args].map(quoteWindowsCommandArgument).join(' ');
  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    // With /s, cmd.exe expects one outer quote pair around a command whose
    // executable path is itself quoted. Verbatim arguments prevent Node from
    // translating those inner quotes to literal backslash-quote sequences.
    args: ['/d', '/s', '/v:off', '/c', `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

/**
 * Quote one argument for cmd.exe. Percent expansion is neutralized as well as
 * cmd metacharacters; paths and flags remain data even when an npm .cmd shim
 * is the discovered executable. Newlines cannot be quoted for cmd.exe at all —
 * windowsLaunchCommand rejects them before this runs.
 */
function quoteWindowsCommandArgument(value: string): string {
  const escaped = value
    .replace(/%/g, '%%')
    .replace(/"/g, '\\"')
    .replace(/([&|<>^])/g, '^$1');
  return `"${escaped}"`;
}

function terminateProcess(child: ChildProcess): void {
  const pid = child.pid;
  if (process.platform === 'win32' && pid !== undefined) {
    const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('error', () => {
      child.kill();
    });
    killer.once('exit', () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    });
    return;
  }

  if (pid !== undefined) {
    try {
      process.kill(-pid, 'SIGTERM');
      return;
    } catch {
      // Fall back to the direct child when process groups are unavailable.
    }
  }
  child.kill('SIGTERM');
}

export interface AgentCliHandoffStore {
  reload(): Promise<BoardState>;
  appendActivity(cardId: string, entry: string): Promise<unknown>;
}

export interface AgentCliCardHandoff {
  readonly kind: AgentCliHandoffKind;
  readonly target: AgentCliTarget;
  readonly cardId: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly store: AgentCliHandoffStore;
  readonly signal: AbortSignal;
}

export interface AgentCliCardHandoffResult {
  readonly completed: boolean;
  readonly cancelled: boolean;
  /** Activity length after the loop's start entry and before the agent ran. */
  readonly activityBaseline: number;
  readonly reason?: string;
  readonly terminalStatus?: TerminalCardStatus;
}

export interface AgentCliCardHandoffOptions {
  readonly runProcess?: AgentCliProcessRunner;
  readonly now?: () => Date;
  /** Forwarded to the process runner so callers can surface live CLI output. */
  readonly observer?: AgentCliProcessObserver;
  readonly platform?: NodeJS.Platform;
}

/**
 * Run one synchronous CLI hand-off and accept it only when both the process and
 * card-file evidence are valid. The board loop receives the same success/fail
 * contract for every provider.
 */
export async function runAgentCliCardHandoff(
  handoff: AgentCliCardHandoff,
  options: AgentCliCardHandoffOptions = {},
): Promise<AgentCliCardHandoffResult> {
  const runProcess = options.runProcess ?? runAgentCliProcess;
  const now = options.now ?? (() => new Date());
  const before = findCard(await handoff.store.reload(), handoff.cardId);
  if (!before) {
    return {
      completed: false,
      cancelled: false,
      activityBaseline: 0,
      reason: `Card ${handoff.cardId} no longer exists, so ${handoff.target.label} was not started.`,
    };
  }
  if (handoff.signal.aborted) {
    return { completed: false, cancelled: true, activityBaseline: (before.activity ?? '').length };
  }

  await handoff.store.appendActivity(
    handoff.cardId,
    formatAgentCliStartEntry(handoff.target.label, handoff.kind, now()),
  );
  const afterStart = findCard(await handoff.store.reload(), handoff.cardId);
  const activityBaseline = (afterStart?.activity ?? before.activity ?? '').length;
  const prepared = await prepareAgentCliInvocation(
    handoff.target,
    handoff.prompt,
    handoff.cwd,
    options.platform !== undefined ? { platform: options.platform } : {},
  );
  let processResult: AgentCliProcessResult;
  try {
    processResult = await runProcess(prepared.invocation, handoff.signal, options.observer);
  } finally {
    await prepared.cleanup?.();
  }

  if (processResult.cancelled || handoff.signal.aborted) {
    await appendIfCardExists(
      handoff.store,
      handoff.cardId,
      formatAgentCliCancellationEntry(handoff.target.label, handoff.kind, now()),
    );
    return { completed: false, cancelled: true, activityBaseline };
  }

  const processFailure = describeProcessFailure(handoff.target, processResult);
  if (processFailure) {
    await appendIfCardExists(
      handoff.store,
      handoff.cardId,
      formatAgentCliFailureEntry(handoff.target.label, handoff.kind, processFailure, now()),
    );
    return {
      completed: false,
      cancelled: false,
      activityBaseline,
      reason: processFailure,
    };
  }

  const after = findCard(await handoff.store.reload(), handoff.cardId);
  if (!after) {
    return {
      completed: false,
      cancelled: false,
      activityBaseline,
      reason: `${handoff.target.label} exited successfully, but card ${handoff.cardId} no longer exists.`,
    };
  }

  const evidence = validateCompletionEvidence(handoff.kind, after, activityBaseline);
  if (!evidence.valid) {
    const reason = `${handoff.target.label} exited successfully, but ${evidence.reason}`;
    await handoff.store.appendActivity(
      handoff.cardId,
      formatAgentCliFailureEntry(handoff.target.label, handoff.kind, reason, now()),
    );
    return {
      completed: false,
      cancelled: false,
      activityBaseline,
      reason,
    };
  }

  const baseResult = { completed: true, cancelled: false, activityBaseline } as const;
  return evidence.terminalStatus
    ? { ...baseResult, terminalStatus: evidence.terminalStatus }
    : baseResult;
}

function describeProcessFailure(
  target: AgentCliTarget,
  result: AgentCliProcessResult,
): string | undefined {
  if (!result.started) {
    const detail = result.error?.trim() || 'the operating system rejected the process start';
    return `Could not start ${target.label} at "${target.executable}": ${detail}. Verify the configured executable path and CLI installation, then rerun the loop.`;
  }
  if (result.error) {
    return `${target.label} failed while running: ${result.error}. The card was not advanced; fix the CLI and rerun the loop.`;
  }
  if (result.exitCode !== 0) {
    const status = result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.exitCode === null ? 'unknown' : result.exitCode}`;
    const output = conciseProcessOutput(result.stderr || result.stdout);
    return `${target.label} ended with ${status}${output ? `: ${output}` : ''}. The card was not advanced; verify CLI authentication/configuration and rerun the loop.`;
  }
  return undefined;
}

function conciseProcessOutput(output: string): string {
  return output
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-3)
    .join(' ')
    .slice(0, 500);
}

type CompletionEvidence =
  | { readonly valid: true; readonly terminalStatus?: TerminalCardStatus }
  | { readonly valid: false; readonly reason: string };

function validateCompletionEvidence(
  kind: AgentCliHandoffKind,
  card: Card,
  activityBaseline: number,
): CompletionEvidence {
  if (kind === 'definition') {
    return cardNeedsDefinition(card)
      ? {
          valid: false,
          reason: 'the card still has no complete Description and Acceptance criteria. The card was not advanced; rerun the definition handoff after fixing the CLI.',
        }
      : { valid: true };
  }
  if (kind === 'triage') {
    return card.assignee
      ? { valid: true }
      : {
          valid: false,
          reason: 'the card file still has no valid assignee decision. The card was left unassigned; fix the CLI and rerun the loop.',
        };
  }
  if (kind === 'verification') {
    return parseVerificationVerdict(card.activity ?? '', activityBaseline)
      ? { valid: true }
      : {
          valid: false,
          reason: 'no valid `VERIFY: PASS`, `VERIFY: FAIL: <reason>`, or `VERIFY: HUMAN: <reason>` line was appended to the card Activity. The verification result was not accepted; fix the agent instructions or CLI and rerun the verification handoff.',
        };
  }

  const terminal = parseTerminalCardStatus(card.activity ?? '', activityBaseline);
  if (!terminal.valid) {
    return {
      valid: false,
      reason: `${terminal.reason} The card was not advanced; rerun the implementation handoff after fixing the agent instructions or CLI.`,
    };
  }
  return { valid: true, terminalStatus: terminal.status };
}

export type TerminalCardStatus =
  | { readonly kind: 'done' }
  | { readonly kind: 'blocked'; readonly reason: string };

export type TerminalCardStatusParseResult =
  | { readonly valid: true; readonly status: TerminalCardStatus }
  | { readonly valid: false; readonly reason: string };

/**
 * Read only status lines appended after this hand-off started. Old markers can
 * never complete a new run, and BLOCKED is valid only with a concrete reason.
 */
export function parseTerminalCardStatus(
  activity: string,
  activityBaseline: number,
): TerminalCardStatusParseResult {
  if (activityBaseline < 0 || activityBaseline > activity.length) {
    return { valid: false, reason: 'the card Activity was replaced instead of appended and has no trustworthy terminal status.' };
  }
  const appended = activity.slice(activityBaseline);
  const statusLines = appended
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^STATUS:/i.test(line));
  const statusLine = statusLines.at(-1);
  if (!statusLine) {
    return { valid: false, reason: 'no terminal `STATUS: DONE` or `STATUS: BLOCKED: <reason>` line was appended to the card Activity.' };
  }
  if (/^STATUS:\s*DONE(?:\s+(?:—|-).*)?$/i.test(statusLine)) {
    return { valid: true, status: { kind: 'done' } };
  }
  const blocked = /^STATUS:\s*BLOCKED:\s*(.+)$/i.exec(statusLine);
  if (blocked?.[1]?.trim()) {
    return { valid: true, status: { kind: 'blocked', reason: blocked[1].trim() } };
  }
  return {
    valid: false,
    reason: `the appended terminal status "${statusLine}" is invalid; use exactly \`STATUS: DONE\` or \`STATUS: BLOCKED: <reason>\`.`,
  };
}

function findCard(state: BoardState, cardId: string): Card | undefined {
  for (const column of state.columns) {
    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      return card;
    }
  }
  return undefined;
}

async function appendIfCardExists(
  store: AgentCliHandoffStore,
  cardId: string,
  entry: string,
): Promise<void> {
  if (findCard(await store.reload(), cardId)) {
    await store.appendActivity(cardId, entry);
  }
}

export function formatAgentCliStartEntry(
  providerLabel: string,
  kind: AgentCliHandoffKind,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - ${providerLabel} ${kind} handoff started`,
    `Started ${providerLabel} in the active workspace and waiting for card-file completion evidence.`,
  ].join('\n');
}

export function formatAgentCliFailureEntry(
  providerLabel: string,
  kind: AgentCliHandoffKind,
  reason: string,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - ${providerLabel} ${kind} handoff failed`,
    reason,
  ].join('\n');
}

export function formatAgentCliCancellationEntry(
  providerLabel: string,
  kind: AgentCliHandoffKind,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - ${providerLabel} ${kind} handoff cancelled`,
    'The active CLI process was stopped. The card was not advanced and remains assigned for a recoverable retry.',
  ].join('\n');
}
