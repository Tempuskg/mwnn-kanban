/**
 * Per-run dispatch accounting and budget enforcement for the AI board loop.
 *
 * A loop run can otherwise dispatch an unbounded number of agent handoffs with
 * nothing to show for it afterwards: the only stop signal is credit exhaustion
 * (`agentCliFallback`), which by definition arrives once the allowance is
 * already spent. This module adds the two things that were missing - a tally of
 * what a run actually dispatched, and an optional hard cap on how much it may
 * dispatch before it stops on its own.
 *
 * Deliberately *not* a cost model. Prices change between extension releases and
 * the CLIs do not report usage in any shared format, so a built-in per-model
 * price table would quietly produce authoritative-looking numbers that are
 * wrong. Everything here is either something the extension observed itself (how
 * many handoffs it launched, for which stage, on which provider, on which
 * resolved model) or a line the CLI printed, copied verbatim and attributed to
 * that CLI. No figure is ever synthesized, and a CLI that reports nothing
 * yields dispatch counts only.
 *
 * The cap is checked *before* a process is launched, never during one: a denied
 * reservation means no CLI was started for that card, so a run can never stop
 * with a handoff half-dispatched. The stop is latched, so a late exit or output
 * event arriving after the cap was hit can neither restart dispatching nor
 * disturb the tally.
 *
 * No `vscode` import: the raw setting arrives as `unknown` and is validated
 * here, so the whole policy is unit-testable and `src/extension.ts` only has to
 * read the configuration key and surface the report.
 */

import { redactSecrets } from './agentCliCredit';
import type { AgentCliHandoffKind } from './agentCliStages';

/** The user-facing id of the per-run dispatch cap. */
export const AI_LOOP_MAX_DISPATCHES_SETTING = 'mwnn-kanban.aiLoopMaxDispatches';

/**
 * An upper bound on the cap itself. A cap this large is indistinguishable from
 * "disabled" in practice, and it keeps a nonsense setting from being echoed
 * back at the user as if it meant something.
 */
const MAX_CONFIGURABLE_DISPATCHES = 10_000;

/** Keep one hostile CLI from filling the report, or memory, with noise. */
const MAX_USAGE_LINES_PER_RUN = 12;
const MAX_USAGE_LINE_LENGTH = 200;
/** Only the tail is scanned: CLIs print their usage summary last. */
const MAX_SCANNED_OUTPUT = 64 * 1024;

/**
 * Read `mwnn-kanban.aiLoopMaxDispatches` from an unvalidated configuration
 * value. Anything that is not a positive whole number - `0`, a negative, a
 * fraction, a string, `null` - means "no cap", which is the default and leaves
 * run length and behavior exactly as they were before this feature existed.
 */
export function readAiLoopMaxDispatches(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const limit = Math.trunc(value);
  if (limit < 1) {
    return undefined;
  }
  return Math.min(limit, MAX_CONFIGURABLE_DISPATCHES);
}

/** One handoff the loop is about to launch. */
export interface AiLoopDispatchIntent {
  readonly stage: AgentCliHandoffKind;
  /** Stable provider id, so the grouping survives a label change. */
  readonly provider: string;
  /** Human-readable provider name, used in the report. */
  readonly providerLabel: string;
  readonly cardId: string;
  readonly cardTitle: string;
}

/** Why a run stopped on budget, with everything the user needs to act on it. */
export interface AiLoopBudgetStop {
  readonly limit: number;
  /** Dispatches already made when the cap denied the next one; equals `limit`. */
  readonly dispatches: number;
  /** The handoff that was refused - never started, so the card is untouched. */
  readonly intent: AiLoopDispatchIntent;
}

export type AiLoopBudgetReservation =
  | {
      readonly allowed: true;
      /** 1-based position of this dispatch within the run. */
      readonly dispatch: number;
      /** Dispatches left after this one; undefined when no cap is configured. */
      readonly remaining: number | undefined;
    }
  | { readonly allowed: false; readonly stop: AiLoopBudgetStop };

/** One CLI-reported usage or cost line, attributed to the CLI that printed it. */
export interface AiLoopUsageLine {
  readonly providerLabel: string;
  readonly text: string;
}

export interface AiLoopStageCount {
  readonly stage: AgentCliHandoffKind;
  readonly count: number;
}

export interface AiLoopProviderCount {
  readonly provider: string;
  readonly providerLabel: string;
  readonly count: number;
}

export interface AiLoopModelCount {
  readonly provider: string;
  readonly providerLabel: string;
  /** Absent when the dispatch ran on whatever model the CLI defaults to. */
  readonly model?: string;
  readonly count: number;
}

export interface AiLoopBudgetTally {
  readonly total: number;
  /** The configured cap, when one is set. */
  readonly limit?: number;
  readonly byStage: readonly AiLoopStageCount[];
  readonly byProvider: readonly AiLoopProviderCount[];
  readonly byModel: readonly AiLoopModelCount[];
  /** Verbatim, redacted lines the CLIs printed about their own usage. */
  readonly usage: readonly AiLoopUsageLine[];
  readonly stop?: AiLoopBudgetStop;
}

