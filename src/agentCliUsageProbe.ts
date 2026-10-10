/**
 * Usage probes for the Usage Orchestrator: ask each locally installed agent
 * CLI how much of its allowance is left.
 *
 * Every figure comes from the CLI itself - the extension opens no network
 * connection of its own. A probe never throws and never outlives its timeout:
 * any failure (unsupported version, non-ChatGPT account, malformed or hostile
 * output, nonzero exit, timeout) is an "unknown" snapshot with a redacted
 * reason, and the probe process has ended before the returned promise settles.
 *
 * Sources today:
 * - Codex: app-server JSON-RPC `account/rateLimits/read` over stdio.
 * - Claude Code: local `/usage` command in print mode, for the verified CLI
 *   version and accounts that expose subscription plan windows.
 * - Copilot: SDK JSON-RPC `account.getQuota` over the local CLI server.
 * - Cursor: no documented quota query; always unknown.
 *
 * No `vscode` import.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  terminateProcess,
  windowsLaunchCommand,
  type AgentCliTarget,
} from './agentCliHandoff';
import {
  parseClaudeCodeUsageOutput,
  parseCopilotQuota,
  parseCodexRateLimits,
  unknownUsage,
  type AgentCliUsageSnapshot,
} from './agentCliUsage';

/**
 * Default bound on one probe, including process start-up. Codex answers
 * `account/rateLimits/read` with a round trip to its own backend, which was
 * measured at 0.9-11 s, so 10 s timed out in real use.
 */
export const DEFAULT_USAGE_PROBE_TIMEOUT_MS = 20_000;

/** A probe that writes more than this is treated as hostile and stopped. */
const MAX_PROBE_OUTPUT = 1024 * 1024;

/** Grace period for the probe process to exit after it is told to stop. */
const PROBE_EXIT_GRACE_MS = 2_000;

export interface AgentCliUsageProbeOptions {
  readonly cwd: string;
  readonly timeoutMs?: number;
  /** Aborting stops the probe early; the result is "unknown". */
  readonly signal?: AbortSignal;
  /**
   * Test seam: the command and arguments to launch instead of the local CLI
   * server command. The JSON-RPC exchange is unchanged.
   */
  readonly launch?: { readonly command: string; readonly args: readonly string[] };
  /**
   * Test seam for Claude Code: a fake executable receives the actual CLI
   * arguments appended after this prefix.
   */
  readonly claudeLaunch?: { readonly command: string; readonly args: readonly string[] };
  /** Test seam: the clock used to judge reported reset times. */
  readonly now?: number;
}

export type AgentCliUsageProbe = (
  target: AgentCliTarget,
  options: AgentCliUsageProbeOptions,
) => Promise<AgentCliUsageSnapshot>;

/** Read one CLI's usage snapshot. Never throws. */
export const probeAgentCliUsage: AgentCliUsageProbe = async (target, options) => {
  switch (target.provider) {
    case 'codex':
      return probeCodexUsage(target, options);
    case 'cursor':
      return unknownUsage('cursor', 'Cursor Agent CLI shows usage only in its interactive /usage view; print mode sends /usage to the model, so usage cannot be read.');
    case 'claude-code':
      return probeClaudeCodeUsage(target, options);
    case 'copilot':
      return probeCopilotUsage(target, options);
  }
};

/**
 * Claude Code v2.1.295 and later expose subscription limits through the local
 * `/usage` command in non-interactive print mode. Probe the version first
 * because an older CLI release could treat `/usage` as a model prompt. The
 * `local_command: "usage"`, `num_turns: 0`, and `duration_api_ms: 0` envelope
 * checks confirm the command ran locally without a model turn.
 * The CLI owns all authentication and account-specific reads; this extension
 * never inspects its credentials or opens its own network connection.
 */
