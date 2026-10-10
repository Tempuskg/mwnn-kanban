/**
 * Discover the model a single agent CLI dispatch reports that it used.
 *
 * Evidence is provider-specific and deliberately narrow:
 * - Copilot CLI's documented non-silent programmatic output, when it prints an
 *   explicit `Model: ...` / `Using model: ...` line.
 * - Claude Code and Cursor Agent's documented stream-JSON `system.init.model`
 *   field, plus their documented assistant/result model fields when emitted.
 * - Codex `exec --json` supplies a thread id but not a model. For that thread,
 *   inspect its matching local rollout `session_meta` / `turn_context` records.
 *
 * Output schemas evolve. Unknown, absent, malformed, or compressed metadata is
 * reported as unavailable; this module never infers a model from settings,
 * argv, model catalogs, response text, or another process's session.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentCliProviderId } from './agentCliProviders';

export interface AgentCliActualModelEvidence {
  readonly model: string;
  /** Stable description of the authoritative field or output used. */
  readonly source: string;
}

export type AgentCliModelDiscoveryOutcome =
  | { readonly kind: 'observed'; readonly evidence: AgentCliActualModelEvidence }
  | { readonly kind: 'unavailable'; readonly reason: string };

export interface AgentCliModelDiscoveryProcessEnd {
  /** Undefined only when the process runner threw before reporting its state. */
  readonly started?: boolean;
  readonly cancelled: boolean;
  readonly exitCode: number | null;
  readonly error?: string;
  readonly rejectedSelection?: boolean;
}

export interface AgentCliModelDiscoveryOptions {
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly codexHome?: string;
  readonly now?: () => Date;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly onEvidence: (evidence: AgentCliActualModelEvidence) => void;
}

export interface AgentCliModelDiscoverySession {
  /** Feed raw process chunks; line framing is handled internally. */
  onOutput(chunk: string, stream: 'stdout' | 'stderr'): void;
  /** Finish without blocking on the background Codex metadata watcher. */
  finish(processEnd: AgentCliModelDiscoveryProcessEnd): Promise<AgentCliModelDiscoveryOutcome>;
}

const DEFAULT_CODEX_MODEL_DISCOVERY_TIMEOUT_MS = 120_000;
const DEFAULT_CODEX_MODEL_POLL_INTERVAL_MS = 2_000;
const MAX_CODEX_ROLLOUT_FILES_PER_DAY = 2_000;
const MAX_CODEX_ROLLOUT_BYTES_PER_POLL = 1024 * 1024;
const MAX_CODEX_ROLLOUT_BYTES_TOTAL = 32 * 1024 * 1024;
const MAX_CODEX_METADATA_READ_MS = 500;
const MAX_CODEX_METADATA_LINE_BYTES = 256 * 1024;

type JsonObject = Record<string, unknown>;

interface CodexRolloutCursor {
  offset: number;
  pending: Buffer;
  /**
   * True while the most recent `session_meta` in this file named the thread.
   * Codex writes `turn_context` (the only record carrying the model) without
   * any thread identity, so it is attributed to the preceding session_meta.
   */
  inMatchingSession: boolean;
}

/**
 * Build one independent discovery session per process attempt. Instances do
 * not share transcript ids, partial lines, model values, or timeout state.
 */
