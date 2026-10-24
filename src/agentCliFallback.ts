/**
 * Automatic CLI fallback - and model escalation - for the AI board loop.
 *
 * When the active agent CLI reports exhausted credits or a spent usage/session
 * allowance, the loop can continue the *same* card stage on the next
 * user-configured CLI instead of stopping the run. The feature is opt-in,
 * ordered, and bounded: each provider is tried at most once per loop run, a
 * provider that has exhausted its allowance is never retried during that run,
 * and when no eligible replacement remains the loop pauses instead of cycling.
 *
 * A switch is never progress on its own - the replacement still has to satisfy
 * the existing stage-specific completion evidence in `runAgentCliCardHandoff`
 * before the loop advances the card.
 *
 * The same attempt loop also drives model escalation (`agentCliEscalation`),
 * because the two policies have to agree about the same attempt: a spent
 * allowance changes the CLI and re-resolves the ladder for the replacement
 * provider without consuming an escalation step, while an inconclusive attempt
 * changes the model and keeps the CLI. Running them as two loops would let one
 * dispatch twice.
 *
 * No `vscode` import: the runner takes its effects (resolution, handoff,
 * progress, notifications) as dependencies so the whole policy is unit
 * testable. `src/extension.ts` supplies the real implementations.
 */

import {
  DISABLED_AGENT_CLI_ESCALATION,
  detectAgentCliEscalationTrigger,
  escalationLadderFor,
  formatAgentCliEscalationEntry,
  formatEscalationHandoffNote,
  formatLadderExhaustedReason,
  selectNextEscalationModel,
  type AgentCliEscalationRecord,
  type AgentCliEscalationSettings,
} from './agentCliEscalation';
import {
  EMPTY_AGENT_CLI_STAGE_MODELS,
  describeAgentCliModelSource,
  resolveAgentCliModel,
  type AgentCliModelCatalog,
  type AgentCliStageModels,
  type AgentCliStageThinkingLevels,
  type AgentCliThinkingLevelDefaults,
  type ResolvedAgentCliModel,
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
  formatNoEligibleCliReason,
  formatOrchestratorChoiceEntry,
  formatOrchestratorRanking,
  type AgentCliOrchestratorDecision,
  type AgentCliUsageOrchestrator,
} from './agentCliOrchestrator';
import {
  cursorPoolForModel,
  selectCursorUsageForModel,
  unknownUsage,
  type AgentCliRanking,
} from './agentCliUsage';
import {
  DEFAULT_USAGE_PROBE_TIMEOUT_MS,
  probeAgentCliUsage,
  type AgentCliUsageProbe,
} from './agentCliUsageProbe';
import {
  delayWithSignal,
  formatPaceWaitProgress,
  formatPaceWaitResumeEntry,
  formatPaceWaitStartEntry,
  formatUsageResetHandoffNote,
  formatUsageWaitProgress,
  formatUsageWaitResumeEntry,
  formatUsageWaitStartEntry,
  planPaceWait,
  planUsageWait,
  selectRecoveredCli,
  usageWaitProviderLabel,
  waitUntilWallClock,
  type UsageWaitCandidate,
} from './aiLoopUsageWait';
import type { BoardState, Card } from './types';
import { cardPreferredModelFor } from './utils';

/**
 * The model that drew from a Cursor usage pool on this dispatch. Prefer the
 * observed CLI model; otherwise the applied requested name. Absent when the
 * run left Cursor on its default (classifier productDefault `auto`).
 */
function modelForUsageWaitPool(result: AgentCliCardHandoffResult): string | undefined {
  const observed = result.actualModel?.model.trim();
  if (observed) {
    return observed;
  }
  if (result.modelSelection?.applied === true) {
    const requested = result.modelSelection.requested.trim();
    if (requested.length > 0) {
      return requested;
    }
  }
  return undefined;
}

/**
 * Wait-for-reset policy for a run (`mwnn-kanban.aiLoopUsageResetMaxWaitHours`).
 * Omitted, or `maxWaitHours` of 0, keeps the existing stop-on-exhaustion
 * behavior exactly.
 */
export interface AgentCliUsageResetWaitSettings {
  /** Validated by `readAiLoopUsageResetMaxWaitHours`; caps each wait on its own. */
  readonly maxWaitHours: number;
  /** Test seams; default to the real usage probes and a real abortable delay. */
  readonly probe?: AgentCliUsageProbe;
  readonly delay?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** What a usage-reset or behind-pace wait is waiting for; times are epoch ms. */
export interface AgentCliUsageWaitState {
  readonly providerLabel: string;
  /** The reported reset time, when one was reported. */
  readonly resetsAt?: number;
  /**
   * The next probe / wake time. Always set for a pace wait (and for a reset
   * recheck) so older Portfolio UI still shows a check time.
   */
  readonly nextCheckAt?: number;
  /**
   * Additive: present when waiting for a CLI to fall behind pace rather than
   * for a usage-limit reset. Older Pro packages ignore this field.
   */
  readonly paceWait?: true;
}

export interface AgentCliFallbackSettings {
  /** Off by default: a disabled fallback preserves the single-CLI behavior. */
  readonly enabled: boolean;
  /** Providers to try, in order, after the active CLI exhausts its allowance. */
  readonly providers: readonly AgentCliProviderId[];
}

export const DISABLED_AGENT_CLI_FALLBACK: AgentCliFallbackSettings = {
  enabled: false,
  providers: [],
};

/**
 * Accept only known provider ids from user configuration, keep the configured
 * order, and drop duplicates so a repeated entry can never be tried twice.
 */
export function readAgentCliFallbackOrder(value: unknown): AgentCliProviderId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const order: AgentCliProviderId[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const provider = AGENT_CLI_PROVIDER_IDS.find((candidate) => candidate === entry.trim());
    if (provider && !order.includes(provider)) {
      order.push(provider);
    }
  }
  return order;
}

