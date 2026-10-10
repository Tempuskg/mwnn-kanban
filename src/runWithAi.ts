import type {
  AgentCliModelCatalog,
  AgentCliStageModels,
  AgentCliStageThinkingLevels,
  AgentCliThinkingLevelDefaults,
} from './agentCliModels';
import {
  AGENT_CLI_LABELS,
  AGENT_CLI_PROVIDER_IDS,
  resolveAgentCliTarget,
  runAgentCliCardHandoff,
  type AgentCliCardHandoff,
  type AgentCliCardHandoffOptions,
  type AgentCliCardHandoffResult,
  type AgentCliHandoffKind,
  type AgentCliHandoffStore,
  type AgentCliPathOverrides,
  type AgentCliProcessObserver,
  type AgentCliProviderId,
  type AgentCliResolution,
  type AgentCliTarget,
  type ExecutableDiscoveryOptions,
} from './agentCliHandoff';
import {
  formatOrchestratorChoiceEntry,
  formatOrchestratorRanking,
  type AgentCliUsageOrchestrator,
} from './agentCliOrchestrator';
import { USAGE_ORCHESTRATOR_DETAIL, USAGE_ORCHESTRATOR_LABEL } from './aiLoopProvider';
import {
  autoStartAiCardFromReady,
  checkAllAcceptanceCriteria,
  hasWipCapacity,
  isVerifyColumn,
} from './boardLoop';
import {
  CHAT_PROVIDER_LABELS,
  describeChatHandoffTarget,
  type ChatHandoffTarget,
} from './chatHandoff';
import type { Assignee, Card, Column } from './types';

/**
 * One entry in the per-card "Run with AI" provider picker. Chat entries carry
 * the already-resolved handoff target so the existing chat flow is unchanged;
 * CLI entries carry only the provider id and are resolved on selection, so
 * every CLI can be offered and a missing executable is reported only when the
 * user actually picks it. The `orchestrator` provider lets the Usage
 * Orchestrator choose the CLI at dispatch.
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
      readonly provider: AgentCliProviderId | 'orchestrator';
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
  const orchestratorChoice = {
    kind: 'cli' as const,
    label: USAGE_ORCHESTRATOR_LABEL,
    description: 'Local agent CLI',
    detail: USAGE_ORCHESTRATOR_DETAIL,
    provider: 'orchestrator' as const,
  };
  return [...chatChoices, ...cliChoices, orchestratorChoice];
}

/** Per-card CLI actions: run the card's work, or fill in its definition. */
export type RunWithAiHandoffKind = Extract<AgentCliHandoffKind, 'implementation' | 'definition'>;

export interface RunCardWithAgentCliRequest {
  /** `orchestrator` ranks the installed CLIs once, at dispatch. */
  readonly provider: AgentCliProviderId | 'orchestrator';
  readonly kind: RunWithAiHandoffKind;
  readonly card: { readonly id: string; readonly title: string };
  readonly prompt: string;
}

/** The card/provider context a process-observer factory receives. */
export interface AgentCliRunContext {
  readonly card: { readonly id: string; readonly title: string };
  readonly kind: RunWithAiHandoffKind;
  readonly providerLabel: string;
}

/**
 * Store surface for a single-card run: the shared handoff contract plus the
 * board mutations used to park a finished card in Verify, mirroring the AI
 * loop's `LoopStore`.
 */
export interface RunWithAiBoardStore extends AgentCliHandoffStore {
  moveCard(cardId: string, toColumnId: string, toIndex: number): Promise<unknown>;
  setAssignee(cardId: string, assignee: Assignee | undefined): Promise<unknown>;
  setAcceptanceCriteria(cardId: string, acceptanceCriteria: string): Promise<unknown>;
}

