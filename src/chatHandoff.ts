/**
 * Resolves which installed AI chat extension a card should be handed off to and
 * how to drive it. Modeled on the handoff approach proven in the chat-commit
 * extension: Copilot's chat command accepts a query argument (the prompt is
 * injected directly), while Codex and Claude Code expose only an "open" command,
 * so their prompt is placed on the clipboard for the user to paste.
 */

export type ChatProviderId = 'copilot' | 'codex' | 'claude-code';

export interface ChatHandoffTarget {
  readonly provider: ChatProviderId;
  readonly commandId: string;
  /** True when the open command accepts a `{ query }` argument carrying the prompt. */
  readonly supportsQuery: boolean;
}

export type ChatProviderCommands = Partial<Record<ChatProviderId, string>>;

export const CHAT_PROVIDER_LABELS: Record<ChatProviderId, string> = {
  copilot: 'GitHub Copilot',
  codex: 'Codex (ChatGPT)',
  'claude-code': 'Claude Code',
};

// Commands that accept a `{ query }` argument so the prompt can be injected
// directly into the chat input rather than copied to the clipboard.
const COMMANDS_SUPPORTING_QUERY = new Set(['workbench.action.chat.open']);

// Candidate "open chat" commands per provider, in preference order. Verified
// against the published extension manifests in chat-commit:
//   - GitHub Copilot Chat: workbench.action.chat.open (built into VS Code)
//   - openai.chatgpt (Codex): chatgpt.openSidebar / chatgpt.newChat
//   - anthropic.claude-code: claude-vscode.sidebar.open / newConversation
const HANDOFF_TARGET_CANDIDATES: Record<ChatProviderId, readonly string[]> = {
  copilot: ['workbench.action.chat.open'],
  codex: ['chatgpt.openSidebar', 'chatgpt.newChat', 'chatgpt.newCodexPanel'],
  'claude-code': [
    'claude-vscode.sidebar.open',
    'claude-vscode.newConversation',
    'claude-vscode.editor.open',
  ],
};

function commandSupportsQuery(commandId: string): boolean {
  return COMMANDS_SUPPORTING_QUERY.has(commandId);
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
        supportsQuery: commandSupportsQuery(commandId),
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