export interface AgentCliSwitchRecord {
  readonly at: Date;
  readonly kind: AgentCliHandoffKind;
  readonly from: AgentCliTarget;
  readonly to: AgentCliTarget;
  /** Redacted exhaustion detail taken from the failed CLI's own output. */
  readonly detail: string;
  /**
   * The model the replacement will run on: the card's own, else the interrupted
   * stage's rule, else *that* provider's workspace default - never the
   * exhausted provider's. Absent when no layer names one and the replacement
   * runs its own default model.
   */
  readonly toModel?: ResolvedAgentCliModel;
}

export interface AgentCliFallbackRequest {
  readonly kind: AgentCliHandoffKind;
  readonly card: Card;
  /** Rebuilt per attempt so a replacement receives the latest card contents. */
  readonly buildPrompt: (card: Card) => string;
}

/** One CLI process this runner is about to launch, offered for approval. */
export interface AgentCliDispatchIntent {
  readonly kind: AgentCliHandoffKind;
  readonly target: AgentCliTarget;
  readonly card: Card;
}

/**
 * A budget's answer to a dispatch intent. A denial must carry its own reason:
 * the runner does not know why the caller refused, only that nothing may be
 * launched.
 */
export type AgentCliDispatchDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/** The same dispatch once its process has fully ended. */
export interface AgentCliDispatchSettlement extends AgentCliDispatchIntent {
  /** The model the CLI actually ran on; absent when it used its own default. */
  readonly model?: string;
  readonly result: AgentCliCardHandoffResult;
}

export type AgentCliFallbackOutcome =
  | { readonly kind: 'busy' }
  | { readonly kind: 'paused'; readonly reason: string }
  /**
   * A dispatch was refused before it started - today only by the per-run
   * dispatch budget. Distinct from `paused`, which means the CLIs themselves
   * ran out of allowance, and from a failed `ran`: no process was launched, so
   * the card is exactly as the caller left it.
   */
  | {
      readonly kind: 'stopped';
      readonly reason: string;
      readonly switches: readonly AgentCliSwitchRecord[];
      readonly escalations: readonly AgentCliEscalationRecord[];
    }
  | {
      readonly kind: 'ran';
      /** The CLI that produced `result`; may differ from the loop's first CLI. */
      readonly target: AgentCliTarget;
      readonly result: AgentCliCardHandoffResult;
      readonly switches: readonly AgentCliSwitchRecord[];
      /** Model escalations performed for this request, oldest first. */
      readonly escalations: readonly AgentCliEscalationRecord[];
      /** True when the stage failed on exhaustion and no replacement remained. */
      readonly exhaustedWithoutFallback: boolean;
    };