export async function probeClaudeCodeUsage(
  target: AgentCliTarget,
  options: AgentCliUsageProbeOptions,
): Promise<AgentCliUsageSnapshot> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_USAGE_PROBE_TIMEOUT_MS;
  if (options.signal?.aborted) {
    return unknownUsage('claude-code', 'The usage probe was cancelled.');
  }
  try {
    const deadline = Date.now() + timeoutMs;
    const versionResult = await runClaudeCliInvocation(target, ['--version'], options, deadline);
    if (versionResult.kind === 'failed') {
      return unknownUsage('claude-code', versionResult.reason);
    }
    if (versionResult.exitCode !== 0) {
      return unknownUsage(
        'claude-code',
        `Claude Code exited with code ${versionResult.exitCode} while checking its version.`,
      );
    }
    const versionMatch = /(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/.exec(versionResult.stdout.trim());
    const version = versionMatch?.[1];
    if (!version || compareVersions(version, MIN_CLAUDE_CODE_USAGE_VERSION) < 0) {
      return unknownUsage(
        'claude-code',
        version
          ? `Claude Code ${version} is unsupported for usage reads; ${MIN_CLAUDE_CODE_USAGE_VERSION} or later is required.`
          : `Claude Code returned an unrecognized version; ${MIN_CLAUDE_CODE_USAGE_VERSION} or later is required.`,
      );
    }

    const usageResult = await runClaudeCliInvocation(
      target,
      ['--print', '/usage', '--output-format', 'json', '--no-session-persistence'],
      options,
      deadline,
    );
    if (usageResult.kind === 'failed') {
      return unknownUsage('claude-code', usageResult.reason);
    }
    if (usageResult.exitCode !== 0) {
      return unknownUsage(
        'claude-code',
        `Claude Code exited with code ${usageResult.exitCode} before reporting usage.`,
      );
    }
    return parseClaudeCodeUsageOutput(usageResult.stdout, options.now);
  } catch (error: unknown) {
    return unknownUsage(
      'claude-code',
      `Claude Code usage probe failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Oldest release verified to run `/usage` locally; newer releases are trusted. */
const MIN_CLAUDE_CODE_USAGE_VERSION = '2.1.295';

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}
const CLAUDE_PROBE_EXIT_GRACE_MS = 1_000;

type ClaudeCliInvocationResult =
  | { readonly kind: 'completed'; readonly exitCode: number | null; readonly stdout: string }
  | { readonly kind: 'failed'; readonly reason: string };

function runClaudeCliInvocation(
  target: AgentCliTarget,
  cliArgs: readonly string[],
  options: AgentCliUsageProbeOptions,
  deadline: number,
): Promise<ClaudeCliInvocationResult> {
  const timeoutMs = Math.max(0, deadline - Date.now());
  if (timeoutMs === 0) {
    return Promise.resolve({ kind: 'failed', reason: 'Claude Code usage probe timed out.' });
  }
  if (options.signal?.aborted) {
    return Promise.resolve({ kind: 'failed', reason: 'The usage probe was cancelled.' });
  }

  const command = options.claudeLaunch?.command ?? target.executable;
  const args = options.claudeLaunch
    ? [...options.claudeLaunch.args, ...cliArgs]
    : [...cliArgs];

  return new Promise((resolve) => {
    let child: ChildProcess | undefined;
    let outcome: ClaudeCliInvocationResult | undefined;
    let exited = false;
    let resolved = false;
    let output = '';
    let received = 0;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (): void => {
      if (resolved || !outcome || !exited) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
      options.signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };

    const conclude = (failure: string): void => {
      if (outcome) {
        return;
      }
      outcome = { kind: 'failed', reason: failure };
      if (!child || exited) {
        exited = true;
        settle();
        return;
      }
      child.stdin?.end();
      terminateProcess(child);
      killTimer = setTimeout(() => {
        child?.kill('SIGKILL');
        child?.stdout?.destroy();
        child?.unref();
        exited = true;
        settle();
      }, CLAUDE_PROBE_EXIT_GRACE_MS);
    };

    const onAbort = (): void => conclude('The usage probe was cancelled.');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(
      () => conclude(`Claude Code did not report usage within ${Math.round(timeoutMs / 1000)}s.`),
      timeoutMs,
    );

    try {
      const launch = process.platform === 'win32'
        ? windowsLaunchCommand(command, args)
        : { command, args, windowsVerbatimArguments: false };
      child = spawn(launch.command, launch.args, {
        cwd: options.cwd,
        windowsHide: true,
        detached: process.platform !== 'win32',
        shell: false,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (error: unknown) {
      conclude(`Claude Code could not be started: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    child.once('error', (error) => {
      if (child?.pid === undefined) {
        exited = true;
      }
      conclude(`Claude Code could not be started: ${error.message}`);
    });
    child.once('close', (code) => {
      exited = true;
      outcome ??= { kind: 'completed', exitCode: code, stdout: output };
      settle();
    });
    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (outcome) {
        return;
      }
      const text = chunk.toString();
      received += Buffer.byteLength(text, 'utf8');
      if (received > MAX_PROBE_OUTPUT) {
        conclude('Claude Code wrote an unexpectedly large usage response; it was ignored.');
        return;
      }
      output += text;
    });
  });
}

