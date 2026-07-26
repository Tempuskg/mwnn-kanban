import {
  AGENT_CLI_PROVIDER_IDS,
  type AgentCliProviderId,
} from './agentCliHandoff';

export const AI_LOOP_PROVIDER_PREFERENCES = [
  'prompt',
  'chat',
  ...AGENT_CLI_PROVIDER_IDS,
] as const;

export type AiLoopProviderPreference = (typeof AI_LOOP_PROVIDER_PREFERENCES)[number];

export type AiLoopExecutionMode = 'chat' | 'cli';

export interface AiLoopExecutionModeChoice {
  readonly label: string;
  readonly description: string;
  readonly detail: string;
  readonly mode: AiLoopExecutionMode;
}

const EXECUTION_MODE_CHOICES: readonly AiLoopExecutionModeChoice[] = [
  {
    label: 'VS Code chat extension',
    description: 'Interactive handoff',
    detail: 'Use GitHub Copilot, Codex (ChatGPT), or Claude Code inside VS Code',
    mode: 'chat',
  },
  {
    label: 'Local agent CLI',
    description: 'Non-interactive execution',
    detail: 'Use an installed Copilot, Codex, Claude Code, or Cursor agent CLI',
    mode: 'cli',
  },
];

/** The top-level AI Loop picker must always preserve both execution channels. */
export function listAiLoopExecutionModeChoices(): readonly AiLoopExecutionModeChoice[] {
  return EXECUTION_MODE_CHOICES;
}

export function isAgentCliPreference(
  preference: AiLoopProviderPreference,
): preference is AgentCliProviderId {
  return AGENT_CLI_PROVIDER_IDS.some((provider) => provider === preference);
}