export function createAgentCliModelDiscovery(
  provider: AgentCliProviderId,
  options: AgentCliModelDiscoveryOptions,
): AgentCliModelDiscoverySession {
  const pending = { stdout: '', stderr: '' };
  let latest: AgentCliActualModelEvidence | undefined;
  let malformedMetadata = false;
  let threadId: string | undefined;
  let stopped = false;
  let codexTimedOut = false;
  let codexCompressed = false;
  let codexScanLimited = false;
  let codexReadLimitReached = false;
  let codexReadTimedOut = false;
  let finished = false;
  let codexBytesRead = 0;
  let codexWatch: Promise<void> | undefined;
  const codexRolloutCursors = new Map<string, CodexRolloutCursor>();
  const startedAt = Date.now();
  const pollIntervalMs = Math.max(20, options.pollIntervalMs ?? DEFAULT_CODEX_MODEL_POLL_INTERVAL_MS);
  const timeoutMs = Math.max(20, options.timeoutMs ?? DEFAULT_CODEX_MODEL_DISCOVERY_TIMEOUT_MS);

  const emit = (rawModel: unknown, source: string): void => {
    if (finished) {
      return;
    }
    if (typeof rawModel !== 'string') {
      malformedMetadata = true;
      return;
    }
    const model = rawModel.trim();
    const containsControlCharacter = [...model].some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    });
    if (!model || /[\r\n]/.test(model) || containsControlCharacter) {
      malformedMetadata = true;
      return;
    }
    if (latest?.model === model) {
      return;
    }
    latest = { model, source };
    options.onEvidence(latest);
  };

  const parseLine = (line: string): void => {
    if (!line.trim()) {
      return;
    }
    if (provider === 'copilot') {
      parseCopilotOutputLine(line, emit, () => { malformedMetadata = true; });
      return;
    }
    if (!line.trimStart().startsWith('{')) {
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      // Treat only an attempted structured record as malformed metadata. Other
      // CLI progress text is not a model-discovery failure.
      if (/"(?:type|subtype)"\s*:/.test(line)) {
        malformedMetadata = true;
      }
      return;
    }
    if (!isObject(value)) {
      return;
    }

    if (provider === 'codex') {
      parseCodexEvent(value, emit, (id) => {
        if (!threadId && isCodexThreadId(id)) {
          threadId = id;
          startCodexWatcher();
        }
      }, () => { malformedMetadata = true; });
      return;
    }

    if (provider === 'claude-code') {
      parseClaudeCodeEvent(value, emit, () => { malformedMetadata = true; });
      return;
    }
    parseCursorEvent(value, emit, () => { malformedMetadata = true; });
  };

  const onOutput = (chunk: string, stream: 'stdout' | 'stderr'): void => {
    const text = pending[stream] + chunk;
    const lines = text.split(/\r?\n/);
    pending[stream] = lines.pop() ?? '';
    for (const line of lines) {
      parseLine(line);
    }
    // A broken CLI must not retain unbounded output in this observer.
    if (pending[stream].length > 256 * 1024) {
      pending[stream] = '';
      malformedMetadata = true;
    }
  };

  const startCodexWatcher = (): void => {
    if (provider !== 'codex' || !threadId || codexWatch) {
      return;
    }
    const activeThread = threadId;
    codexWatch = (async () => {
      while (!stopped && !options.signal.aborted) {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= timeoutMs) {
          codexTimedOut = !latest;
          return;
        }
        const inspectedBytes = await bounded(inspectCodexRollout(activeThread, options, emit, codexRolloutCursors, {
          maxBytes: Math.min(MAX_CODEX_ROLLOUT_BYTES_PER_POLL, MAX_CODEX_ROLLOUT_BYTES_TOTAL - codexBytesRead),
          shouldStop: () => stopped || options.signal.aborted,
          onMalformed: () => {
            malformedMetadata = true;
          },
          onCompressed: () => { codexCompressed = true; },
          onScanLimit: () => { codexScanLimited = true; },
        }), MAX_CODEX_METADATA_READ_MS);
        if (inspectedBytes === undefined) {
          codexReadTimedOut = true;
          return;
        }
        const bytesRead = inspectedBytes;
        codexBytesRead += bytesRead;
        if (codexBytesRead >= MAX_CODEX_ROLLOUT_BYTES_TOTAL) {
          codexReadLimitReached = true;
          return;
        }
        if (stopped || options.signal.aborted) {
          return;
        }
        const remaining = timeoutMs - (Date.now() - startedAt);
        if (remaining <= 0) {
          codexTimedOut = !latest;
          return;
        }
        await delay(Math.min(pollIntervalMs, remaining), options.signal);
      }
    })().catch(() => {
      if (!finished) {
        malformedMetadata = true;
      }
    });
  };

  const finish = async (
    processEnd: AgentCliModelDiscoveryProcessEnd,
  ): Promise<AgentCliModelDiscoveryOutcome> => {
    for (const stream of ['stdout', 'stderr'] as const) {
      if (pending[stream]) {
        parseLine(pending[stream]);
        pending[stream] = '';
      }
    }
    stopped = true;
    if (provider === 'codex' && threadId) {
      // The rollout can be flushed just as the process exits. Make one final
      // short bounded read, then detach from the watcher.
      if (codexWatch) {
        const watcherSettled = await bounded(codexWatch.then(() => true), pollIntervalMs + MAX_CODEX_METADATA_READ_MS);
        if (watcherSettled === undefined) {
          codexReadTimedOut = true;
          finished = true;
        }
      }
      if (!finished) {
        const bytesRemaining = MAX_CODEX_ROLLOUT_BYTES_TOTAL - codexBytesRead;
        const finalRead = await bounded(inspectCodexRollout(threadId, options, emit, codexRolloutCursors, {
          maxBytes: Math.min(MAX_CODEX_ROLLOUT_BYTES_PER_POLL, bytesRemaining),
          flushPartialLine: true,
          shouldStop: () => options.signal.aborted,
          onMalformed: () => { malformedMetadata = true; },
          onCompressed: () => { codexCompressed = true; },
          onScanLimit: () => { codexScanLimited = true; },
        }), MAX_CODEX_METADATA_READ_MS);
        if (finalRead === undefined) {
          codexReadTimedOut = true;
        } else {
          codexBytesRead += finalRead;
          if (codexBytesRead >= MAX_CODEX_ROLLOUT_BYTES_TOTAL) {
            codexReadLimitReached = true;
          }
        }
      }
    }
    finished = true;
    if (latest) {
      return { kind: 'observed', evidence: latest };
    }
    return {
      kind: 'unavailable',
      reason: unavailableReason(provider, processEnd, {
        malformedMetadata,
        codexTimedOut,
        codexCompressed,
        codexScanLimited,
        codexReadLimitReached,
        codexReadTimedOut,
        sawCodexThread: threadId !== undefined,
      }),
    };
  };

  return { onOutput, finish };
}