export interface AgentCliFallbackDeps {
  /** CLI the user chose for this loop run. Their saved preference is untouched. */
  readonly initialTarget: AgentCliTarget;
  readonly settings: AgentCliFallbackSettings;
  readonly configuredPaths: AgentCliPathOverrides;
  /**
   * Validated workspace model lists, forwarded to every handoff so a
   * replacement provider resolves its own default rather than inheriting the
   * exhausted provider's.
   */
  readonly modelCatalog?: AgentCliModelCatalog;
  /**
   * Validated per-stage model rules, forwarded to every handoff. The stage is
   * the handoff's own `kind`, so a replacement CLI retries the interrupted
   * stage on that stage's rule rather than on another stage's.
   */
  readonly stageModels?: AgentCliStageModels;
  /**
   * Validated per-provider workspace default thinking levels, forwarded to
   * every handoff for the same reason the model catalog is: a replacement
   * provider must resolve its *own* effort default rather than inherit one
   * spelled for the CLI whose allowance ran out.
   */
  readonly thinkingLevels?: AgentCliThinkingLevelDefaults;
  /** Validated per-stage thinking-level rules, forwarded to every handoff. */
  readonly stageThinkingLevels?: AgentCliStageThinkingLevels;
  /**
   * Model escalation policy. Omitted means disabled, which keeps the existing
   * single-attempt behavior exactly: an inconclusive attempt is returned to the
   * caller as-is, with no second dispatch.
   */
  readonly escalation?: AgentCliEscalationSettings;
  /** Project-qualified identity for per-card escalation history. */
  readonly cardKey?: (cardId: string) => string;
  readonly cwd: string;
  readonly store: AgentCliHandoffStore;
  /** Aborted when the loop is cancelled; also terminates the active process. */
  readonly signal: AbortSignal;
  /** Extra cancellation signal for loops cancelled without aborting. */
  readonly isCancelled?: () => boolean;
  readonly now?: () => Date;
  /** Progress line; always names the CLI that is about to run or took over. */
  readonly onProgress?: (message: string) => void;
  readonly onSwitch?: (record: AgentCliSwitchRecord) => void;
  readonly onEscalate?: (record: AgentCliEscalationRecord) => void;
  /** Called once when the run pauses because no eligible CLI is left. */
  readonly onPause?: (reason: string) => void;
  /**
   * Structured state of a usage-reset wait: called with the wait before its
   * progress line, and with `undefined` before any later progress line once
   * the wait resumes, is declined, or is cancelled.
   */
  readonly onUsageWait?: (wait: AgentCliUsageWaitState | undefined) => void;
  /**
   * Consulted immediately before *every* CLI process this runner launches -
   * the first attempt of a stage, a credit-fallback replacement, and a model
   * escalation retry alike - so a per-run dispatch budget counts and caps all
   * of them rather than only whole stages. A denial returns the `stopped`
   * outcome without spawning anything, which is what keeps a budget stop from
   * ever leaving a card half-dispatched. Omitting it launches unconditionally,
   * exactly as before.
   */
  /** Pause between process attempts, including fallback and escalation retries. */
  readonly waitBeforeDispatch?: () => Promise<void>;
  readonly beforeDispatch?: (intent: AgentCliDispatchIntent) => AgentCliDispatchDecision;
  /**
   * Called once per launched process after it has fully ended, carrying the
   * model it actually ran on, so a tally is grouped by what was really used
   * rather than by what was requested.
   */
  readonly afterDispatch?: (settlement: AgentCliDispatchSettlement) => void;
  readonly createObserver?: (
    target: AgentCliTarget,
    request: AgentCliFallbackRequest,
  ) => AgentCliProcessObserver | undefined;
  /**
   * Usage Orchestrator for this run. When present it chooses the CLI before
   * every stage (so one run can use several CLIs) and chooses the replacement
   * after a credit exhaustion in place of `settings.providers`, which it then
   * ignores; the retry is always on, with the same one-handoff, process-ended,
   * latest-card, and no-advance-on-switch guarantees. Omitted, nothing about
   * CLI choice changes and no usage is probed.
   */
  readonly orchestrator?: AgentCliUsageOrchestrator;
  /** The full orchestrator ranking (with skipped CLIs) for each choice it makes. */
  readonly onRanking?: (lines: readonly string[]) => void;
  /**
   * When an exhaustion leaves no replacement CLI (fallback off, order used up,
   * or the orchestrator finds none), wait for the earliest reported reset
   * within the cap and retry the same stage, instead of pausing the run.
   * The wall clock is `now`; the wait is announced through `onProgress`.
   */
  readonly usageResetWait?: AgentCliUsageResetWaitSettings;
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

export interface AgentCliFallbackRunner {
  /** The CLI later handoffs in this run will use. */
  activeTarget(): AgentCliTarget;
  isPaused(): boolean;
  pauseReason(): string | undefined;
  exhaustedProviders(): readonly AgentCliProviderId[];
  run(request: AgentCliFallbackRequest): Promise<AgentCliFallbackOutcome>;
}

const STAGE_LABELS: Record<AgentCliHandoffKind, string> = {
  implementation: 'implementation',
  definition: 'definition',
  triage: 'triage',
  verification: 'verification',
};

export function createAgentCliFallbackRunner(deps: AgentCliFallbackDeps): AgentCliFallbackRunner {
  const resolveTarget = deps.resolveTarget ?? resolveAgentCliTarget;
  const runHandoff = deps.runHandoff ?? runAgentCliCardHandoff;
  const now = deps.now ?? (() => new Date());
  const queue: AgentCliProviderId[] = [...deps.settings.providers];
  const considered = new Set<AgentCliProviderId>();
  const exhausted = new Set<AgentCliProviderId>();
  const escalation = deps.escalation ?? DISABLED_AGENT_CLI_ESCALATION;
  /**
   * Models already dispatched for a card during this loop run, keyed by card
   * and scoped to the provider that ran them, so a ladder rung is spent at most
   * once per card and a provider swapped in by the credit fallback still climbs
   * its own ladder from the bottom. Per *card* rather than per card-and-stage on
   * purpose: escalation is a spending decision, and one expensive model per card
   * per run is the budget a user opting into this is agreeing to.
   */
  const triedModels = new Map<string, Map<AgentCliProviderId, Set<string>>>();
  let active = deps.initialTarget;
  // One handoff at a time: a repeated failure signal, or a second caller,
  // must never launch a duplicate CLI process for this loop.
  let busy = false;
  let pausedReason: string | undefined;

  const cancelled = (): boolean => deps.signal.aborted || deps.isCancelled?.() === true;

  const maxWaitHours = deps.usageResetWait?.maxWaitHours ?? 0;
  /** The exhausted CLIs' targets, so a wait can probe them and resume on one. */
  const exhaustedTargets = new Map<AgentCliProviderId, AgentCliTarget>();
  /**
   * Resolved model that exhausted each Cursor wait (pool label only). Other
   * CLIs ignore this map; cleared when that CLI is eligible again.
   */
  const exhaustedModels = new Map<AgentCliProviderId, string | undefined>();
  const nowMs = (): number => now().getTime();
  const labelForWait = (provider: AgentCliProviderId): string =>
    usageWaitProviderLabel(provider, exhaustedModels.get(provider));

  const probeExhausted = (): Promise<UsageWaitCandidate[]> => {
    const probe = deps.usageResetWait?.probe ?? probeAgentCliUsage;
    return Promise.all([...exhaustedTargets.values()].map(async (target) => {
      const raw = await probe(target, {
        cwd: deps.cwd,
        timeoutMs: DEFAULT_USAGE_PROBE_TIMEOUT_MS,
        signal: deps.signal,
        now: nowMs(),
      }).catch((error: unknown) => unknownUsage(
        target.provider,
        `${target.label} usage probe failed: ${error instanceof Error ? error.message : String(error)}`,
      ));
      return {
        provider: target.provider,
        snapshot: selectCursorUsageForModel(raw, exhaustedModels.get(target.provider)),
      };
    }));
  };

  /**
   * Wait for an exhausted CLI's allowance to reset. Probes every exhausted CLI,
   * sleeps until the earliest reported reset inside the cap (or rechecks every
   * 30 minutes when none is reported), and resumes on the CLI that recovered.
   * Nothing is dispatched while this runs, and a pause does not shorten it:
   * the caller's next attempt still holds at the pause gate.
   */
  const waitForUsageReset = async (
    kind: AgentCliHandoffKind,
    card: Card,
    failed: AgentCliTarget,
    detail: string,
  ): Promise<
    | { readonly kind: 'resumed'; readonly target: AgentCliTarget }
    | { readonly kind: 'declined'; readonly reason: string }
    | { readonly kind: 'cancelled' }
  > => {
    const deadline = nowMs() + maxWaitHours * 3_600_000;
    const clock = {
      now: nowMs,
      delay: deps.usageResetWait?.delay ?? delayWithSignal,
      signal: deps.signal,
      isCancelled: cancelled,
    };
    let waitedFor: AgentCliProviderId | undefined;
    let waited = false;
    const clearWait = (): void => {
      if (waited) {
        deps.onUsageWait?.(undefined);
      }
    };
    try {
      for (;;) {
        if (cancelled()) {
          return { kind: 'cancelled' };
        }
        const candidates = await probeExhausted();
        if (cancelled()) {
          return { kind: 'cancelled' };
        }
        if (waited) {
          const recovered = selectRecoveredCli(candidates, waitedFor);
          const target = recovered !== undefined ? exhaustedTargets.get(recovered) : undefined;
          if (recovered !== undefined && target) {
            // Eligible again in this runner and in the orchestrator; every other
            // exhausted CLI stays out.
            exhausted.delete(recovered);
            exhaustedTargets.delete(recovered);
            exhaustedModels.delete(recovered);
            deps.orchestrator?.clearExhausted(recovered);
            await appendIfCardExists(deps.store, card.id, formatUsageWaitResumeEntry(now(), kind, recovered));
            clearWait();
            waited = false;
            deps.onProgress?.(
              `${target.label}'s usage limit has reset; retrying the ${STAGE_LABELS[kind]} stage for "${card.title}".`,
            );
            return { kind: 'resumed', target };
          }
        }
        const plan = planUsageWait(candidates, nowMs(), deadline, maxWaitHours);
        if (plan.kind === 'decline') {
          return { kind: 'declined', reason: plan.reason };
        }
        if (!waited) {
          await appendIfCardExists(
            deps.store,
            card.id,
            formatUsageWaitStartEntry({
              at: now(),
              kind,
              exhausted: failed.provider,
              detail,
              plan,
              maxWaitHours,
            }),
          );
        }
        waited = true;
        deps.onUsageWait?.(plan.kind === 'reset'
          ? { providerLabel: labelForWait(plan.provider), resetsAt: plan.resetsAt }
          : { providerLabel: plan.providers.map(labelForWait).join(', '), nextCheckAt: plan.until });
        deps.onProgress?.(formatUsageWaitProgress(plan));
        waitedFor = plan.kind === 'reset' ? plan.provider : undefined;
        if (!(await waitUntilWallClock(plan.until, clock))) {
          return { kind: 'cancelled' };
        }
      }
    } finally {
      // Declined, cancelled, or thrown: the next progress line is not a wait.
      clearWait();
    }
  };

  /** Cursor model that would run if the orchestrator chose `cursor` for this stage. */
  const cursorModelForStage = (
    kind: AgentCliHandoffKind,
    card: Card,
  ): string | undefined =>
    resolveAgentCliModel(
      'cursor',
      cardPreferredModelFor(card, 'cursor'),
      deps.modelCatalog,
      {
        stage: kind,
        stageModels: deps.stageModels ?? EMPTY_AGENT_CLI_STAGE_MODELS,
      },
    )?.model;

  /** Ask the orchestrator for a CLI and log the full ranking it produced. */
  const orchestrate = async (
    orchestrator: AgentCliUsageOrchestrator,
    kind: AgentCliHandoffKind,
    card: Card,
  ): Promise<AgentCliOrchestratorDecision> => {
    const cursorModel = cursorModelForStage(kind, card);
    const decision = await orchestrator.choose({
      ...(cursorModel !== undefined ? { cursorModel } : {}),
      cursorProductDefault: 'auto',
    });
    deps.onRanking?.(formatOrchestratorRanking(decision.ranking, kind, card.title));
    return decision;
  };

  /**
   * Wait until a CLI falls behind pace, then re-rank. Reuses the wall-clock
   * tick wait. Nothing is dispatched during the wait; Stop ends it; Pause
   * holds the next dispatch after it.
   */
  const waitForBehindPace = async (
    kind: AgentCliHandoffKind,
    card: Card,
    initial: AgentCliRanking,
  ): Promise<
    | { readonly kind: 'resumed'; readonly decision: Extract<AgentCliOrchestratorDecision, { kind: 'chosen' }> }
    | { readonly kind: 'declined'; readonly reason: string }
    | { readonly kind: 'cancelled' }
  > => {
    const orchestrator = deps.orchestrator;
    if (!orchestrator) {
      return { kind: 'declined', reason: formatNoEligibleCliReason(initial) };
    }
    const deadline = nowMs() + maxWaitHours * 3_600_000;
    const clock = {
      now: nowMs,
      delay: deps.usageResetWait?.delay ?? delayWithSignal,
      signal: deps.signal,
      isCancelled: cancelled,
    };
    let ranking = initial;
    let waited = false;
    const clearWait = (): void => {
      if (waited) {
        deps.onUsageWait?.(undefined);
      }
    };
    try {
      for (;;) {
        if (cancelled()) {
          return { kind: 'cancelled' };
        }
        if (waited) {
          const decision = await orchestrate(orchestrator, kind, card);
          if (decision.kind === 'chosen') {
            await appendIfCardExists(
              deps.store,
              card.id,
              formatPaceWaitResumeEntry(now(), kind, decision.chosen.provider),
            );
            clearWait();
            waited = false;
            deps.onProgress?.(
              `${decision.target.label} fell behind pace; retrying the ${STAGE_LABELS[kind]} stage for "${card.title}".`,
            );
            return { kind: 'resumed', decision };
          }
          ranking = decision.ranking;
        }
        const plan = planPaceWait(ranking.pacePredictions ?? [], nowMs(), deadline, maxWaitHours);
        if (plan.kind === 'decline') {
          return { kind: 'declined', reason: plan.reason };
        }
        if (!waited) {
          await appendIfCardExists(
            deps.store,
            card.id,
            formatPaceWaitStartEntry({
              at: now(),
              kind,
              predictions: ranking.pacePredictions ?? [],
              plan,
              maxWaitHours,
            }),
          );
        }
        waited = true;
        const providerLabel = plan.kind === 'pace'
          ? AGENT_CLI_LABELS[plan.provider]
          : 'an AI CLI';
        deps.onUsageWait?.({
          providerLabel,
          nextCheckAt: plan.until,
          paceWait: true,
        });
        deps.onProgress?.(formatPaceWaitProgress(plan));
        if (!(await waitUntilWallClock(plan.until, clock))) {
          return { kind: 'cancelled' };
        }
      }
    } finally {
      clearWait();
    }
  };

  /** Pause the run because the orchestrator has no eligible CLI left. */
  const pauseOrchestrated = async (
    card: Card,
    kind: AgentCliHandoffKind,
    reason: string,
  ): Promise<void> => {
    pausedReason = reason;
    await appendIfCardExists(
      deps.store,
      card.id,
      [
        `### ${now().toISOString()} - AI loop paused: no AI CLI with usage left`,
        reason,
        `The ${STAGE_LABELS[kind]} stage was not completed and the card was not advanced.`,
      ].join('\n'),
    );
    deps.onProgress?.(reason);
    deps.onPause?.(reason);
  };

  /** Per card, then per provider: ladder rungs are provider-specific names. */
  const triedFor = (cardId: string, provider: AgentCliProviderId): Set<string> => {
    const key = deps.cardKey?.(cardId) ?? cardId;
    let byProvider = triedModels.get(key);
    if (!byProvider) {
      byProvider = new Map<AgentCliProviderId, Set<string>>();
      triedModels.set(key, byProvider);
    }
    let models = byProvider.get(provider);
    if (!models) {
      models = new Set<string>();
      byProvider.set(provider, models);
    }
    return models;
  };

  const markTried = (
    cardId: string,
    provider: AgentCliProviderId,
    model: string | undefined,
  ): void => {
    if (model !== undefined) {
      triedFor(cardId, provider).add(model);
    }
  };

  const selectReplacement = async (): Promise<AgentCliTarget | undefined> => {
    while (queue.length > 0) {
      const provider = queue.shift();
      if (!provider || considered.has(provider)) {
        // Duplicate entry: already tried or already skipped during this run.
        continue;
      }
      considered.add(provider);
      if (provider === active.provider || exhausted.has(provider)) {
        continue;
      }
      if (cancelled()) {
        return undefined;
      }
      const resolution = await resolveTarget(provider, deps.configuredPaths, { cwd: deps.cwd });
      if (!resolution.available) {
        deps.onProgress?.(
          `Skipping ${AGENT_CLI_LABELS[provider]}: its executable is unavailable.`,
        );
        continue;
      }
      return resolution.target;
    }
    return undefined;
  };

  /**
   * Decide whether an inconclusive attempt earns one retry on a stronger model,
   * and if so record it and hand back the reloaded card for that retry.
   *
   * Returns undefined for every outcome that must keep the existing
   * single-attempt behavior: escalation disabled, a cancelled loop, a success,
   * an excluded failure kind, a card whose explicit model the user has not
   * allowed the loop to override, and an exhausted ladder.
   */
  const escalate = async (
    request: AgentCliFallbackRequest,
    card: Card,
    target: AgentCliTarget,
    result: AgentCliCardHandoffResult,
  ): Promise<{ readonly record: AgentCliEscalationRecord; readonly card: Card } | undefined> => {
    if (!escalation.enabled || cancelled()) {
      return undefined;
    }
    const trigger = detectAgentCliEscalationTrigger(result);
    if (!trigger) {
      return undefined;
    }
    const currentModel = result.modelSelection?.requested;
    if (result.modelSelection?.source === 'card' && !escalation.overrideCardModel) {
      // The card names its own model and the user has not opted into overriding
      // that choice, so the explicit selection stands and the failure is real.
      deps.onProgress?.(
        `"${card.title}" names its own model "${currentModel}", so the ${STAGE_LABELS[request.kind]} stage was not escalated.`,
      );
      return undefined;
    }

    const ladder = escalationLadderFor(escalation.ladders, target.provider);
    const next = selectNextEscalationModel(
      ladder,
      currentModel,
      triedFor(card.id, target.provider),
    );
    if (!next) {
      if (ladder.length > 0) {
        deps.onProgress?.(formatLadderExhaustedReason(target, request.kind, currentModel));
      }
      return undefined;
    }

    const record: AgentCliEscalationRecord = {
      at: now(),
      kind: request.kind,
      target,
      ...(currentModel !== undefined ? { from: currentModel } : {}),
      to: next,
      trigger,
    };
    // Recorded before the retry starts, so the substitution is in the card file
    // even if the retry never reports anything itself.
    await appendIfCardExists(deps.store, card.id, formatAgentCliEscalationEntry(record));
    // Spent on selection, not on completion: a rung that was dispatched can
    // never be offered again for this card, so repeated failures walk the
    // ladder once and then stop.
    markTried(card.id, target.provider, next);

    const fresh = findCard(await deps.store.reload(), card.id);
    if (!fresh || cancelled()) {
      // The card vanished, or the loop was cancelled while the failure was
      // being handled: no further dispatch.
      return undefined;
    }
    deps.onEscalate?.(record);
    deps.onProgress?.(
      `${target.label} did not complete the ${STAGE_LABELS[request.kind]} stage for "${fresh.title}"; retrying on model "${next}".`,
    );
    return { record, card: fresh };
  };

  const run = async (request: AgentCliFallbackRequest): Promise<AgentCliFallbackOutcome> => {
    if (busy) {
      return { kind: 'busy' };
    }
    if (pausedReason !== undefined) {
      return { kind: 'paused', reason: pausedReason };
    }
    busy = true;
    try {
      const switches: AgentCliSwitchRecord[] = [];
      const escalations: AgentCliEscalationRecord[] = [];
      let card = request.card;
      let handoffNote: string | undefined;
      /**
       * The ladder rung this attempt runs on, replacing every configured model
       * layer for one dispatch. Cleared whenever the credit fallback changes
       * provider, because a name spelled for one CLI means nothing to another.
       */
      let escalatedModel: string | undefined;
      if (deps.orchestrator && !cancelled()) {
        // Re-ranked before every stage: the allowances move between stages.
        let decision = await orchestrate(deps.orchestrator, request.kind, card);
        if (decision.kind === 'none' && deps.orchestrator.behindPaceOnly) {
          const waited = await waitForBehindPace(request.kind, card, decision.ranking);
          if (waited.kind === 'cancelled') {
            return {
              kind: 'ran',
              target: active,
              result: {
                completed: false,
                cancelled: true,
                activityBaseline: (card.activity ?? '').length,
              },
              switches,
              escalations,
              exhaustedWithoutFallback: false,
            };
          }
          if (waited.kind === 'declined') {
            await pauseOrchestrated(card, request.kind, waited.reason);
            return { kind: 'paused', reason: waited.reason };
          }
          decision = waited.decision;
        }
        if (decision.kind === 'none') {
          await pauseOrchestrated(card, request.kind, decision.reason);
          return { kind: 'paused', reason: decision.reason };
        }
        active = decision.target;
        await appendIfCardExists(
          deps.store,
          card.id,
          formatOrchestratorChoiceEntry(decision.chosen, request.kind, now()),
        );
        card = findCard(await deps.store.reload(), card.id) ?? card;
      }
      // Bounded by construction: the active CLI plus each configured provider
      // at most once, so exhaustion can never cycle indefinitely.
      // providers: the active CLI plus each configured fallback, at most once.
      // models: each provider's ladder is climbed at most one rung per attempt,
      // and every rung is consumed permanently for this card, so the product is
      // a hard ceiling even before the tried-set makes cycling impossible.
      const maxLadder = Math.max(
        0,
        ...AGENT_CLI_PROVIDER_IDS.map((provider) =>
          escalation.enabled ? escalationLadderFor(escalation.ladders, provider).length : 0,
        ),
      );
      const providerAttempts = deps.orchestrator
        ? AGENT_CLI_PROVIDER_IDS.length
        : deps.settings.providers.length + 1;
      const maxAttempts = providerAttempts * (maxLadder + 1);
      // Each wait for a usage reset grants a fresh attempt budget: the bound
      // above is per allowance window, and a wait always lies between windows.
      let attemptLimit = maxAttempts;

      /**
       * Retry the same stage after a waited-out reset. Returns an outcome only
       * when the card vanished during the wait, so nothing is dispatched.
       */
      const resumeAfterWait = async (
        resumed: AgentCliTarget,
        previous: AgentCliTarget,
        detail: string,
      ): Promise<AgentCliFallbackOutcome | undefined> => {
        active = resumed;
        if (resumed.provider !== previous.provider) {
          // A ladder rung is spelled for one CLI only.
          escalatedModel = undefined;
        }
        handoffNote = formatUsageResetHandoffNote(previous.provider, request.kind, detail);
        attemptLimit += maxAttempts;
        const fresh = findCard(await deps.store.reload(), card.id);
        if (!fresh) {
          return {
            kind: 'ran',
            target: resumed,
            result: {
              completed: false,
              cancelled: false,
              activityBaseline: (card.activity ?? '').length,
              reason: `Card ${card.id} no longer exists, so ${resumed.label} was not started.`,
            },
            switches,
            escalations,
            exhaustedWithoutFallback: false,
          };
        }
        card = fresh;
        return undefined;
      };

      for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
        await deps.waitBeforeDispatch?.();
        if (cancelled()) {
          return {
            kind: 'ran',
            target: active,
            result: {
              completed: false,
              cancelled: true,
              activityBaseline: (card.activity ?? '').length,
            },
            switches,
            escalations,
            exhaustedWithoutFallback: false,
          };
        }

        const target = active;
        // Asked before the prompt is built and before anything is spawned, so a
        // refusal costs nothing and leaves no process to wind down.
        const decision = deps.beforeDispatch?.({ kind: request.kind, target, card })
          ?? { allowed: true };
        if (!decision.allowed) {
          deps.onProgress?.(decision.reason);
          return { kind: 'stopped', reason: decision.reason, switches, escalations };
        }
        deps.onProgress?.(
          `${target.label}: ${STAGE_LABELS[request.kind]} handoff for "${card.title}"...`,
        );
        const basePrompt = request.buildPrompt(card);
        const prompt = handoffNote ? `${basePrompt}\n\n${handoffNote}` : basePrompt;
        const observer = deps.createObserver?.(target, request);
        // Awaited: the failed process has fully ended before any replacement
        // is selected, let alone started.
        const result = await runHandoff(
          {
            kind: request.kind,
            target,
            cardId: card.id,
            prompt,
            cwd: deps.cwd,
            store: deps.store,
            signal: deps.signal,
            ...(deps.modelCatalog !== undefined ? { modelCatalog: deps.modelCatalog } : {}),
            ...(deps.stageModels !== undefined ? { stageModels: deps.stageModels } : {}),
            ...(deps.thinkingLevels !== undefined ? { thinkingLevels: deps.thinkingLevels } : {}),
            ...(deps.stageThinkingLevels !== undefined
              ? { stageThinkingLevels: deps.stageThinkingLevels }
              : {}),
            ...(escalatedModel !== undefined ? { escalatedModel } : {}),
          },
          {
            ...(observer ? { observer } : {}),
            ...(deps.orchestrator
              ? { orchestrated: true, ignoreCardPreferredModel: true }
              : {}),
          },
        );
        // Whatever this attempt actually ran on is spent for this card, whether
        // it came from the ladder, the card, a stage rule, or the workspace
        // default - so the ladder can never hand back a model that just failed.
        markTried(card.id, target.provider, result.modelSelection?.requested);
        // The process has ended by now (the await above), so a settlement can
        // never describe a dispatch that is still running.
        deps.afterDispatch?.({
          kind: request.kind,
          target,
          card,
          ...(result.modelSelection?.applied === true
            ? { model: result.modelSelection.requested }
            : {}),
          result,
        });

        const exhaustion = result.creditExhaustion;
        if (!exhaustion || result.cancelled) {
          const escalated = await escalate(request, card, target, result);
          if (escalated) {
            escalations.push(escalated.record);
            escalatedModel = escalated.record.to;
            handoffNote = formatEscalationHandoffNote(escalated.record);
            card = escalated.card;
            continue;
          }
          return { kind: 'ran', target, result, switches, escalations, exhaustedWithoutFallback: false };
        }

        exhausted.add(target.provider);
        exhaustedTargets.set(target.provider, target);
        const exhaustedModel = modelForUsageWaitPool(result);
        exhaustedModels.set(target.provider, exhaustedModel);
        deps.orchestrator?.markExhausted(
          target.provider,
          target.provider === 'cursor'
            ? { cursorPool: cursorPoolForModel(exhaustedModel) }
            : undefined,
        );
        const waitEnabled = maxWaitHours > 0;
        // Stopped during a wait: no failure is reported, so the run ends as
        // cancelled rather than as spent credits.
        const cancelledDuringWait: AgentCliFallbackOutcome = {
          kind: 'ran',
          target,
          result: { completed: false, cancelled: true, activityBaseline: result.activityBaseline },
          switches,
          escalations,
          exhaustedWithoutFallback: false,
        };
        if (!deps.settings.enabled && !deps.orchestrator && waitEnabled && !cancelled()) {
          const waited = await waitForUsageReset(request.kind, card, target, exhaustion.detail);
          if (waited.kind === 'cancelled') {
            return cancelledDuringWait;
          }
          if (waited.kind === 'resumed') {
            const gone = await resumeAfterWait(waited.target, target, exhaustion.detail);
            if (gone) {
              return gone;
            }
            continue;
          }
          deps.onProgress?.(waited.reason);
          return {
            kind: 'ran',
            target,
            result: { ...result, reason: `${result.reason ?? ''} ${waited.reason}`.trim() },
            switches,
            escalations,
            exhaustedWithoutFallback: false,
          };
        }
        if ((!deps.settings.enabled && !deps.orchestrator) || cancelled()) {
          // Disabled fallback (or a loop cancelled while the failure was being
          // handled) keeps the existing single-CLI outcome.
          return { kind: 'ran', target, result, switches, escalations, exhaustedWithoutFallback: false };
        }

        let replacement: AgentCliTarget | undefined;
        let orchestrated: AgentCliOrchestratorDecision | undefined;
        if (deps.orchestrator) {
          orchestrated = await orchestrate(deps.orchestrator, request.kind, card);
          replacement = orchestrated.kind === 'chosen' ? orchestrated.target : undefined;
        } else {
          replacement = await selectReplacement();
        }
        if (cancelled()) {
          return { kind: 'ran', target, result, switches, escalations, exhaustedWithoutFallback: false };
        }
        let declinedWait: string | undefined;
        if (
          orchestrated?.kind === 'none'
          && deps.orchestrator?.behindPaceOnly === true
        ) {
          const paced = await waitForBehindPace(request.kind, card, orchestrated.ranking);
          if (paced.kind === 'cancelled') {
            return cancelledDuringWait;
          }
          if (paced.kind === 'resumed') {
            replacement = paced.decision.target;
            orchestrated = paced.decision;
            await appendIfCardExists(
              deps.store,
              card.id,
              formatOrchestratorChoiceEntry(paced.decision.chosen, request.kind, now()),
            );
          } else {
            declinedWait = paced.reason;
          }
        }
        if ((orchestrated?.kind === 'none' || !replacement) && waitEnabled && !replacement) {
          const waited = await waitForUsageReset(request.kind, card, target, exhaustion.detail);
          if (waited.kind === 'cancelled') {
            return cancelledDuringWait;
          }
          if (waited.kind === 'resumed') {
            const gone = await resumeAfterWait(waited.target, target, exhaustion.detail);
            if (gone) {
              return gone;
            }
            continue;
          }
          declinedWait = waited.reason;
        }
        if (orchestrated?.kind === 'none') {
          await pauseOrchestrated(
            card,
            request.kind,
            `${target.label} ran out of credits or hit its usage limit (${exhaustion.detail}). ${orchestrated.reason}${declinedWait !== undefined ? ` ${declinedWait}` : ''}`,
          );
          return { kind: 'ran', target, result, switches, escalations, exhaustedWithoutFallback: true };
        }
        if (!replacement) {
          const reason = formatNoFallbackReason(target, exhaustion.detail, [...exhausted], declinedWait);
          pausedReason = reason;
          await appendIfCardExists(
            deps.store,
            card.id,
            formatNoFallbackPauseEntry(target, request.kind, exhaustion.detail, [...exhausted], now(), declinedWait),
          );
          deps.onProgress?.(reason);
          deps.onPause?.(reason);
          return { kind: 'ran', target, result, switches, escalations, exhaustedWithoutFallback: true };
        }

        // Resolved against the replacement's own provider id and the stage that
        // was interrupted, so a workspace default configured for the exhausted
        // CLI is never carried over and the retry keeps its stage's rule.
        const toModel = resolveAgentCliModel(
          replacement.provider,
          deps.orchestrator ? undefined : cardPreferredModelFor(card, replacement.provider),
          deps.modelCatalog,
          {
            stage: request.kind,
            stageModels: deps.stageModels ?? EMPTY_AGENT_CLI_STAGE_MODELS,
          },
        );
        const record: AgentCliSwitchRecord = {
          at: now(),
          kind: request.kind,
          from: target,
          to: replacement,
          detail: exhaustion.detail,
          ...(toModel !== undefined ? { toModel } : {}),
        };
        switches.push(record);
        await appendIfCardExists(deps.store, card.id, formatAgentCliSwitchEntry(record));
        if (orchestrated?.kind === 'chosen') {
          await appendIfCardExists(
            deps.store,
            card.id,
            formatOrchestratorChoiceEntry(orchestrated.chosen, request.kind, now()),
          );
        }
        active = replacement;
        deps.onSwitch?.(record);
        deps.onProgress?.(
          `${target.label} ran out of credits; continuing the ${STAGE_LABELS[request.kind]} stage with ${replacement.label}.`,
        );

        const fresh = findCard(await deps.store.reload(), card.id);
        if (!fresh) {
          return {
            kind: 'ran',
            target: replacement,
            result: {
              completed: false,
              cancelled: false,
              activityBaseline: result.activityBaseline,
              reason: `Card ${card.id} no longer exists, so ${replacement.label} was not started.`,
            },
            switches,
            escalations,
            exhaustedWithoutFallback: false,
          };
        }
        card = fresh;
        handoffNote = formatReplacementHandoffNote(record);
        // A spent allowance costs no escalation step: the replacement provider
        // starts at its own resolved model and climbs its own ladder from the
        // bottom, so a rung spelled for the exhausted CLI is never carried over.
        escalatedModel = undefined;
      }

      // Defensive: every attempt either returns or consumes one provider, so
      // the loop above cannot fall through in practice.
      return {
        kind: 'ran',
        target: active,
        result: {
          completed: false,
          cancelled: false,
          activityBaseline: (card.activity ?? '').length,
          reason: 'Every configured AI loop CLI fallback and model escalation was tried for this stage without completing it.',
        },
        switches,
        escalations,
        exhaustedWithoutFallback: true,
      };
    } finally {
      busy = false;
    }
  };