export interface AiLoopBudget {
  /** The configured cap, or undefined when the cap is disabled. */
  readonly limit: number | undefined;
  /**
   * Claim one dispatch immediately before launching it. A denial latches: every
   * later reservation is refused with the same stop, so nothing the loop does
   * afterwards - including a late failure handler retrying a stage - can start
   * another handoff.
   */
  reserve(intent: AiLoopDispatchIntent): AiLoopBudgetReservation;
  /**
   * Attach the model a just-finished dispatch actually ran on. Handoffs are
   * strictly serial (the fallback runner's own busy guard awaits each process),
   * so this settles the most recent unsettled reservation. A stray call with
   * nothing outstanding is ignored rather than counted.
   */
  settle(model?: string): void;
  /** Feed raw CLI output through the usage scanner. Never throws. */
  recordUsage(providerLabel: string, output: unknown): void;
  /** The latched budget stop, once the cap has refused a dispatch. */
  stop(): AiLoopBudgetStop | undefined;
  tally(): AiLoopBudgetTally;
}

interface DispatchRecord {
  readonly intent: AiLoopDispatchIntent;
  model?: string;
  settled: boolean;
}

export interface AiLoopBudgetOptions {
  /** Omit, or pass undefined, for an unlimited run. */
  readonly maxDispatches?: number;
}

/**
 * Create the ledger for one loop run. A budget with no limit still tallies:
 * reporting what a run consumed is useful on its own, and is the only part of
 * this module that is on by default.
 */
export function createAiLoopBudget(options: AiLoopBudgetOptions = {}): AiLoopBudget {
  const limit = readAiLoopMaxDispatches(options.maxDispatches);
  const dispatches: DispatchRecord[] = [];
  const usage: AiLoopUsageLine[] = [];
  const seenUsage = new Set<string>();
  let stopped: AiLoopBudgetStop | undefined;

  return {
    limit,
    reserve(intent) {
      if (stopped) {
        return { allowed: false, stop: stopped };
      }
      if (limit !== undefined && dispatches.length >= limit) {
        stopped = { limit, dispatches: dispatches.length, intent };
        return { allowed: false, stop: stopped };
      }
      dispatches.push({ intent, settled: false });
      return {
        allowed: true,
        dispatch: dispatches.length,
        remaining: limit === undefined ? undefined : limit - dispatches.length,
      };
    },
    settle(model) {
      const record = dispatches[dispatches.length - 1];
      if (!record || record.settled) {
        return;
      }
      record.settled = true;
      if (typeof model === 'string' && model.trim().length > 0) {
        record.model = model.trim();
      }
    },
    recordUsage(providerLabel, output) {
      for (const text of parseCliUsageLines(output)) {
        if (usage.length >= MAX_USAGE_LINES_PER_RUN) {
          return;
        }
        const key = `${providerLabel}\u0000${text}`;
        if (seenUsage.has(key)) {
          continue;
        }
        seenUsage.add(key);
        usage.push({ providerLabel, text });
      }
    },
    stop: () => stopped,
    tally: () => buildTally(dispatches, usage, limit, stopped),
  };
}

/** Stage order in the report; fixed so two runs read the same way. */
const STAGE_ORDER: readonly AgentCliHandoffKind[] = [
  'implementation',
  'definition',
  'triage',
  'verification',
];

function buildTally(
  dispatches: readonly DispatchRecord[],
  usage: readonly AiLoopUsageLine[],
  limit: number | undefined,
  stopped: AiLoopBudgetStop | undefined,
): AiLoopBudgetTally {
  const byStage = new Map<AgentCliHandoffKind, number>();
  const byProvider = new Map<string, AiLoopProviderCount>();
  const byModel = new Map<string, AiLoopModelCount>();

  for (const record of dispatches) {
    const { stage, provider, providerLabel } = record.intent;
    byStage.set(stage, (byStage.get(stage) ?? 0) + 1);

    const providerEntry = byProvider.get(provider);
    byProvider.set(
      provider,
      providerEntry
        ? { ...providerEntry, count: providerEntry.count + 1 }
        : { provider, providerLabel, count: 1 },
    );

    // Keyed by provider *and* model: model names are provider-specific, so the
    // same name from two CLIs is not the same thing and must not be merged.
    const modelKey = `${provider}\u0000${record.model ?? ''}`;
    const modelEntry = byModel.get(modelKey);
    byModel.set(
      modelKey,
      modelEntry
        ? { ...modelEntry, count: modelEntry.count + 1 }
        : {
            provider,
            providerLabel,
            ...(record.model !== undefined ? { model: record.model } : {}),
            count: 1,
          },
    );
  }

  return {
    total: dispatches.length,
    ...(limit !== undefined ? { limit } : {}),
    byStage: STAGE_ORDER.filter((stage) => byStage.has(stage)).map((stage) => ({
      stage,
      count: byStage.get(stage) ?? 0,
    })),
    byProvider: [...byProvider.values()],
    byModel: [...byModel.values()],
    usage: [...usage],
    ...(stopped !== undefined ? { stop: stopped } : {}),
  };
}