export interface RunCardWithAgentCliDeps {
  readonly configuredPaths: AgentCliPathOverrides;
  /**
   * Validated workspace model lists. Supplies the model when the card names
   * none and no stage rule applies; omitting it leaves the CLI on its own
   * default model.
   */
  readonly modelCatalog?: AgentCliModelCatalog;
  /**
   * Validated per-stage model rules. The request's own `kind` selects the rule,
   * so running a card's work uses the `implementation` rule and filling in its
   * definition uses the `definition` rule - the same keys the AI loop uses.
   */
  readonly stageModels?: AgentCliStageModels;
  /**
   * Validated per-provider workspace default thinking levels. Supplies the
   * effort when the card names none and no stage rule applies; omitting it
   * leaves the CLI at its own default effort.
   */
  readonly thinkingLevels?: AgentCliThinkingLevelDefaults;
  /**
   * Validated per-stage thinking-level rules, selected by the request's own
   * `kind` exactly as the stage model rules are.
   */
  readonly stageThinkingLevels?: AgentCliStageThinkingLevels;
  /** Workspace root the CLI runs in. */
  readonly cwd: string;
  readonly store: RunWithAiBoardStore;
  /**
   * Wraps the synchronous CLI run in progress UI; aborting the provided
   * signal must stop the active CLI process. `reportProgress` updates the
   * progress message with live CLI output.
   */
  readonly runWithProgress: <T>(
    title: string,
    task: (signal: AbortSignal, reportProgress: (message: string) => void) => Promise<T>,
  ) => Promise<T>;
  readonly showInformation: (message: string) => void;
  readonly showWarning: (message: string) => void;
  readonly refreshBoard: () => void;
  /**
   * Builds the live-feedback observer (output channel, progress text, board
   * status) for one CLI run. Omitting it runs the CLI without live feedback.
   */
  readonly createProcessObserver?: (
    context: AgentCliRunContext,
    reportProgress: (message: string) => void,
  ) => AgentCliProcessObserver;
  /**
   * Chooses the CLI when the request's provider is `orchestrator`. Never
   * consulted otherwise, so a fixed CLI choice probes nothing.
   */
  readonly orchestrator?: Pick<AgentCliUsageOrchestrator, 'choose'>;
  /** The full orchestrator ranking (with skipped CLIs) for the output channel. */
  readonly onRanking?: (lines: readonly string[]) => void;
  /** Test seams; default to the shared agentCliHandoff implementations. */
  readonly resolveTarget?: (
    provider: AgentCliProviderId,
    configuredPaths: AgentCliPathOverrides,
    options: ExecutableDiscoveryOptions,
  ) => Promise<AgentCliResolution>;
  readonly runHandoff?: (
    handoff: AgentCliCardHandoff,
    options?: AgentCliCardHandoffOptions,
  ) => Promise<AgentCliCardHandoffResult>;
}

/**
 * Run one per-card handoff (implementation or definition fill) with a locally
 * installed agent CLI, reusing the shared board-loop handoff contract: the same
 * resolution and spawn logic, the same start/failure/cancellation Activity
 * entries, and the same card-file completion evidence. A resolution failure
 * records nothing on the card. An implementation run that ends with
 * `STATUS: DONE` is closed out the way the AI loop closes out finished work:
 * the acceptance-criteria checklist is completed, and the card is parked in
 * the Verify column reassigned to Human for sign-off. Returns whether the CLI
 * run completed with valid evidence.
 */
export async function runCardWithAgentCli(
  request: RunCardWithAgentCliRequest,
  deps: RunCardWithAgentCliDeps,
): Promise<boolean> {
  let target: AgentCliTarget;
  let choiceEntry: string | undefined;
  if (request.provider === 'orchestrator') {
    const orchestrator = deps.orchestrator;
    if (!orchestrator) {
      deps.showWarning('The Usage Orchestrator is not available for this run.');
      return false;
    }
    const decision = await deps.runWithProgress(
      `Usage Orchestrator: reading agent CLI usage for "${request.card.title}"`,
      () => orchestrator.choose(),
    );
    deps.onRanking?.(formatOrchestratorRanking(decision.ranking, request.kind, request.card.title));
    if (decision.kind === 'none') {
      deps.showWarning(decision.reason);
      return false;
    }
    target = decision.target;
    choiceEntry = formatOrchestratorChoiceEntry(decision.chosen, request.kind);
  } else {
    const resolveTarget = deps.resolveTarget ?? resolveAgentCliTarget;
    const resolution = await resolveTarget(request.provider, deps.configuredPaths, { cwd: deps.cwd });
    if (!resolution.available) {
      deps.showWarning(resolution.reason);
      return false;
    }
    target = resolution.target;
  }

  if (request.kind === 'implementation' && await startReadyCardForImplementation(deps.store, request.card.id)) {
    deps.refreshBoard();
  }
  if (choiceEntry !== undefined) {
    await deps.store.appendActivity(request.card.id, choiceEntry);
  }

  const runHandoff = deps.runHandoff ?? runAgentCliCardHandoff;
  const progressTitle = request.kind === 'definition'
    ? `Filling in "${request.card.title}" with ${target.label}`
    : `Running "${request.card.title}" with ${target.label}`;
  const result = await deps.runWithProgress(
    progressTitle,
    (signal, reportProgress) => {
      const observer = deps.createProcessObserver?.(
        { card: request.card, kind: request.kind, providerLabel: target.label },
        reportProgress,
      );
      return runHandoff(
        {
          kind: request.kind,
          target,
          cardId: request.card.id,
          prompt: request.prompt,
          cwd: deps.cwd,
          store: deps.store,
          signal,
          ...(deps.modelCatalog !== undefined ? { modelCatalog: deps.modelCatalog } : {}),
          ...(deps.stageModels !== undefined ? { stageModels: deps.stageModels } : {}),
          ...(deps.thinkingLevels !== undefined ? { thinkingLevels: deps.thinkingLevels } : {}),
          ...(deps.stageThinkingLevels !== undefined
            ? { stageThinkingLevels: deps.stageThinkingLevels }
            : {}),
        },
        {
          ...(observer ? { observer } : {}),
          ...(request.provider === 'orchestrator' ? { orchestrated: true } : {}),
        },
      );
    },
  );
  // Reported separately from the run's own outcome: the card still ran, just
  // not on the requested model, and that must not pass unnoticed.
  if (result.modelSelection && !result.modelSelection.applied && result.modelSelection.reason) {
    deps.showWarning(result.modelSelection.reason);
  }
  // Same rule for the effort axis: an unapplied level never fails the run, but
  // it is never silent either.
  if (
    result.thinkingSelection &&
    !result.thinkingSelection.applied &&
    result.thinkingSelection.reason
  ) {
    deps.showWarning(result.thinkingSelection.reason);
  }

  let parkedColumnTitle: string | undefined;
  if (request.kind === 'implementation' && result.completed && result.terminalStatus?.kind === 'done') {
    parkedColumnTitle = await parkFinishedCardInVerify(deps.store, request.card.id);
  }
  deps.refreshBoard();

  const outcome = describeAgentCliRunOutcome(
    target.label,
    request.card.title,
    request.kind,
    result,
    parkedColumnTitle,
  );
  if (outcome.severity === 'warning') {
    deps.showWarning(outcome.message);
  } else {
    deps.showInformation(outcome.message);
  }
  return result.completed;
}

