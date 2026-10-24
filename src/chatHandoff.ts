/**
 * Resolves which installed AI chat extension a card should be handed off to and
 * how to drive it. Providers differ in how the prompt is delivered:
 *   - 'query'      Copilot's workbench.action.chat.open takes a `{ query }`
 *                  argument; the prompt is injected straight into the chat input.
 *   - 'positional' Claude Code's editor open commands accept the prompt as a
 *                  positional `(sessionId, initialPrompt)` argument, so a new
 *                  conversation opens pre-filled with the prompt (in the
 *                  sidebar when that is Claude Code's preferred location).
 *   - 'clipboard'  The provider exposes an open command, so the prompt is
 *                  placed on the clipboard and pasted after its composer is
 *                  ready.
 */

export type ChatProviderId = 'copilot' | 'codex' | 'claude-code';

export type PromptDelivery = 'query' | 'positional' | 'clipboard';

export interface ChatHandoffTarget {
  readonly provider: ChatProviderId;
  readonly commandId: string;
  /** How the prompt reaches the chat for this command. */
  readonly promptDelivery: PromptDelivery;
  /** Optional command used to make the provider's host view ready first. */
  readonly prepareCommandId?: string;
}

export type ChatProviderCommands = Partial<Record<ChatProviderId, string>>;

export interface ClipboardHandoffExecutor {
  readonly writeClipboard: (prompt: string) => PromiseLike<void>;
  readonly readClipboard: () => PromiseLike<string>;
  readonly executeCommand: (commandId: string) => PromiseLike<unknown>;
  /** Activates the provider before its command is invoked, when available. */
  readonly activateProvider?: () => PromiseLike<void>;
  readonly wait: (delayMs: number) => Promise<void>;
}

export interface ClipboardHandoffOptions {
  readonly providerActivationTimeoutMs?: number;
  /** Startup allowance before requesting the new chat from a revealed provider. */
  readonly providerReadyDelayMs?: number;
  /** Time for the new-chat request to focus its composer. */
  readonly composerReadyDelayMs?: number;
  /** Allow the webview's asynchronous paste to consume the current clipboard. */
  readonly pasteSettleDelayMs?: number;
  /** Number of readbacks while waiting for the paste to appear in the composer. */
  readonly verificationMaxAttempts?: number;
  readonly verificationRetryDelayMs?: number;
}

export type ClipboardHandoffResult =
  | { readonly delivered: true }
  | { readonly delivered: false; readonly error: string; readonly unconfirmed?: true };

/** Resolve unavailable readback without treating it as either proven failure or success. */
export async function resolveClipboardHandoffResult(
  result: ClipboardHandoffResult,
  confirmPrompt: () => PromiseLike<boolean | undefined>,
  reportFailure: (reason: string) => void,
): Promise<boolean> {
  if (result.delivered) {
    return true;
  }
  if (!result.unconfirmed) {
    reportFailure(result.error);
    return false;
  }
  const confirmed = await confirmPrompt();
  if (confirmed === false) {
    reportFailure('the complete prompt was reported missing from the new-chat composer; it is still on your clipboard to paste manually');
  }
  return confirmed === true;
}

export type ChatHandoffAttempt<T> = { readonly started: true; readonly value: T } | { readonly started: false };

/** What kind of hand-off holds a card's lock; only interviews can be restarted. */
export type ChatHandoffKind = 'interview' | 'other';

/** Handed to a lock holder so it can tell when a restart has abandoned it. */
export interface ChatHandoffLease {
  /** Aborted when a restart supersedes this attempt; it must then stop writing and messaging. */
  readonly signal: AbortSignal;
}

export interface ChatHandoffRunOptions {
  /** Defaults to 'other'. */
  readonly kind?: ChatHandoffKind;
}