  return {
    activeTarget: () => active,
    isPaused: () => pausedReason !== undefined,
    pauseReason: () => pausedReason,
    exhaustedProviders: () => [...exhausted],
    run,
  };
}

/**
 * Card Activity is the durable record of a switch: when it happened, which
 * stage was interrupted, which CLI stopped, which took over, and why. The
 * detail is the redacted CLI output line, so no credential reaches the file.
 */
export function formatAgentCliSwitchEntry(record: AgentCliSwitchRecord): string {
  return [
    `### ${record.at.toISOString()} - Switched from ${record.from.label} to ${record.to.label}`,
    `Interrupted stage: ${STAGE_LABELS[record.kind]}. Previous CLI: ${record.from.label}. Replacement CLI: ${record.to.label}. Exhaustion reason: ${record.detail}`,
    // Which model the replacement runs on belongs with the switch: the
    // workspace default is per provider, so a substitution can legitimately
    // change the model as well as the CLI.
    ...(record.toModel
      ? [`${record.to.label} model: "${record.toModel.model}", from ${describeAgentCliModelSource(record.toModel.source)}.`]
      : [`${record.to.label} runs on its own default model.`]),
    `The switch did not advance the card; ${record.to.label} is retrying the same ${STAGE_LABELS[record.kind]} stage against the current card and workspace state.`,
  ].join('\n');
}

