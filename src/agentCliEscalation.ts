/**
 * Automatic model escalation for the AI board loop.
 *
 * When an attempt on the configured cheaper model reports `STATUS: BLOCKED` or
 * exits without the stage's completion evidence, the loop can retry the *same*
 * stage of the *same* card on the next model of a user-configured ladder
 * instead of giving up on the card. The feature is opt-in, ordered, and
 * bounded: each model is tried at most once per card per loop run, and when the
 * ladder runs out the original failure stands.
 *
 * This is deliberately an escalation *ladder* rather than a difficulty
 * heuristic over the card's text. A ladder is observable and testable - the
 * trigger is a signal the CLI actually produced, and the replacement is the
 * next configured name - while guessing "this card looks hard" from a title is
 * neither reproducible nor checkable.
 *
 * Only two outcomes escalate, and both mean "the attempt was inconclusive":
 * a blocked report, and missing completion evidence after a clean exit. Credit
 * exhaustion belongs to the CLI fallback in `agentCliFallback` (another *model*
 * on the same spent account would fail identically), and authentication
 * failures, network failures, cancellation, and a rejected model name are all
 * problems a stronger model cannot solve - retrying them would spend the
 * expensive model on a fault the user still has to fix.
 *
 * An escalation is never progress on its own: the replacement model still has
 * to satisfy the same stage completion and verification evidence rules in
 * `runAgentCliCardHandoff` before the loop advances anything.
 *
 * No `vscode` import: the raw setting arrives as `unknown` and is validated
 * here, so the whole policy is unit-testable and `src/extension.ts` only has to
 * read the configuration keys.
 */

import {
  AGENT_CLI_ESCALATION_LADDER_SETTING,
  readAgentCliModelCatalog,
  type AgentCliModelCatalog,
} from './agentCliModels';
import type { AgentCliProviderId } from './agentCliProviders';
import type { AgentCliHandoffKind } from './agentCliStages';
import type { AgentCliCardHandoffResult, AgentCliTarget } from './agentCliHandoff';

export { AGENT_CLI_ESCALATION_LADDER_SETTING } from './agentCliModels';

/** The user-facing id of the on/off switch for this feature. */
export const AGENT_CLI_ESCALATION_ENABLED_SETTING = 'mwnn-kanban.aiLoopModelEscalationEnabled';

/** The user-facing id of the opt-in that lets escalation override a card model. */
export const AGENT_CLI_ESCALATION_OVERRIDE_CARD_SETTING =
  'mwnn-kanban.aiLoopModelEscalationOverridesCardModel';

/**
 * Ordered model names per provider. Structurally identical to the workspace
 * model catalog - a per-provider list of validated names - because model names
 * are provider-specific and the credit fallback can change the active provider
 * mid-run, so a replacement CLI must climb its *own* ladder rather than inherit
 * one spelled for another CLI. The meaning differs: here the order is "try this
 * next", not "this one is the default".
 */
export type AgentCliEscalationLadders = AgentCliModelCatalog;

/** The "no ladder configured" value, and the default for every resolution. */
export const EMPTY_AGENT_CLI_ESCALATION_LADDERS: AgentCliEscalationLadders = Object.freeze({});

export interface AgentCliEscalationSettings {
  /** Off by default: a disabled ladder preserves the single-attempt behavior. */
  readonly enabled: boolean;
  /** Models to try, in order, after an inconclusive attempt on this provider. */
  readonly ladders: AgentCliEscalationLadders;
  /**
   * Whether a card that names its own model for the active provider may be escalated away
   * from it. Off by default: a card-level model is an explicit human choice for
   * *this* work, and silently overriding it would make the card's own field a
   * suggestion rather than a setting.
   */
  readonly overrideCardModel: boolean;
}

export const DISABLED_AGENT_CLI_ESCALATION: AgentCliEscalationSettings = Object.freeze({
  enabled: false,
  ladders: EMPTY_AGENT_CLI_ESCALATION_LADDERS,
  overrideCardModel: false,
});

/**
 * Read `mwnn-kanban.aiLoopModelEscalationLadder` from an unvalidated
 * configuration value. Shares the model catalog's validation - unknown provider
 * keys, non-string entries, blanks, and duplicates are all dropped - so a
 * malformed ladder degrades to "no escalation for this CLI" instead of breaking
 * a dispatch, and a name that is unusable as a single spawn argument cannot
 * enter through this setting either.
 */
export function readAgentCliEscalationLadders(value: unknown): AgentCliEscalationLadders {
  return readAgentCliModelCatalog(value);
}

/** One provider's ladder, in configured order, or an empty list. */
export function escalationLadderFor(
  ladders: AgentCliEscalationLadders,
  provider: AgentCliProviderId,
): readonly string[] {
  return ladders[provider] ?? [];
}

/** Why an attempt was inconclusive enough to be worth a stronger model. */
export type AgentCliEscalationTriggerKind = 'blocked' | 'missing-evidence';

