/**
 * Pure Cursor Agent CLI `stream-json` helpers: turn NDJSON events into readable
 * channel lines, and expand the same events into plain text for scanners
 * (credit exhaustion, model rejection, exit summaries, usage lines).
 *
 * No vscode / Node child_process imports — unit-testable in isolation.
 */

export interface CursorStreamJsonRenderer {
  /** Feed a raw stdout chunk; returns newly completed readable lines. */
  write(chunk: string): readonly string[];
  /** Emit any buffered assistant text and incomplete line. */
  flush(): readonly string[];
}

interface JsonObject {
  readonly [key: string]: unknown;
}

/**
 * Stateful renderer for Cursor `--output-format stream-json` (optionally with
 * `--stream-partial-output`). Raw JSON never leaves this module as an output
 * line; non-JSON lines pass through unchanged.
 */
export function createCursorStreamJsonRenderer(): CursorStreamJsonRenderer {
  let lineBuffer = '';
  let assistantBuffer = '';
  /** True once a `--stream-partial-output` text delta has been seen this run. */
  let seenPartialDelta = false;

  const emitAssistantLines = (forceRemainder: boolean): string[] => {
    if (!assistantBuffer) {
      return [];
    }
    const parts = assistantBuffer.split(/\r\n|\r|\n/);
    if (!forceRemainder) {
      assistantBuffer = parts.pop() ?? '';
      return parts.filter((part) => part.length > 0);
    }
    assistantBuffer = '';
    return parts.filter((part) => part.length > 0);
  };

  const handleLine = (line: string): string[] => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
      const flushed = emitAssistantLines(true);
      return trimmed.length === 0 ? flushed : [...flushed, line];
    }

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      const flushed = emitAssistantLines(true);
      return [...flushed, line];
    }

    if (!isObject(event) || typeof event.type !== 'string') {
      const flushed = emitAssistantLines(true);
      return [...flushed, line];
    }

    return renderEvent(event, {
      appendAssistant: (text) => {
        seenPartialDelta = true;
        assistantBuffer += text;
        return emitAssistantLines(false);
      },
      flushAssistant: () => emitAssistantLines(true),
      hasSeenPartialDelta: () => seenPartialDelta,
    });
  };

  return {
    write(chunk) {
      const segments = `${lineBuffer}${chunk}`.split(/\r\n|\r|\n/);
      lineBuffer = segments.pop() ?? '';
      const out: string[] = [];
      for (const segment of segments) {
        out.push(...handleLine(segment));
      }
      return out;
    },
    flush() {
      const out: string[] = [];
      if (lineBuffer) {
        out.push(...handleLine(lineBuffer));
        lineBuffer = '';
      }
      out.push(...emitAssistantLines(true));
      return out;
    },
  };
}

interface AssistantSink {
  appendAssistant(text: string): readonly string[];
  flushAssistant(): readonly string[];
  hasSeenPartialDelta(): boolean;
}

function renderEvent(event: JsonObject, sink: AssistantSink): string[] {
  switch (event.type) {
    case 'assistant':
      return renderAssistant(event, sink);
    case 'tool_call': {
      const flushed = [...sink.flushAssistant()];
      const summary = summarizeToolCall(event);
      return summary ? [...flushed, summary] : flushed;
    }
    case 'result': {
      const flushed = [...sink.flushAssistant()];
      const summary = summarizeResult(event);
      return summary ? [...flushed, summary] : flushed;
    }
    case 'system':
    case 'user':
    case 'thinking':
      // Noise for the channel; model discovery reads raw stdout separately.
      return [];
    default:
      // Unknown event types are skipped without throwing.
      return [];
  }
}

function renderAssistant(event: JsonObject, sink: AssistantSink): string[] {
  // With `--stream-partial-output`, only deltas that carry timestamp_ms and no
  // model_call_id are new text. Buffered flushes (timestamp + model_call_id, or
  // neither after a partial was seen) duplicate earlier deltas and must be skipped.
  const hasTimestamp = event.timestamp_ms !== undefined;
  const hasModelCallId = event.model_call_id !== undefined;
  if (hasTimestamp && !hasModelCallId) {
    const text = assistantText(event);
    return text ? [...sink.appendAssistant(text)] : [];
  }
  if (hasTimestamp || hasModelCallId || sink.hasSeenPartialDelta()) {
    return [];
  }

  // Without partial streaming, each assistant event is one complete segment.
  const text = assistantText(event);
  if (!text) {
    return [];
  }
  const flushed = sink.flushAssistant();
  const lines = text.split(/\r\n|\r|\n/).filter((part) => part.length > 0);
  return [...flushed, ...lines];
}

