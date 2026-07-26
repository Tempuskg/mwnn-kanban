import {
  AGENT_CLI_LABELS,
  AGENT_CLI_PROVIDER_IDS,
  resolveAgentCliTarget,
  runAgentCliCardHandoff,
  type AgentCliCardHandoff,
  type AgentCliCardHandoffResult,
  type AgentCliHandoffKind,
  type AgentCliHandoffStore,
  type AgentCliPathOverrides,
  type AgentCliProviderId,
  type AgentCliResolution,
  type ExecutableDiscoveryOptions,
} from './agentCliHandoff';
import {
  CHAT_PROVIDER_LABELS,
  describeChatHandoffTarget,
  type ChatHandoffTarget,
} from './chatHandoff';

/**
 * One entry in the per-card "Run with AI" provider picker. Chat entries carry
 * the already-resolved handoff target so the existing chat flow is unchanged;
 * CLI entries carry only the provider id and are resolved on selection, so
 * every CLI can be offered and a missing executable is reported only when the
 * user actually picks it.
 */
export type RunWithAiProviderChoice =
  | {
      readonly kind: 'chat';
      readonly label: string;
      readonly description: string;
      readonly detail: string;
      readonly target: ChatHandoffTarget;
    }
  | {
      readonly kind: 'cli';
      readonly label: string;
      readonly description: string;
      readonly detail: string;
      readonly provider: AgentCliProviderId;
    };

export function listRunWithAiProviderChoices(
  chatTargets: readonly ChatHandoffTarget[],
): readonly RunWithAiProviderChoice[] {
  const chatChoices = chatTargets.map((target) => ({
    kind: 'chat' as const,
    label: CHAT_PROVIDER_LABELS[target.provider],
    description: 'VS Code chat extension',
    detail: describeChatHandoffTarget(target),
    target,
  }));
  const cliChoices = AGENT_CLI_PROVIDER_IDS.map((provider) => ({
    kind: 'cli' as const,
    label: AGENT_CLI_LABELS[provider],
    description: 'Local agent CLI',
    detail: 'Runs the CLI headlessly in the workspace root and records the result on the card',
    provider,
  }));
  return [...chatChoices, ...cliChoices];
}

/** Per-card CLI actions: run the card's work, or fill in its definition. */
export type RunWithAiHandoffKind = Extract<AgentCliHandoffKind, 'implementation' | 'definition'>;

export interface RunCardWithAgentCliRequest {
  readonly provider: AgentCliProviderId;
  readonly kind: RunWithAiHandoffKind;
  readonly card: { readonly id: string; readonly title: string };
  readonly prompt: string;
}

export interface RunCardWithAgentCliDeps {
  readonly configuredPaths: AgentCliPathOverrides;
  /** Workspace root the CLI runs in. */
  readonly cwd: string;
  readonly store: AgentCliHandoffStore;
  /**
   * Wraps the synchronous CLI run in cancellable progress UI; aborting the
   * provided signal must stop the active CLI process.
   */
  readonly runWithProgress: <T>(title: string, task: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  readonly showInformation: (message: string) => void;
  readonly showWarning: (message: string) => void;
  readonly refreshBoard: () => void;
  /** Test seams; default to the shared agentCliHandoff implementations. */
  readonly resolveTarget?: (
    provider: AgentCliProviderId,
    configuredPaths: AgentCliPathOverrides,
    options: ExecutableDiscoveryOptions,
  ) => Promise<AgentCliResolution>;
  readonly runHandoff?: (handoff: AgentCliCardHandoff) => Promise<AgentCliCardHandoffResult>;
}

/**
 * Run one per-card handoff (implementation or definition fill) with a locally
 * installed agent CLI, reusing the shared board-loop handoff contract: the same
 * resolution and spawn logic, the same start/failure/cancellation Activity
 * entries, and the same card-file completion evidence. A resolution failure
 * records nothing on the card. Returns whether the CLI run completed with
 * valid evidence.
 */
export async function runCardWithAgentCli(
  request: RunCardWithAgentCliRequest,
  deps: RunCardWithAgentCliDeps,
): Promise<boolean> {
  const resolveTarget = deps.resolveTarget ?? resolveAgentCliTarget;
  const resolution = await resolveTarget(request.provider, deps.configuredPaths, { cwd: deps.cwd });
  if (!resolution.available) {
    deps.showWarning(resolution.reason);
    return false;
  }

  const runHandoff = deps.runHandoff ?? runAgentCliCardHandoff;
  const target = resolution.target;
  const progressTitle = request.kind === 'definition'
    ? `Filling in "${request.card.title}" with ${target.label}`
    : `Running "${request.card.title}" with ${target.label}`;
  const result = await deps.runWithProgress(
    progressTitle,
    (signal) =>
      runHandoff({
        kind: request.kind,
        target,
        cardId: request.card.id,
        prompt: request.prompt,
        cwd: deps.cwd,
        store: deps.store,
        signal,
      }),
  );
  deps.refreshBoard();

  const outcome = describeAgentCliRunOutcome(target.label, request.card.title, request.kind, result);
  if (outcome.severity === 'warning') {
    deps.showWarning(outcome.message);
  } else {
    deps.showInformation(outcome.message);
  }
  return result.completed;
}

export interface AgentCliRunOutcome {
  readonly severity: 'info' | 'warning';
  readonly message: string;
}

/** User-facing outcome for a single-card CLI run. The card is never moved. */
export function describeAgentCliRunOutcome(
  providerLabel: string,
  cardTitle: string,
  kind: RunWithAiHandoffKind,
  result: AgentCliCardHandoffResult,
): AgentCliRunOutcome {
  if (result.cancelled) {
    return {
      severity: 'info',
      message: `Stopped ${providerLabel} before it finished "${cardTitle}". The card was not changed and can be rerun.`,
    };
  }
  if (!result.completed) {
    return {
      severity: 'warning',
      message: result.reason
        ?? `${providerLabel} did not complete "${cardTitle}". The card was not changed; check the CLI and rerun the card.`,
    };
  }
  if (result.terminalStatus?.kind === 'blocked') {
    return {
      severity: 'warning',
      message: `${providerLabel} reported "${cardTitle}" as blocked: ${result.terminalStatus.reason}. Resolve the blocker, then rerun the card.`,
    };
  }
  if (kind === 'definition') {
    return {
      severity: 'info',
      message: `${providerLabel} filled in "${cardTitle}". Review the new Description and Acceptance criteria on the card.`,
    };
  }
  return {
    severity: 'info',
    message: `${providerLabel} finished "${cardTitle}" and reported STATUS: DONE in the card Activity.`,
  };
}
