/**
 * Resolves which installed AI chat extension a card should be handed off to and
 * how to drive it. Providers differ in how the prompt is delivered:
 *   - 'query'      Copilot's workbench.action.chat.open takes a `{ query }`
 *                  argument; the prompt is injected straight into the chat input.
 *   - 'positional' Claude Code's editor open commands accept the prompt as a
 *                  positional `(sessionId, initialPrompt)` argument, so the new
 *                  chat panel opens pre-filled with the prompt.
 *   - 'clipboard'  The provider exposes only a bare "open" command, so the
 *                  prompt is placed on the clipboard for the user to paste.
 */

export type ChatProviderId = 'copilot' | 'codex' | 'claude-code';

export type PromptDelivery = 'query' | 'positional' | 'clipboard';

export interface ChatHandoffTarget {
  readonly provider: ChatProviderId;
  readonly commandId: string;
  /** How the prompt reaches the chat for this command. */
  readonly promptDelivery: PromptDelivery;
}

export type ChatProviderCommands = Partial<Record<ChatProviderId, string>>;

export const CHAT_PROVIDER_LABELS: Record<ChatProviderId, string> = {
  copilot: 'GitHub Copilot',
  codex: 'Codex (ChatGPT)',
  'claude-code': 'Claude Code',
};

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
      return {
        provider,
        commandId,
        promptDelivery: promptDeliveryFor(commandId),
      };
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