/** Appended to the replacement's prompt so it knows why it is taking over. */
export function formatReplacementHandoffNote(record: AgentCliSwitchRecord): string {
  return [
    '## Handoff note',
    `${record.from.label} was running this ${STAGE_LABELS[record.kind]} stage and stopped because its credits or usage allowance ran out (${record.detail}).`,
    'You are continuing the same stage for the same card in the same workspace. Any files it already changed, acceptance criteria it already checked, and Activity entries it already wrote are still in place - keep them, finish only what is left, and do not restart completed work.',
    'The stage instructions and required completion markers above still apply in full: the card advances only after you satisfy them.',
  ].join('\n');
}

export function formatNoFallbackPauseEntry(
  target: AgentCliTarget,
  kind: AgentCliHandoffKind,
  detail: string,
  exhaustedProviders: readonly AgentCliProviderId[],
  timestamp: Date = new Date(),
  declinedWait?: string,
): string {
  return [
    `### ${timestamp.toISOString()} - AI loop paused: no AI CLI with an available allowance`,
    formatNoFallbackReason(target, detail, exhaustedProviders, declinedWait),
    `The ${STAGE_LABELS[kind]} stage was not completed and the card was not advanced.`,
  ].join('\n');
}

export function formatNoFallbackReason(
  target: AgentCliTarget,
  detail: string,
  exhaustedProviders: readonly AgentCliProviderId[],
  /** Why the loop did not wait for a reset, when waiting was enabled. */
  declinedWait?: string,
): string {
  const spent = exhaustedProviders.map((provider) => AGENT_CLI_LABELS[provider]).join(', ');
  return `${target.label} ran out of credits or hit its usage limit (${detail}), and no configured fallback CLI is available. Allowance already spent this run: ${spent || target.label}.${declinedWait !== undefined ? ` ${declinedWait}` : ''} Restore credits for one of these CLIs, or add an available CLI to mwnn-kanban.aiLoopCliFallbackOrder, then run the loop again.`;
}

function findCard(state: BoardState, cardId: string): Card | undefined {
  for (const column of state.columns) {
    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      return card;
    }
  }
  return undefined;
}

async function appendIfCardExists(
  store: AgentCliHandoffStore,
  cardId: string,
  entry: string,
): Promise<void> {
  if (findCard(await store.reload(), cardId)) {
    await store.appendActivity(cardId, entry);
  }
}