/** How the run ended, so the report can say so without guessing. */
export type AiLoopRunOutcome = 'finished' | 'cancelled' | 'budget' | 'paused';

const OUTCOME_PREFIX: Record<AiLoopRunOutcome, string> = {
  finished: 'AI loop usage',
  cancelled: 'AI loop usage before it was cancelled',
  budget: 'AI loop usage at the dispatch cap',
  paused: 'AI loop usage before it paused',
};

/**
 * The user-facing tally for one run. Counts come from the extension's own
 * dispatch records; every other figure is a line a CLI printed, quoted and
 * named. A run whose CLIs reported no usage shows counts and nothing else -
 * there is no fallback estimate, because there is nothing to estimate from.
 */
export function formatAiLoopBudgetTally(
  tally: AiLoopBudgetTally,
  outcome: AiLoopRunOutcome = 'finished',
): string {
  const prefix = OUTCOME_PREFIX[outcome];
  if (tally.total === 0) {
    return `${prefix}: no agent handoffs were dispatched.`;
  }

  const parts: string[] = [`${tally.total} dispatch${tally.total === 1 ? '' : 'es'}`];
  if (tally.limit !== undefined) {
    parts.push(`cap ${tally.limit}`);
  }
  parts.push(
    `by stage: ${tally.byStage.map((entry) => `${entry.stage} ${entry.count}`).join(', ')}`,
  );
  parts.push(
    `by model: ${tally.byModel
      .map((entry) => `${entry.providerLabel} on ${entry.model ?? 'its default model'} ${entry.count}`)
      .join(', ')}`,
  );

  const report = `${prefix}: ${parts.join('; ')}.`;
  if (tally.usage.length === 0) {
    return report;
  }
  const reported = tally.usage
    .map((line) => `${line.providerLabel} reported "${line.text}"`)
    .join('; ');
  return `${report} ${reported}.`;
}

/** The notification shown when a run stops because the cap was reached. */
export function formatAiLoopBudgetStopMessage(stop: AiLoopBudgetStop): string {
  return [
    `MWNN AI loop stopped at its dispatch cap of ${stop.limit}.`,
    `The ${stop.intent.stage} handoff for "${stop.intent.cardTitle}" was not started and the card was not advanced.`,
    'This is the configured budget, not spent CLI credits.',
    `Raise or clear ${AI_LOOP_MAX_DISPATCHES_SETTING} (0 removes the cap), then run the loop again.`,
  ].join(' ');
}

/**
 * Card Activity is the durable record of why this card stopped where it did.
 * Worded so it can never be mistaken for the credit-exhaustion pause entry: the
 * allowance is untouched, the extension simply refused to spend more of it.
 */
export function formatAiLoopBudgetStopEntry(
  stop: AiLoopBudgetStop,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - AI loop stopped: dispatch budget reached`,
    `The run had already made ${stop.dispatches} of its ${stop.limit} allowed dispatches, so the ${stop.intent.stage} handoff for this card was never started and no CLI ran for it. The card was left where it is, unadvanced.`,
    `This is the configured per-run dispatch budget (${AI_LOOP_MAX_DISPATCHES_SETTING}), not exhausted CLI credits. Raise or clear that setting, then run the loop again.`,
  ].join('\n');
}

/**
 * Lines that look like a CLI reporting its own usage or cost. Every candidate
 * line must also contain a digit, so prose that merely mentions tokens or cost
 * is not quoted back at the user as if it were a measurement.
 */
const USAGE_PATTERNS: readonly RegExp[] = [
  /\btokens?\b/i,
  /\btoken usage\b/i,
  /\btotal cost\b/i,
  /\bcost\b[^\n]{0,20}[$\d]/i,
  /\busage\b[^\n]{0,20}\d/i,
  /\bcontext (?:window|used|left|remaining)\b/i,
];

/** ANSI/OSC escape sequences CLIs emit around their summary lines. */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/**
 * Pull usage or cost lines out of raw CLI output.
 *
 * Nothing is computed: a returned line is a line the CLI printed, with escape
 * sequences and control characters stripped, credentials redacted, and length
 * bounded. Non-string, empty, binary, or simply uninteresting output yields an
 * empty list, which is what "this CLI reports nothing" looks like downstream.
 */
export function parseCliUsageLines(output: unknown): readonly string[] {
  if (typeof output !== 'string' || output.length === 0) {
    return [];
  }
  const scanned = output.length > MAX_SCANNED_OUTPUT
    ? output.slice(output.length - MAX_SCANNED_OUTPUT)
    : output;

  const found: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of scanned.split(/\r?\n/)) {
    if (found.length >= MAX_USAGE_LINES_PER_RUN) {
      break;
    }
    const line = rawLine
      .replace(ANSI_PATTERN, '')
      .replace(CONTROL_PATTERN, ' ')
      .trim();
    if (line.length === 0 || !/\d/.test(line)) {
      continue;
    }
    if (!USAGE_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }
    const text = redactSecrets(line).slice(0, MAX_USAGE_LINE_LENGTH).trim();
    if (text.length === 0 || seen.has(text)) {
      continue;
    }
    seen.add(text);
    found.push(text);
  }
  return found;
}
