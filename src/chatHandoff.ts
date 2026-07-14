/**
 * Resolves which installed AI chat extension a card should be handed off to and
 * how to drive it. Providers differ in how the prompt is delivered:
 *   - 'query'      Copilot's workbench.action.chat.open takes a `{ query }`
 *                  argument; the prompt is injected straight into the chat input.
 *   - 'positional' Claude Code's editor open commands accept the prompt as a
 *                  positional `(sessionId, initialPrompt)` argument, so the new
 *                  chat panel opens pre-filled with the prompt.
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
  readonly executeCommand: (commandId: string) => PromiseLike<unknown>;
  /** Activates the provider before its command is invoked, when available. */
  readonly activateProvider?: () => PromiseLike<void>;
  readonly wait: (delayMs: number) => Promise<void>;
}

export interface ClipboardHandoffOptions {
  /** Time to let a newly revealed provider view create its composer. */
  readonly providerReadyDelayMs?: number;
  /** Time to let the requested new conversation focus its composer. */
  readonly composerReadyDelayMs?: number;
}

export type ClipboardHandoffResult =
  | { readonly delivered: true }
  | { readonly delivered: false; readonly error: string };

export type ChatHandoffAttempt<T> = { readonly started: true; readonly value: T } | { readonly started: false };

export interface ChatHandoffInFlight {
  run<T>(key: string, action: () => Promise<T>): Promise<ChatHandoffAttempt<T>>;
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
  const pending = new Set<string>();

  return {
    async run<T>(key: string, action: () => Promise<T>): Promise<ChatHandoffAttempt<T>> {
      if (pending.has(key)) {
        return { started: false };
      }

      pending.add(key);
      try {
        return { started: true, value: await action() };
      } finally {
        pending.delete(key);
      }
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

/**
 * Delivers a clipboard-based hand-off exactly once. Provider activation and a
 * separate view-open command happen before the new-chat command, which avoids
 * losing Codex's initial new-chat message while its webview is starting.
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

  try {
    await executor.writeClipboard(prompt);
    if (executor.activateProvider) {
      await executor.activateProvider();
    }
    if (target.prepareCommandId) {
      await executor.executeCommand(target.prepareCommandId);
      await executor.wait(options.providerReadyDelayMs ?? 300);
    }
    await executor.executeCommand(target.commandId);
    await executor.wait(options.composerReadyDelayMs ?? 300);
    await executor.executeCommand('editor.action.clipboardPasteAction');
    return { delivered: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { delivered: false, error: message || 'the Codex composer did not become ready' };
  }
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
    return 'Opens the chat window pre-filled with the card prompt';
  }
  if (shouldAutoPasteChatHandoff(target)) {
    return 'Starts a fresh Codex thread and auto-pastes the prompt';
  }
  return 'Opens the chat window with the prompt on the clipboard to paste';
}