function parseCopilotOutputLine(
  line: string,
  emit: (model: unknown, source: string) => void,
  markMalformed: () => void,
): void {
  // Copilot documents that non-silent programmatic output includes the model
  // used for the response. Accept only an explicit model label; never infer it
  // from assistant prose or a requested model argument.
  const match = /^\s*(?:model(?:\s+used)?|selected\s+model|using\s+model)\s*[:=]\s*(.*?)\s*$/i.exec(line);
  if (!match) {
    return;
  }
  const model = match[1]?.trim();
  if (!model) {
    markMalformed();
    return;
  }
  emit(model, 'Copilot CLI non-silent programmatic output model label');
}

function parseClaudeCodeEvent(
  event: JsonObject,
  emit: (model: unknown, source: string) => void,
  markMalformed: () => void,
): void {
  if (event.type === 'system' && event.subtype === 'init') {
    if (typeof event.model === 'string') {
      emit(event.model, 'Claude Code stream-json system.init.model');
    } else {
      markMalformed();
    }
    return;
  }
  if (event.type === 'assistant') {
    const message = isObject(event.message) ? event.message : undefined;
    if (message && 'model' in message) {
      emit(message.model, 'Claude Code stream-json assistant.message.model');
    }
    return;
  }
  if (event.type === 'result' && 'model' in event) {
    emit(event.model, 'Claude Code stream-json result.model');
  }
}

function parseCursorEvent(
  event: JsonObject,
  emit: (model: unknown, source: string) => void,
  markMalformed: () => void,
): void {
  if (event.type === 'system' && event.subtype === 'init') {
    if (typeof event.model === 'string') {
      emit(event.model, 'Cursor Agent stream-json system.init.model');
    } else {
      markMalformed();
    }
    return;
  }
  if (event.type === 'assistant') {
    const message = isObject(event.message) ? event.message : undefined;
    if (message && 'model' in message) {
      emit(message.model, 'Cursor Agent stream-json assistant.message.model');
    }
    return;
  }
  if (event.type === 'result' && 'model' in event) {
    emit(event.model, 'Cursor Agent stream-json result.model');
  }
}

function parseCodexEvent(
  event: JsonObject,
  emit: (model: unknown, source: string) => void,
  setThreadId: (id: string) => void,
  markMalformed: () => void,
): void {
  if (event.type === 'thread.started') {
    if (typeof event.thread_id === 'string') {
      setThreadId(event.thread_id);
    } else {
      markMalformed();
    }
    if ('model' in event) {
      emit(event.model, 'Codex exec --json thread.started.model');
    }
    return;
  }
  // Newer Codex builds may add an authoritative model field to a structured
  // event. Keep this allowlist tied to the exec protocol rather than scanning
  // arbitrary nested output for a key named "model".
  if (event.type === 'model.selected' && 'model' in event) {
    emit(event.model, 'Codex exec --json model.selected.model');
  }
}