export interface AgentCliEscalationTrigger {
  readonly kind: AgentCliEscalationTriggerKind;
  /** The agent's own blocked reason, or the missing-evidence explanation. */
  readonly detail: string;
}

/**
 * Classify one finished hand-off as "a stronger model is worth trying".
 *
 * Returns undefined for every outcome a different model cannot change: a
 * successful run, a cancelled run, spent credits, a refused model name, a
 * deleted card, and any process-level failure (which is where authentication
 * and network problems land). That exclusion list is the point of the function
 * - escalation must cost money only when the attempt itself was inconclusive.
 */
export function detectAgentCliEscalationTrigger(
  result: AgentCliCardHandoffResult,
): AgentCliEscalationTrigger | undefined {
  if (result.cancelled || result.creditExhaustion) {
    return undefined;
  }
  if (result.completed) {
    // The agent did everything asked of it and still could not finish: the one
    // "success" worth retrying, because the stage produced a real report.
    return result.terminalStatus?.kind === 'blocked'
      ? { kind: 'blocked', detail: result.terminalStatus.reason }
      : undefined;
  }
  return result.failure === 'missing-evidence'
    ? {
        kind: 'missing-evidence',
        detail: result.reason ?? 'the stage produced no completion evidence.',
      }
    : undefined;
}

/**
 * The next rung above `currentModel`, skipping anything already tried for this
 * card. A model absent from the ladder (an unrelated card model, or the
 * provider default) starts at the first rung; the last rung escalates to
 * nothing, which is what stops a card cycling between models.
 */
export function selectNextEscalationModel(
  ladder: readonly string[],
  currentModel: string | undefined,
  tried: ReadonlySet<string>,
): string | undefined {
  const currentIndex = currentModel === undefined ? -1 : ladder.indexOf(currentModel);
  for (let index = currentIndex + 1; index < ladder.length; index += 1) {
    const candidate = ladder[index];
    if (candidate !== undefined && candidate !== currentModel && !tried.has(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export interface AgentCliEscalationRecord {
  readonly at: Date;
  readonly kind: AgentCliHandoffKind;
  /** Unchanged by an escalation: only the model moves. */
  readonly target: AgentCliTarget;
  /** The model the failed attempt ran on, or undefined for the CLI's default. */
  readonly from?: string;
  readonly to: string;
  readonly trigger: AgentCliEscalationTrigger;
}

const STAGE_LABELS: Record<AgentCliHandoffKind, string> = {
  implementation: 'implementation',
  definition: 'definition',
  triage: 'triage',
  verification: 'verification',
};

function describeTrigger(trigger: AgentCliEscalationTrigger): string {
  return trigger.kind === 'blocked'
    ? `the attempt reported itself blocked (${trigger.detail})`
    : `the attempt produced no stage completion evidence (${trigger.detail})`;
}

/**
 * Card Activity is the durable record of an escalation: when it happened, which
 * stage it belonged to, which model gave up, which one is taking over, and why.
 * The trigger detail is either the agent's own blocked reason or the
 * evidence-rule explanation - both already redacted by the hand-off layer - so
 * no credential reaches the card file.
 */
export function formatAgentCliEscalationEntry(record: AgentCliEscalationRecord): string {
  return [
    `### ${record.at.toISOString()} - Escalated to a stronger model`,
    `Stage: ${STAGE_LABELS[record.kind]}. CLI: ${record.target.label}. Previous model: ${record.from ?? `${record.target.label}'s default model`}. Replacement model: "${record.to}". Trigger: ${describeTrigger(record.trigger)}.`,
    `The escalation did not advance the card; "${record.to}" is retrying the same ${STAGE_LABELS[record.kind]} stage against the current card and workspace state, and the card advances only if it satisfies the same completion evidence rules.`,
  ].join('\n');
}

/** Appended to the retry's prompt so it knows why it is taking over. */
export function formatEscalationHandoffNote(record: AgentCliEscalationRecord): string {
  return [
    '## Escalation note',
    `This ${STAGE_LABELS[record.kind]} stage was already attempted on ${record.from ? `model "${record.from}"` : `${record.target.label}'s default model`} and ${describeTrigger(record.trigger)}.`,
    `You are retrying the same stage for the same card in the same workspace on model "${record.to}". Any files the previous attempt changed, acceptance criteria it already checked, and Activity entries it already wrote are still in place - keep them, finish only what is left, and do not restart completed work.`,
    'Treat the reason above as the thing to solve, not as permission to skip it: the stage instructions and required completion markers above still apply in full, and the card advances only after you satisfy them.',
  ].join('\n');
}

/** Message shown when escalation is on but the ladder has nothing left to try. */
export function formatLadderExhaustedReason(
  target: AgentCliTarget,
  kind: AgentCliHandoffKind,
  currentModel: string | undefined,
): string {
  return `${target.label} did not complete the ${STAGE_LABELS[kind]} stage on ${currentModel ? `model "${currentModel}"` : 'its default model'}, and no further model is configured for it in ${AGENT_CLI_ESCALATION_LADDER_SETTING}. Add a stronger model to that ladder, or finish the card by hand.`;
}