function assistantText(event: JsonObject): string {
  const message = isObject(event.message) ? event.message : undefined;
  const content = message?.content;
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const block of content) {
    if (isObject(block) && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

function summarizeToolCall(event: JsonObject): string | undefined {
  const toolCall = isObject(event.tool_call) ? event.tool_call : undefined;
  if (!toolCall) {
    return undefined;
  }

  // Prefer the start event so the channel shows work as it begins.
  if (event.subtype === 'completed') {
    return undefined;
  }

  if (isObject(toolCall.readToolCall)) {
    const path = toolArgPath(toolCall.readToolCall);
    return path ? `→ Read ${path}` : '→ Read file';
  }
  if (isObject(toolCall.writeToolCall)) {
    const path = toolArgPath(toolCall.writeToolCall);
    return path ? `→ Write ${path}` : '→ Write file';
  }
  if (isObject(toolCall.editToolCall) || isObject(toolCall.strReplaceToolCall)) {
    const body = toolCall.editToolCall ?? toolCall.strReplaceToolCall;
    const path = isObject(body) ? toolArgPath(body) : undefined;
    return path ? `→ Edit ${path}` : '→ Edit file';
  }
  if (isObject(toolCall.deleteToolCall)) {
    const path = toolArgPath(toolCall.deleteToolCall);
    return path ? `→ Delete ${path}` : '→ Delete file';
  }
  if (isObject(toolCall.shellToolCall) || isObject(toolCall.BashToolCall)) {
    const body = toolCall.shellToolCall ?? toolCall.BashToolCall;
    const command = isObject(body) ? toolArgCommand(body) : undefined;
    return command ? `→ Run ${truncateToolArg(command)}` : '→ Run shell command';
  }
  if (isObject(toolCall.grepToolCall)) {
    return '→ Grep';
  }
  if (isObject(toolCall.globToolCall) || isObject(toolCall.lsToolCall)) {
    return isObject(toolCall.globToolCall) ? '→ Glob' : '→ List directory';
  }
  if (isObject(toolCall.function)) {
    const name = typeof toolCall.function.name === 'string' ? toolCall.function.name : 'tool';
    return `→ ${name}`;
  }

  const keys = Object.keys(toolCall);
  if (keys.length === 0) {
    return '→ Tool call';
  }
  const key = keys[0] ?? 'tool';
  return `→ ${key.replace(/ToolCall$/, '')}`;
}

function toolArgPath(body: JsonObject): string | undefined {
  const args = isObject(body.args) ? body.args : body;
  for (const key of ['path', 'filePath', 'file_path', 'target']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function toolArgCommand(body: JsonObject): string | undefined {
  const args = isObject(body.args) ? body.args : body;
  for (const key of ['command', 'cmd', 'script']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function truncateToolArg(value: string, max = 100): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function summarizeResult(event: JsonObject): string | undefined {
  const durationMs = typeof event.duration_ms === 'number' ? event.duration_ms : undefined;
  const duration =
    durationMs !== undefined && Number.isFinite(durationMs)
      ? ` in ${formatDuration(durationMs)}`
      : '';
  const isError = event.is_error === true || event.subtype === 'error';
  if (isError) {
    const detail = typeof event.result === 'string' ? event.result.trim() : '';
    const short = detail ? `: ${truncateToolArg(detail, 200)}` : '';
    return `✗ Failed${duration}${short}`;
  }
  return `✓ Completed${duration}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

/**
 * Expand Cursor (or Claude-shaped) stream-json stdout into plain lines that
 * credit / rejection / usage / exit-summary scanners can match. Non-JSON lines
 * and stderr-style text pass through unchanged. System/user metadata is
 * dropped so scanners do not match noise inside JSON keys.
 */
export function expandCursorStreamJsonOutput(output: string): string {
  if (!output) {
    return '';
  }
  const lines: string[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) {
      if (raw.length > 0) {
        lines.push(raw);
      }
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      lines.push(raw);
      continue;
    }
    if (!isObject(event) || typeof event.type !== 'string') {
      lines.push(raw);
      continue;
    }
    lines.push(...scanTextsFromEvent(event));
  }
  return lines.join('\n');
}

function scanTextsFromEvent(event: JsonObject): string[] {
  switch (event.type) {
    case 'assistant': {
      const text = assistantText(event);
      return text ? text.split(/\r?\n/).filter((part) => part.length > 0) : [];
    }
    case 'result': {
      const texts: string[] = [];
      if (typeof event.result === 'string' && event.result.trim()) {
        texts.push(event.result.trim());
      }
      if (typeof event.error === 'string' && event.error.trim()) {
        texts.push(event.error.trim());
      }
      return texts;
    }
    case 'tool_call': {
      // Tool payloads can embed error strings scanners care about.
      const serialized = JSON.stringify(event.tool_call ?? {});
      return serialized.length > 2 ? [serialized] : [];
    }
    default:
      return [];
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