export interface ChatHandoffInFlight {
  run<T>(
    key: string,
    action: (lease: ChatHandoffLease) => Promise<T>,
    options?: ChatHandoffRunOptions,
  ): Promise<ChatHandoffAttempt<T>>;
  /** Kind of the hand-off currently holding the key's lock, or undefined when it is free. */
  holder(key: string): ChatHandoffKind | undefined;
  /**
   * Abandons the current holder, if any, and runs the action under a fresh
   * lock generation. The abandoned attempt keeps running but its lease is
   * aborted, and its late release leaves the new lock held.
   */
  restart<T>(
    key: string,
    action: (lease: ChatHandoffLease) => Promise<T>,
    options?: ChatHandoffRunOptions,
  ): Promise<ChatHandoffAttempt<T>>;
}

/** Thrown to a queued delivery whose attempt was abandoned before it started. */
export class ChatHandoffAbandonedError extends Error {
  constructor() {
    super('The hand-off was abandoned by a restart.');
    this.name = 'ChatHandoffAbandonedError';
  }
}

interface QueueEntry {
  /** Resolves when the entry finishes or is abandoned, so successors stop waiting for it. */
  readonly done: Promise<void>;
  readonly release: () => void;
}

/**
 * Different cards still share one focused chat view and one system clipboard.
 * A delivery given an aborted-able signal is dropped from the queue's order
 * when that signal aborts, so a restart never waits behind a stuck delivery.
 */
export function createChatHandoffQueue(): {
  run<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T>;
} {
  const entries = new Set<QueueEntry>();
  return {
    async run<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      let release!: () => void;
      const done = new Promise<void>((resolve) => { release = resolve; });
      const entry: QueueEntry = { done, release };
      const waitFor = [...entries].map((earlier) => earlier.done);
      entries.add(entry);
      const aborted = new Promise<void>((resolve) => {
        const onAbort = (): void => {
          release();
          resolve();
        };
        if (signal?.aborted) {
          onAbort();
        } else {
          signal?.addEventListener('abort', onAbort, { once: true });
        }
      });
      try {
        await Promise.race([Promise.all(waitFor), aborted]);
        if (signal?.aborted) {
          throw new ChatHandoffAbandonedError();
        }
        return await action();
      } finally {
        entries.delete(entry);
        release();
      }
    },
  };
}

export const CHAT_PROVIDER_LABELS: Record<ChatProviderId, string> = {
  copilot: 'GitHub Copilot',
  codex: 'Codex (ChatGPT)',
  'claude-code': 'Claude Code',
};

/**
 * Serializes hand-offs per card. The lock is held through prompt delivery and
 * the activity write, so a double activation cannot create two conversations
 * or two activity entries.
 */
export function createChatHandoffInFlight(): ChatHandoffInFlight {
  interface Holder {
    readonly kind: ChatHandoffKind;
    readonly controller: AbortController;
  }
  const pending = new Map<string, Holder>();

  const execute = async <T>(
    key: string,
    action: (lease: ChatHandoffLease) => Promise<T>,
    options: ChatHandoffRunOptions | undefined,
  ): Promise<ChatHandoffAttempt<T>> => {
    const holder: Holder = { kind: options?.kind ?? 'other', controller: new AbortController() };
    pending.set(key, holder);
    try {
      return { started: true, value: await action({ signal: holder.controller.signal }) };
    } finally {
      // A restarted key belongs to a newer holder; only free our own claim.
      if (pending.get(key) === holder) {
        pending.delete(key);
      }
    }
  };

  return {
    async run<T>(
      key: string,
      action: (lease: ChatHandoffLease) => Promise<T>,
      options?: ChatHandoffRunOptions,
    ): Promise<ChatHandoffAttempt<T>> {
      if (pending.has(key)) {
        return { started: false };
      }
      return execute(key, action, options);
    },

    holder(key: string): ChatHandoffKind | undefined {
      return pending.get(key)?.kind;
    },

    async restart<T>(
      key: string,
      action: (lease: ChatHandoffLease) => Promise<T>,
      options?: ChatHandoffRunOptions,
    ): Promise<ChatHandoffAttempt<T>> {
      pending.get(key)?.controller.abort();
      return execute(key, action, options);
    },
  };
}