/**
 * Starting an implementation run hands a Ready card to AI: assign it to AI
 * and move it to In Progress under the same admission rules as a board
 * assignment. A refused move keeps the card in Ready (the reason goes to its
 * Activity) and the requested run still proceeds. Returns whether the card
 * changed, so the open board can be refreshed before the run starts.
 */
async function startReadyCardForImplementation(store: RunWithAiBoardStore, cardId: string): Promise<boolean> {
  const state = await store.reload();
  const column = state.columns.find((candidate) => candidate.cards.some((card) => card.id === cardId));
  const card = column?.cards.find((candidate) => candidate.id === cardId);
  if (!column || !card || column.role !== 'ready') {
    return false;
  }
  if (card.assignee?.kind !== 'ai') {
    await store.setAssignee(cardId, { kind: 'ai' });
  }
  await autoStartAiCardFromReady(store, cardId);
  return true;
}

/**
 * Close out a finished implementation run with the AI loop's park logic: the
 * agent's `STATUS: DONE` claims every criterion is met, so complete the
 * checklist, move the card to the Verify column, and reassign it to Human for
 * verification and sign-off. Mirrors the loop's behavior when Verify is
 * unavailable too: without a Verify column, or when Verify is at its WIP
 * limit, the card stays where it is. Returns the Verify column's title when
 * the card was parked.
 */
async function parkFinishedCardInVerify(
  store: RunWithAiBoardStore,
  cardId: string,
): Promise<string | undefined> {
  const state = await store.reload();
  let card: Card | undefined;
  let currentColumn: Column | undefined;
  for (const column of state.columns) {
    const found = column.cards.find((candidate) => candidate.id === cardId);
    if (found) {
      card = found;
      currentColumn = column;
      break;
    }
  }
  if (!card || !currentColumn) {
    return undefined;
  }

  const verifyColumn = isVerifyColumn(currentColumn)
    ? currentColumn
    : state.columns.find(isVerifyColumn);
  if (!verifyColumn || (verifyColumn !== currentColumn && !hasWipCapacity(verifyColumn))) {
    return undefined;
  }

  const completedCriteria = checkAllAcceptanceCriteria(card.acceptanceCriteria);
  if (completedCriteria !== undefined && completedCriteria !== card.acceptanceCriteria) {
    await store.setAcceptanceCriteria(cardId, completedCriteria);
  }
  if (verifyColumn !== currentColumn) {
    await store.moveCard(cardId, verifyColumn.id, verifyColumn.cards.length);
  }
  await store.setAssignee(cardId, { kind: 'human' });
  await store.appendActivity(cardId, formatRunWithAiParkEntry(verifyColumn.title));
  return verifyColumn.title;
}

export function formatRunWithAiParkEntry(columnTitle: string, timestamp: Date = new Date()): string {
  return [
    `### ${timestamp.toISOString()} - Run with AI parked in ${columnTitle}`,
    'Implementation finished; reassigned to Human for verification and sign-off.',
  ].join('\n');
}

export interface AgentCliRunOutcome {
  readonly severity: 'info' | 'warning';
  readonly message: string;
}

/** User-facing outcome for a single-card CLI run. */
export function describeAgentCliRunOutcome(
  providerLabel: string,
  cardTitle: string,
  kind: RunWithAiHandoffKind,
  result: AgentCliCardHandoffResult,
  parkedColumnTitle?: string,
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
  if (parkedColumnTitle !== undefined) {
    return {
      severity: 'info',
      message: `${providerLabel} finished "${cardTitle}" and reported STATUS: DONE. The card is now in ${parkedColumnTitle} and assigned to Human for verification.`,
    };
  }
  return {
    severity: 'info',
    message: `${providerLabel} finished "${cardTitle}" and reported STATUS: DONE in the card Activity.`,
  };
}
