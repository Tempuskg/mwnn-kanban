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
import type { BoardState, Card } from './types';
import { cardPreferredModelFor } from './utils';

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
   * Consulted immediately before *every* CLI process this runner launches -
   * the first attempt of a stage, a credit-fallback replacement, and a model
   * escalation retry alike - so a per-run dispatch budget counts and caps all
   * of them rather than only whole stages. A denial returns the `stopped`
   * outcome without spawning anything, which is what keeps a budget stop from
   * ever leaving a card half-dispatched. Omitting it launches unconditionally,
   * exactly as before.
   */
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

  /** Per card, then per provider: ladder rungs are provider-specific names. */
  const triedFor = (cardId: string, provider: AgentCliProviderId): Set<string> => {
    let byProvider = triedModels.get(cardId);
    if (!byProvider) {
      byProvider = new Map<AgentCliProviderId, Set<string>>();
      triedModels.set(cardId, byProvider);
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
      const maxAttempts = (deps.settings.providers.length + 1) * (maxLadder + 1);
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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
          observer ? { observer } : {},
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
        if (!deps.settings.enabled || cancelled()) {
          // Disabled fallback (or a loop cancelled while the failure was being
          // handled) keeps the existing single-CLI outcome.
          return { kind: 'ran', target, result, switches, escalations, exhaustedWithoutFallback: false };
        }

        const replacement = await selectReplacement();
        if (cancelled()) {
          return { kind: 'ran', target, result, switches, escalations, exhaustedWithoutFallback: false };
        }
        if (!replacement) {
          const reason = formatNoFallbackReason(target, exhaustion.detail, [...exhausted]);
          pausedReason = reason;
          await appendIfCardExists(
            deps.store,
            card.id,
            formatNoFallbackPauseEntry(target, request.kind, exhaustion.detail, [...exhausted], now()),
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
          cardPreferredModelFor(card, replacement.provider),
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
): string {
  return [
    `### ${timestamp.toISOString()} - AI loop paused: no AI CLI with an available allowance`,
    formatNoFallbackReason(target, detail, exhaustedProviders),
    `The ${STAGE_LABELS[kind]} stage was not completed and the card was not advanced.`,
  ].join('\n');
}

export function formatNoFallbackReason(
  target: AgentCliTarget,
  detail: string,
  exhaustedProviders: readonly AgentCliProviderId[],
): string {
  const spent = exhaustedProviders.map((provider) => AGENT_CLI_LABELS[provider]).join(', ');
  return `${target.label} ran out of credits or hit its usage limit (${detail}), and no configured fallback CLI is available. Allowance already spent this run: ${spent || target.label}. Restore credits for one of these CLIs, or add an available CLI to mwnn-kanban.aiLoopCliFallbackOrder, then run the loop again.`;
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