// Commands that accept a `{ query }` argument so the prompt can be injected
// directly into the chat input.
const COMMANDS_SUPPORTING_QUERY = new Set(['workbench.action.chat.open']);

// Commands that accept the prompt as a positional `(sessionId, initialPrompt)`
// argument. Verified against the anthropic.claude-code extension bundle, whose
// own URI handler drives these same commands with a prompt parameter.
const COMMANDS_SUPPORTING_POSITIONAL_PROMPT = new Set([
  'claude-vscode.editor.open',
  'claude-vscode.primaryEditor.open',
]);

// Candidate "open chat" commands per provider, in preference order. Verified
// against the published extension manifests:
//   - GitHub Copilot Chat: workbench.action.chat.open (built into VS Code)
//   - openai.chatgpt (Codex): chatgpt.newChat / chatgpt.openSidebar
//   - anthropic.claude-code: editor.open / primaryEditor.open accept the prompt
//     positionally; sidebar.open / newConversation are clipboard-only fallbacks.
const HANDOFF_TARGET_CANDIDATES: Record<ChatProviderId, readonly string[]> = {
  copilot: ['workbench.action.chat.open'],
  // Prefer a fresh Codex thread so clipboard-based handoffs land in an empty
  // composer instead of reopening the last active sidebar conversation.
  codex: ['chatgpt.newChat', 'chatgpt.openSidebar', 'chatgpt.newCodexPanel'],
  'claude-code': [
    'claude-vscode.editor.open',
    'claude-vscode.primaryEditor.open',
    'claude-vscode.sidebar.open',
    'claude-vscode.newConversation',
  ],
};

// Claude Code's editor.open signature is
// (sessionId, initialPrompt, _, _, fullEditor, options). Passing
// `programmatic: 'honor-preferred-location'` routes a new conversation to the
// sidebar when that is the user's preferred Claude Code location, instead of
// always spawning an editor tab. primaryEditor.open always opens a panel by
// design, so it receives only (sessionId, initialPrompt).
const CLAUDE_EDITOR_OPEN_COMMAND = 'claude-vscode.editor.open';

/**
 * Arguments for a positional hand-off command: no session id (so a new
 * conversation starts) and the prompt as the initial prompt.
 */
export function positionalHandoffArgs(target: ChatHandoffTarget, prompt: string): unknown[] {
  if (target.commandId === CLAUDE_EDITOR_OPEN_COMMAND) {
    return [undefined, prompt, undefined, undefined, undefined, { programmatic: 'honor-preferred-location' }];
  }
  return [undefined, prompt];
}

function promptDeliveryFor(commandId: string): PromptDelivery {
  if (COMMANDS_SUPPORTING_QUERY.has(commandId)) {
    return 'query';
  }
  if (COMMANDS_SUPPORTING_POSITIONAL_PROMPT.has(commandId)) {
    return 'positional';
  }
  return 'clipboard';
}

/**
 * Returns the handoff target for a provider, or undefined when none of the
 * provider's open commands are present (i.e. the extension is not installed).
 * A configured command override takes precedence over the built-in candidates.
 */
export function resolveChatHandoffTarget(
  provider: ChatProviderId,
  availableCommands: readonly string[],
  configuredCommands: ChatProviderCommands = {},
): ChatHandoffTarget | undefined {
  const available = new Set(availableCommands);
  const configuredCommand = configuredCommands[provider]?.trim();
  const candidates = configuredCommand ? [configuredCommand] : HANDOFF_TARGET_CANDIDATES[provider];

  for (const commandId of candidates) {
    if (available.has(commandId)) {
      const target: ChatHandoffTarget = {
        provider,
        commandId,
        promptDelivery: promptDeliveryFor(commandId),
      };
      if (provider === 'codex' && commandId === 'chatgpt.newChat' && available.has('chatgpt.openSidebar')) {
        return { ...target, prepareCommandId: 'chatgpt.openSidebar' };
      }
      return target;
    }
  }

  return undefined;
}

