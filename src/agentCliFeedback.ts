/**
 * Pure helpers that turn raw agent-CLI process output into user-facing
 * feedback: complete lines for the output channel, and a throttled "latest
 * status line" for progress text and the board UI. No vscode imports so the
 * logic stays unit-testable; extension.ts owns the actual surfaces.
 */

import type {
  AgentCliHandoffKind,
  AgentCliInvocation,
  AgentCliProcessResult,
} from './agentCliHandoff';

/** Ticker/progress text stays a single short line. */
const MAX_STATUS_LINE_LENGTH = 120;
/** Command-line echo keeps each argument readable; prompts are elided. */
const MAX_COMMAND_ARGUMENT_LENGTH = 60;
const DEFAULT_STATUS_INTERVAL_MS = 300;

export type CliOutputStream = 'stdout' | 'stderr';

export interface CliOutputFeedDeps {
  /** Receives every complete output line with its terminator stripped. */
  readonly onLine?: (line: string, stream: CliOutputStream) => void;
  /**
   * Receives the latest non-empty output line, throttled so rapid CLI output
   * does not flood progress notifications or webview messages.
   */
  readonly onStatus?: (line: string) => void;
  readonly statusIntervalMs?: number;
  readonly now?: () => number;
}

export interface CliOutputFeed {
  write(chunk: string, stream: CliOutputStream): void;
  /** Emit any buffered partial line and the freshest pending status line. */
  flush(): void;
}

/**
 * Split streamed chunks into lines. `\r\n`, `\n`, and lone `\r` all end a
 * line, so CLIs that redraw progress with carriage returns still produce
 * status updates instead of one endless line.
 */
export function createCliOutputFeed(deps: CliOutputFeedDeps = {}): CliOutputFeed {
  const interval = deps.statusIntervalMs ?? DEFAULT_STATUS_INTERVAL_MS;
  const now = deps.now ?? Date.now;
  const partial: Record<CliOutputStream, string> = { stdout: '', stderr: '' };
  let pendingStatus: string | undefined;
  let lastStatusAt = Number.NEGATIVE_INFINITY;

  const noteStatus = (line: string): void => {
    const status = truncateStatusLine(line);
    if (!status) {
      return;
    }
    const at = now();
    if (at - lastStatusAt < interval) {
      pendingStatus = status;
      return;
    }
    lastStatusAt = at;
    pendingStatus = undefined;
    deps.onStatus?.(status);
  };

  return {
    write(chunk, stream) {
      const segments = `${partial[stream]}${chunk}`.split(/\r\n|\r|\n/);
      partial[stream] = segments.pop() ?? '';
      for (const line of segments) {
        deps.onLine?.(line, stream);
        noteStatus(line);
      }
      // A CLI can sit on an unterminated line (e.g. a spinner); let the
      // ticker advance from the partial without emitting it as a full line.
      noteStatus(partial[stream]);
    },
    flush() {
      for (const stream of ['stdout', 'stderr'] as const) {
        const rest = partial[stream];
        partial[stream] = '';
        if (rest) {
          deps.onLine?.(rest, stream);
          const status = truncateStatusLine(rest);
          if (status) {
            pendingStatus = status;
          }
        }
      }
      if (pendingStatus !== undefined) {
        const status = pendingStatus;
        pendingStatus = undefined;
        lastStatusAt = now();
        deps.onStatus?.(status);
      }
    },
  };
}

/** Collapse whitespace and cap length so a line fits status-bar-sized text. */
export function truncateStatusLine(line: string, max = MAX_STATUS_LINE_LENGTH): string {
  const flat = line.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Heading lines written to the output channel when a handoff process starts.
 * The prompt argument is elided: it is already recorded on the card, and
 * echoing it verbatim would drown the live output.
 */
export function formatCliRunStart(
  invocation: AgentCliInvocation,
  kind: AgentCliHandoffKind,
  cardTitle: string,
): readonly string[] {
  return [
    `▶ ${invocation.label} — ${kind} — "${cardTitle}"`,
    `  ${formatCliCommandLine(invocation)}`,
    `  cwd: ${invocation.cwd}`,
  ];
}

export function formatCliCommandLine(invocation: AgentCliInvocation): string {
  const args = invocation.args.map((arg) => {
    const flat = arg.replace(/\s+/g, ' ').trim();
    return flat.length <= MAX_COMMAND_ARGUMENT_LENGTH
      ? flat
      : `${flat.slice(0, MAX_COMMAND_ARGUMENT_LENGTH - 1)}… [${arg.length} chars]`;
  });
  return [invocation.command, ...args].join(' ');
}

/** Footer line written to the output channel when the process ends. */
export function formatCliRunExit(result: AgentCliProcessResult): string {
  if (result.cancelled) {
    return '■ Stopped by the user before the CLI finished.';
  }
  if (!result.started) {
    return `■ Failed to start: ${result.error ?? 'the operating system rejected the process start'}.`;
  }
  if (result.error) {
    return `■ Failed while running: ${result.error}.`;
  }
  if (result.exitCode === 0) {
    return '■ Exited with code 0.';
  }
  const status = result.signal
    ? `signal ${result.signal}`
    : `exit code ${result.exitCode === null ? 'unknown' : result.exitCode}`;
  return `■ Ended with ${status}.`;
}