async function inspectCodexRollout(
  threadId: string,
  options: AgentCliModelDiscoveryOptions,
  emit: (model: unknown, source: string) => void,
  cursors: Map<string, CodexRolloutCursor>,
  limits: {
    readonly maxBytes: number;
    readonly flushPartialLine?: boolean;
    readonly shouldStop?: () => boolean;
    readonly onMalformed: () => void;
    readonly onCompressed: () => void;
    readonly onScanLimit: () => void;
  },
): Promise<number> {
  if (limits.shouldStop?.()) {
    return 0;
  }
  const root = options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
  const rollout = await findCodexRollout(root, threadId, options.now?.() ?? new Date(), limits.shouldStop);
  if (rollout.kind === 'compressed') {
    limits.onCompressed();
    return 0;
  }
  if (rollout.kind === 'scan-limit') {
    limits.onScanLimit();
    return 0;
  }
  if (rollout.kind !== 'file') {
    return 0;
  }
  if (limits.maxBytes <= 0) {
    return 0;
  }
  if (limits.shouldStop?.()) {
    return 0;
  }

  const cursor = cursors.get(rollout.path) ?? { offset: 0, pending: Buffer.alloc(0), inMatchingSession: false };
  const file = await fs.open(rollout.path, 'r');
  let bytesRead = 0;
  try {
    const stat = await file.stat();
    if (stat.size < cursor.offset) {
      cursor.offset = 0;
      cursor.pending = Buffer.alloc(0);
      cursor.inMatchingSession = false;
    }
    const amount = Math.min(stat.size - cursor.offset, limits.maxBytes);
    if (amount > 0) {
      const buffer = Buffer.allocUnsafe(amount);
      const read = await file.read(buffer, 0, amount, cursor.offset);
      bytesRead = read.bytesRead;
      cursor.offset += bytesRead;
      const contents = Buffer.concat([cursor.pending, buffer.subarray(0, bytesRead)]);
      let lineStart = 0;
      for (let index = 0; index < contents.length; index += 1) {
        if (contents[index] !== 0x0a) {
          continue;
        }
        let lineEnd = index;
        if (lineEnd > lineStart && contents[lineEnd - 1] === 0x0d) {
          lineEnd -= 1;
        }
        parseCodexRolloutLine(
          contents.subarray(lineStart, lineEnd),
          threadId,
          cursor,
          emit,
          limits.onMalformed,
        );
        lineStart = index + 1;
      }
      cursor.pending = Buffer.from(contents.subarray(lineStart));
      if (cursor.pending.length > MAX_CODEX_METADATA_LINE_BYTES) {
        cursor.pending = Buffer.alloc(0);
        limits.onMalformed();
      }
    }
    if (limits.flushPartialLine && cursor.pending.length > 0) {
      parseCodexRolloutLine(cursor.pending, threadId, cursor, emit, limits.onMalformed);
      cursor.pending = Buffer.alloc(0);
    }
  } finally {
    await file.close();
  }
  cursors.set(rollout.path, cursor);
  return bytesRead;
}

function parseCodexRolloutLine(
  bytes: Buffer,
  threadId: string,
  cursor: CodexRolloutCursor,
  emit: (model: unknown, source: string) => void,
  markMalformed: () => void,
): void {
  if (bytes.length > MAX_CODEX_METADATA_LINE_BYTES) {
    markMalformed();
    return;
  }
  const line = bytes.toString('utf8');
  if (!line.trim()) {
    return;
  }
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    if (/"type"\s*:\s*"(?:session_meta|turn_context)"/.test(line)) {
      markMalformed();
    }
    return;
  }
  if (!isObject(value)) {
    return;
  }
  const payload = isObject(value.payload) ? value.payload : undefined;
  if (!payload) {
    return;
  }
  if (value.type === 'session_meta') {
    cursor.inMatchingSession = codexPayloadBelongsToThread(payload, threadId);
    if (!cursor.inMatchingSession) {
      return;
    }
    const model = payload.model ?? payload.model_slug;
    if (model !== undefined) {
      emit(model, 'Codex rollout session_meta.payload.model');
    }
  } else if (value.type === 'turn_context') {
    // Real Codex turn_context records carry no thread identity. Accept one
    // inside this thread's session, and reject any that names another thread.
    const owned = codexPayloadHasIdentity(payload)
      ? codexPayloadBelongsToThread(payload, threadId)
      : cursor.inMatchingSession;
    if (!owned) {
      return;
    }
    const model = payload.model ?? payload.model_slug;
    if (model !== undefined) {
      emit(model, 'Codex rollout turn_context.payload.model');
    }
  }
}

function codexPayloadHasIdentity(payload: JsonObject): boolean {
  return payload.id !== undefined || payload.thread_id !== undefined || payload.session_id !== undefined;
}

function codexPayloadBelongsToThread(payload: JsonObject, threadId: string): boolean {
  return payload.id === threadId || payload.thread_id === threadId || payload.session_id === threadId;
}

type CodexRolloutPath =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'compressed' }
  | { readonly kind: 'scan-limit' }
  | { readonly kind: 'missing' };