/**
 * Start `codex app-server`, run `initialize` then `account/rateLimits/read`,
 * and stop the process. Only the request ids this client sent are answered;
 * notifications and anything else the server writes are ignored.
 */
export function probeCodexUsage(
  target: AgentCliTarget,
  options: AgentCliUsageProbeOptions,
): Promise<AgentCliUsageSnapshot> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_USAGE_PROBE_TIMEOUT_MS;
  const command = options.launch?.command ?? target.executable;
  const args = options.launch ? [...options.launch.args] : ['app-server'];
  if (options.signal?.aborted) {
    return Promise.resolve(unknownUsage('codex', 'The usage probe was cancelled.'));
  }

  return new Promise((resolve) => {
    let child: ChildProcess | undefined;
    let outcome: AgentCliUsageSnapshot | undefined;
    let exited = false;
    let resolved = false;
    let buffered = '';
    let received = 0;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (): void => {
      if (resolved || !outcome || !exited) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
      options.signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };

    /** Record the first outcome, then make sure the process is gone. */
    const conclude = (snapshot: AgentCliUsageSnapshot): void => {
      outcome ??= snapshot;
      if (!child || exited) {
        exited = true;
        settle();
        return;
      }
      if (killTimer !== undefined) {
        return;
      }
      child.stdin?.end();
      terminateProcess(child);
      killTimer ??= setTimeout(() => {
        // The process ignored termination; force it and stop waiting so a
        // probe can never hold a dispatch hostage.
        child?.kill('SIGKILL');
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        child?.unref();
        exited = true;
        settle();
      }, PROBE_EXIT_GRACE_MS);
    };

    const onAbort = (): void => conclude(unknownUsage('codex', 'The usage probe was cancelled.'));
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const timeout = setTimeout(() => {
      conclude(unknownUsage('codex', `Codex did not report usage within ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    const send = (message: unknown): void => {
      if (child?.stdin && !child.stdin.destroyed) {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      }
    };

    const handleMessage = (message: unknown): void => {
      if (typeof message !== 'object' || message === null || Array.isArray(message)) {
        return;
      }
      const record = message as Record<string, unknown>;
      if (record['method'] !== undefined) {
        // A notification or a server-initiated request; not ours to answer.
        return;
      }
      const error = record['error'];
      if (record['id'] === 1) {
        if (error !== undefined) {
          conclude(unknownUsage('codex', `This Codex version could not start its app-server: ${describeRpcError(error)}`));
          return;
        }
        send({ jsonrpc: '2.0', method: 'initialized' });
        send({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read' });
        return;
      }
      if (record['id'] === 2) {
        conclude(error !== undefined
          ? unknownUsage('codex', `Codex could not read usage (it is reported only for ChatGPT accounts): ${describeRpcError(error)}`)
          : parseCodexRateLimits(record['result']));
      }
    };

    try {
      const launch = process.platform === 'win32'
        ? windowsLaunchCommand(command, args)
        : { command, args, windowsVerbatimArguments: false };
      child = spawn(launch.command, launch.args, {
        cwd: options.cwd,
        windowsHide: true,
        detached: process.platform !== 'win32',
        shell: false,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      conclude(unknownUsage('codex', `Codex could not be started: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }

    child.once('error', (error) => {
      // A failed spawn has no pid and emits no 'close'; nothing is left to end.
      if (child?.pid === undefined) {
        exited = true;
      }
      conclude(unknownUsage('codex', `Codex could not be started: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      exited = true;
      // Reached only when the process ended before answering.
      conclude(unknownUsage(
        'codex',
        code !== null && code !== 0
          ? `Codex exited with code ${code} before reporting usage.`
          : `Codex ended${signal ? ` (${signal})` : ''} before reporting usage.`,
      ));
      settle();
    });
    // stderr is drained, never parsed or logged: it can carry anything.
    child.stderr?.on('data', () => undefined);
    child.stdin?.on('error', () => undefined);
    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (outcome) {
        return;
      }
      const text = chunk.toString();
      received += text.length;
      if (received > MAX_PROBE_OUTPUT) {
        conclude(unknownUsage('codex', 'Codex wrote an unexpectedly large usage response; it was ignored.'));
        return;
      }
      buffered += text;
      let newline = buffered.indexOf('\n');
      while (newline >= 0 && !outcome) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line.length > 0) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            parsed = undefined;
          }
          handleMessage(parsed);
        }
        newline = buffered.indexOf('\n');
      }
    });

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'mwnn-kanban', title: 'MWNN Kanban', version: '1' } },
    });
  });
}

const COPILOT_SDK_PROTOCOL_VERSION = 3;
const COPILOT_PROBE_EXIT_GRACE_MS = 2_000;
const COPILOT_MAX_HEADER_BYTES = 8 * 1024;

type CopilotRpcPhase = 'connect' | 'ping' | 'quota';

/**
 * Start the locally installed Copilot CLI in SDK stdio mode, complete the SDK
 * connect/ping compatibility handshake, and request only account quota. No
 * session is created, so no model turn can start. The response is accepted
 * only for the protocol version used by the official SDK contract.
 */
export function probeCopilotUsage(
  target: AgentCliTarget,
  options: AgentCliUsageProbeOptions,
): Promise<AgentCliUsageSnapshot> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_USAGE_PROBE_TIMEOUT_MS;
  if (options.signal?.aborted) {
    return Promise.resolve(unknownUsage('copilot', 'The usage probe was cancelled.'));
  }

  const serverLaunch = options.launch ?? copilotUsageLaunch(target);
  const command = serverLaunch.command;
  const args = [...serverLaunch.args];

  return new Promise((resolve) => {
    let child: ChildProcess | undefined;
    let outcome: AgentCliUsageSnapshot | undefined;
    let exited = false;
    let resolved = false;
    let buffered = Buffer.alloc(0);
    let received = 0;
    let requestId = 0;
    let phase: CopilotRpcPhase = 'connect';
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (): void => {
      if (resolved || !outcome || !exited) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
      options.signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };

    const conclude = (snapshot: AgentCliUsageSnapshot): void => {
      outcome ??= snapshot;
      if (!child || exited) {
        exited = true;
        settle();
        return;
      }
      if (killTimer !== undefined) {
        return;
      }
      child.stdin?.end();
      terminateProcess(child);
      killTimer = setTimeout(() => {
        child?.kill('SIGKILL');
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        child?.unref();
        exited = true;
        settle();
      }, COPILOT_PROBE_EXIT_GRACE_MS);
    };

    const onAbort = (): void => conclude(unknownUsage('copilot', 'The usage probe was cancelled.'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => {
      conclude(unknownUsage('copilot', `Copilot did not report usage within ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    const sendRequest = (nextPhase: CopilotRpcPhase, method: string, params: object): void => {
      phase = nextPhase;
      requestId += 1;
      const body = JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params });
      const frame = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
      if (!child?.stdin || child.stdin.destroyed) {
        conclude(unknownUsage('copilot', 'Copilot closed its usage connection before replying.'));
        return;
      }
      try {
        child.stdin.write(frame, 'utf8');
      } catch (error: unknown) {
        conclude(unknownUsage(
          'copilot',
          `Copilot usage request failed: ${error instanceof Error ? error.message : String(error)}`,
        ));
      }
    };

    const startQuotaRequest = (): void => {
      sendRequest('quota', 'account.getQuota', {});
    };

    const isConnectNotFound = (error: unknown): boolean => {
      if (!isRpcRecord(error)) {
        return false;
      }
      return error['code'] === -32601 || error['message'] === 'Unhandled method connect';
    };

    const handleMessage = (message: unknown): void => {
      if (!isRpcRecord(message)) {
        conclude(unknownUsage('copilot', 'Copilot returned a malformed SDK response.'));
        return;
      }
      if (typeof message['method'] === 'string') {
        if (message['id'] !== undefined) {
          conclude(unknownUsage('copilot', 'Copilot requested an unsupported SDK callback during the usage probe.'));
        }
        return;
      }
      if (message['id'] !== requestId) {
        return;
      }
      const rpcError = message['error'];
      if (rpcError !== undefined) {
        if (phase === 'connect' && isConnectNotFound(rpcError)) {
          sendRequest('ping', 'ping', {});
          return;
        }
        const description = phase === 'quota'
          ? 'Copilot could not read account quota'
          : 'Copilot CLI version is not supported for account quota reads';
        conclude(unknownUsage('copilot', `${description}: ${describeRpcError(rpcError)}`));
        return;
      }

      if (!Object.hasOwn(message, 'result')) {
        conclude(unknownUsage('copilot', 'Copilot returned an incomplete SDK response.'));
        return;
      }
      const result = message['result'];
      if (phase === 'quota') {
        conclude(parseCopilotQuota(result, options.now));
        return;
      }
      if (!isRpcRecord(result) || result['protocolVersion'] !== COPILOT_SDK_PROTOCOL_VERSION) {
        conclude(unknownUsage(
          'copilot',
          `Copilot SDK protocol is unsupported; version ${COPILOT_SDK_PROTOCOL_VERSION} is required.`,
        ));
        return;
      }
      startQuotaRequest();
    };

    const parseFrames = (): void => {
      while (!outcome) {
        const headerEnd = buffered.indexOf('\r\n\r\n');
        if (headerEnd < 0) {
          if (buffered.length > COPILOT_MAX_HEADER_BYTES) {
            conclude(unknownUsage('copilot', 'Copilot returned an oversized or malformed SDK header.'));
          }
          return;
        }
        if (headerEnd > COPILOT_MAX_HEADER_BYTES) {
          conclude(unknownUsage('copilot', 'Copilot returned an oversized SDK header.'));
          return;
        }
        const headers = buffered.subarray(0, headerEnd).toString('ascii').split('\r\n');
        const contentLengthHeaders = headers.filter((header) => /^content-length\s*:/i.test(header));
        const contentLengthMatch = contentLengthHeaders.length === 1
          ? /^content-length\s*:\s*(\d+)\s*$/i.exec(contentLengthHeaders[0] ?? '')
          : null;
        const contentLength = contentLengthMatch?.[1] === undefined
          ? Number.NaN
          : Number(contentLengthMatch[1]);
        if (!Number.isSafeInteger(contentLength)
          || contentLength < 0
          || contentLength > MAX_PROBE_OUTPUT) {
          conclude(unknownUsage('copilot', 'Copilot returned an invalid SDK response length.'));
          return;
        }
        const frameLength = headerEnd + 4 + contentLength;
        if (buffered.length < frameLength) {
          return;
        }
        const payload = buffered.subarray(headerEnd + 4, frameLength).toString('utf8');
        buffered = buffered.subarray(frameLength);
        let message: unknown;
        try {
          message = JSON.parse(payload);
        } catch {
          conclude(unknownUsage('copilot', 'Copilot returned malformed SDK JSON.'));
          return;
        }
        handleMessage(message);
      }
    };

    try {
      const launch = process.platform === 'win32'
        ? windowsLaunchCommand(command, args)
        : { command, args, windowsVerbatimArguments: false };
      child = spawn(launch.command, launch.args, {
        cwd: options.cwd,
        windowsHide: true,
        detached: process.platform !== 'win32',
        shell: false,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      conclude(unknownUsage(
        'copilot',
        `Copilot CLI could not be started: ${error instanceof Error ? error.message : String(error)}`,
      ));
      return;
    }

    child.once('error', (error) => {
      if (child?.pid === undefined) {
        exited = true;
      }
      conclude(unknownUsage('copilot', `Copilot CLI could not be started: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      exited = true;
      outcome ??= unknownUsage(
        'copilot',
        code !== null && code !== 0
          ? `Copilot exited with code ${code} before reporting usage.`
          : `Copilot ended${signal ? ` (${signal})` : ''} before reporting usage.`,
      );
      settle();
    });
    child.stdin?.on('error', (error) => {
      conclude(unknownUsage('copilot', `Copilot usage connection failed: ${error.message}`));
    });
    child.stderr?.on('data', () => undefined);
    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (outcome) {
        return;
      }
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
      received += bytes.length;
      if (received > MAX_PROBE_OUTPUT) {
        conclude(unknownUsage('copilot', 'Copilot wrote an unexpectedly large usage response; it was ignored.'));
        return;
      }
      buffered = Buffer.concat([buffered, bytes]);
      parseFrames();
    });

    if (options.signal?.aborted) {
      onAbort();
    } else {
      sendRequest('connect', 'connect', { supportedTaskKinds: ['agent', 'client', 'shell'] });
    }
  });
}

/** Build the SDK server command from the dispatch-resolved Copilot target. */
export function copilotUsageLaunch(
  target: AgentCliTarget,
): { readonly command: string; readonly args: readonly string[] } {
  return {
    command: target.executable,
    args: [
      ...(target.launcher === 'gh-copilot' ? ['copilot'] : []),
      '--headless',
      '--no-auto-update',
      '--stdio',
    ],
  };
}

function isRpcRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeRpcError(error: unknown): string {
  if (typeof error === 'object' && error !== null && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>)['message'];
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }
  return 'no detail given.';
}