/** Lists every provider that currently has a usable open command available. */
export function listAvailableChatProviders(
  availableCommands: readonly string[],
  configuredCommands: ChatProviderCommands = {},
): ChatHandoffTarget[] {
  const providers: ChatProviderId[] = ['copilot', 'codex', 'claude-code'];
  return providers
    .map((provider) => resolveChatHandoffTarget(provider, availableCommands, configuredCommands))
    .filter((target): target is ChatHandoffTarget => target !== undefined);
}

/** Whether this target should auto-paste the clipboard after opening chat. */
export function shouldAutoPasteChatHandoff(target: ChatHandoffTarget): boolean {
  return target.provider === 'codex' && target.commandId === 'chatgpt.newChat';
}

// Codex turns pastes of 5,000 or more characters into file attachments. Keep
// each paste below that threshold so the request is visible to the agent even
// when its filesystem tools cannot read attachments.
const CODEX_PASTE_CHUNK_SIZE = 4_000;

function clipboardPromptChunks(prompt: string, target: ChatHandoffTarget): string[] {
  if (target.provider !== 'codex') {
    return [prompt];
  }

  const chunks: string[] = [];
  for (let start = 0; start < prompt.length;) {
    let end = Math.min(start + CODEX_PASTE_CHUNK_SIZE, prompt.length);
    const last = prompt.charCodeAt(end - 1);
    if (end < prompt.length && ((last >= 0xD800 && last <= 0xDBFF) ||
      (prompt[end - 1] === '\r' && prompt[end] === '\n'))) {
      end -= 1;
    }
    chunks.push(prompt.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * Reveals the provider and allows startup time before requesting a fresh chat,
 * then inserts the card prompt once
 * and confirms its complete composer text. No readiness text is ever pasted.
 * Command completion alone is not a delivery receipt: a webview paste can
 * silently do nothing. Never replay an unacknowledged card-prompt paste, since
 * it may have taken effect even if the command threw. Once that paste starts,
 * only the readback is retried.
 */
export async function deliverClipboardHandoff(
  target: ChatHandoffTarget,
  prompt: string,
  executor: ClipboardHandoffExecutor,
  options: ClipboardHandoffOptions = {},
): Promise<ClipboardHandoffResult> {
  if (prompt.trim().length === 0) {
    return { delivered: false, error: 'the generated prompt was empty' };
  }

  const chunks = clipboardPromptChunks(prompt, target);
  try {
    await executor.writeClipboard(prompt);
    if (executor.activateProvider) {
      await activateChatHandoffProvider(executor.activateProvider, options.providerActivationTimeoutMs);
    }
    if (target.prepareCommandId) {
      await executor.executeCommand(target.prepareCommandId);
      // A new-chat request queued during startup can lose composer focus when
      // initialization replaces the input. Allow the reported five-second
      // startup to finish before sending that request, rather than after it.
      await executor.wait(options.providerReadyDelayMs ?? 6_000);
    }
    return await openComposerAndPaste(target, prompt, chunks, executor, options);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { delivered: false, error: message || 'the Codex composer did not become ready' };
  }
}

/**
 * Recovery after the user reports the prompt missing from the new chat. Their
 * report makes a replay safe: the provider is already revealed, so request one
 * more fresh chat, paste once, and verify it the same way as the first attempt.
 */
export async function repasteClipboardHandoff(
  target: ChatHandoffTarget,
  prompt: string,
  executor: ClipboardHandoffExecutor,
  options: ClipboardHandoffOptions = {},
): Promise<ClipboardHandoffResult> {
  if (prompt.trim().length === 0) {
    return { delivered: false, error: 'the generated prompt was empty' };
  }
  try {
    return await openComposerAndPaste(target, prompt, clipboardPromptChunks(prompt, target), executor, {
      ...options,
      composerReadyDelayMs: options.composerReadyDelayMs ?? 1_000,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { delivered: false, error: message || 'the Codex composer did not become ready' };
  }
}

async function openComposerAndPaste(
  target: ChatHandoffTarget,
  prompt: string,
  chunks: readonly string[],
  executor: ClipboardHandoffExecutor,
  options: ClipboardHandoffOptions,
): Promise<ClipboardHandoffResult> {
  await executor.executeCommand(target.commandId);
  await executor.wait(options.composerReadyDelayMs ?? (target.prepareCommandId ? 300 : 6_000));
  try {
    for (const chunk of chunks) {
      await executor.writeClipboard(chunk);
      await executor.executeCommand('editor.action.clipboardPasteAction');
      // executeCommand acknowledges dispatch, not the renderer's clipboard
      // read. Keep this chunk available before advancing or verifying it.
      await executor.wait(options.pasteSettleDelayMs ?? 150);
    }
    return await verifyPastedPrompt(prompt, executor, options);
  } finally {
    // Verification uses Copy, so restore the full request for recovery too.
    await executor.writeClipboard(prompt);
  }
}

export async function activateChatHandoffProvider(activate: () => PromiseLike<void>, timeoutMs = 15_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(activate),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Codex activation timed out; check the Codex extension and sign-in, then retry')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function verifyPastedPrompt(
  prompt: string,
  executor: ClipboardHandoffExecutor,
  options: ClipboardHandoffOptions,
): Promise<ClipboardHandoffResult> {
  const maxAttempts = Math.max(1, Math.floor(options.verificationMaxAttempts ?? 8));
  const retryDelayMs = Math.max(0, Math.floor(options.verificationRetryDelayMs ?? 250));
  // Copy on an empty or unfocused webview can leave the clipboard unchanged.
  // A distinct marker prevents the source clipboard from proving delivery.
  const marker = prompt + '\u2063';
  let lastError = 'Codex did not acknowledge the prompt; open Codex and inspect the new-chat draft before retrying';

  // Do not overwrite a delayed Copy result at the start of the next poll.
  await executor.writeClipboard(marker);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await executor.executeCommand('editor.action.selectAll');
      await executor.executeCommand('editor.action.clipboardCopyAction');
      // Webview Copy is fire-and-forget. Give the renderer time to update
      // the system clipboard before reading its delivery acknowledgement.
      await executor.wait(retryDelayMs);
      const copied = await executor.readClipboard();
      if (copied === prompt) {
        return { delivered: true };
      }
      if (copied !== marker) {
        return { delivered: false, error: 'the focused composer did not contain the complete selected-card prompt; inspect the Codex draft before retrying' };
      }
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    delivered: false,
    unconfirmed: true,
    error: `${lastError} after ${maxAttempts} verification attempts`,
  };
}

/** Builds the visible failure message used when no activity entry is written. */
export function formatChatHandoffFailure(providerLabel: string, subject: string, reason: string): string {
  const detail = reason.trim().replace(/[.!?]+$/, '') || 'the chat composer did not become ready';
  return `Could not hand off ${subject} to ${providerLabel}: ${detail}. No activity entry was recorded. Try again after opening ${providerLabel}.`;
}

/** Human-readable detail text for the handoff provider picker. */
export function describeChatHandoffTarget(target: ChatHandoffTarget): string {
  if (target.promptDelivery === 'query') {
    return 'Sends the card prompt straight to the chat input';
  }
  if (target.promptDelivery === 'positional') {
    return 'Opens Claude Code chat pre-filled with the card prompt';
  }
  if (shouldAutoPasteChatHandoff(target)) {
    return 'Starts a fresh Codex thread and auto-pastes the prompt';
  }
  return 'Opens the chat window with the prompt on the clipboard to paste';
}