async function findCodexRollout(
  codexHome: string,
  threadId: string,
  now: Date,
  shouldStop?: () => boolean,
): Promise<CodexRolloutPath> {
  const sessionsRoot = path.join(codexHome, 'sessions');
  let compressed = false;
  let scanLimited = false;
  for (let offset = 0; offset < 3; offset += 1) {
    const date = new Date(now.getTime() - offset * 86_400_000);
    const dayPath = path.join(
      sessionsRoot,
      String(date.getFullYear()).padStart(4, '0'),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    );
    let directory: Awaited<ReturnType<typeof fs.opendir>>;
    try {
      directory = await fs.opendir(dayPath);
    } catch {
      continue;
    }
    const suffix = `-${threadId}.jsonl`;
    const compressedSuffix = `${suffix}.zst`;
    try {
      let count = 0;
      while (count < MAX_CODEX_ROLLOUT_FILES_PER_DAY && !shouldStop?.()) {
        const entry = await directory.read();
        if (entry === null) {
          break;
        }
        count += 1;
        if (entry.name.endsWith(suffix) && entry.isFile()) {
          return { kind: 'file', path: path.join(dayPath, entry.name) };
        }
        if (entry.name.endsWith(compressedSuffix)) {
          compressed = true;
        }
      }
      if (count >= MAX_CODEX_ROLLOUT_FILES_PER_DAY && !shouldStop?.()) {
        scanLimited = true;
      }
    } catch {
      // Filesystem churn is a discovery limitation; the dispatch keeps running.
    } finally {
      await directory.close().catch(() => undefined);
    }
  }
  if (compressed) {
    return { kind: 'compressed' };
  }
  if (scanLimited) {
    return { kind: 'scan-limit' };
  }
  return { kind: 'missing' };
}

function unavailableReason(
  provider: AgentCliProviderId,
  processEnd: AgentCliModelDiscoveryProcessEnd,
  details: {
    readonly malformedMetadata: boolean;
    readonly codexTimedOut: boolean;
    readonly codexCompressed: boolean;
    readonly codexScanLimited: boolean;
    readonly codexReadLimitReached: boolean;
    readonly codexReadTimedOut: boolean;
    readonly sawCodexThread: boolean;
  },
): string {
  if (processEnd.started === false) {
    const detail = processEnd.error ? ` during invocation preparation (${processEnd.error})` : '';
    return `the CLI process did not start${detail}, so no model was used`;
  }
  if (processEnd.started === undefined) {
    return 'the process runner failed before reporting whether the CLI started, so the actual model could not be confirmed';
  }
  if (processEnd.cancelled) {
    return 'the dispatch was cancelled before authoritative model metadata became available';
  }
  if (processEnd.rejectedSelection) {
    return 'the CLI rejected the requested model before reporting a model that it used';
  }
  if (details.malformedMetadata) {
    if (provider === 'codex') {
      return 'Codex model discovery encountered missing, malformed, or unusable metadata in its JSONL output or matching local rollout';
    }
    return 'the CLI emitted model metadata that was missing, malformed, or had no valid model name';
  }
  if (provider === 'codex') {
    if (details.codexCompressed) {
      return 'the matching Codex rollout is compressed and this extension cannot read its model metadata';
    }
    if (details.codexScanLimited) {
      return 'Codex rollout lookup reached its ' + MAX_CODEX_ROLLOUT_FILES_PER_DAY + '-entry per-day safety limit';
    }
    if (details.codexReadLimitReached) {
      return 'Codex rollout reading reached its ' + Math.floor(MAX_CODEX_ROLLOUT_BYTES_TOTAL / (1024 * 1024)) + ' MiB per-attempt safety limit';
    }
    if (details.codexReadTimedOut) {
      return 'timed out during a bounded read of the matching Codex rollout metadata';
    }
    if (!details.sawCodexThread) {
      return 'Codex exec --json did not provide a thread.started thread_id for matching session metadata';
    }
    if (details.codexTimedOut) {
      return 'timed out waiting for the matching Codex rollout model metadata';
    }
    return 'Codex exec --json omits the model; the matching local rollout did not expose a model in session_meta or turn_context';
  }
  if (provider === 'copilot') {
    return 'Copilot CLI non-silent output did not include an explicit model label; this CLI version or selected agent may not expose it';
  }
  if (provider === 'claude-code') {
    return 'Claude Code stream-json output contained no nonempty system.init.model or assistant message model field';
  }
  return 'Cursor Agent stream-json output contained no nonempty system.init.model or assistant message model field';
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCodexThreadId(value: string): boolean {
  return /^[a-z0-9-]{16,80}$/i.test(value);
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T | undefined> {
  return Promise.race([
    promise.catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), milliseconds)),
  ]);
}
