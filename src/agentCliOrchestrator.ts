/**
 * Usage Orchestrator: choose which agent CLI runs the next dispatch from the
 * CLIs' own reports of their remaining allowance.
 *
 * One orchestrator lives for one AI loop run (or one Run Card with AI
 * dispatch). Before every dispatch it resolves every CLI, probes the available
 * ones concurrently with a bounded timeout, reuses a snapshot only within a
 * short freshness window, and ranks them with `rankAgentClis`. It chooses the
 * CLI only: the model and thinking level still resolve for that CLI through
 * the usual layers in `runAgentCliCardHandoff`.
 *
 * Cursor Agent CLI (`cursor`) and Cursor Agent CLI Other (`cursor-other`) are
 * separate selectable identities that share one executable. Ranking maps
 * `cursor` to the Auto pool and `cursor-other` to the Other Models pool.
 * Excluding either id only excludes that identity. Probes are shared across
 * both identities so the on-disk Cursor usage cache is read once per freshness
 * window.
 *
 * Probing never blocks or fails a dispatch: a probe that fails or times out
 * makes that CLI "unknown", which is still rankable, so a choice exists
 * whenever at least one CLI is available and not spent.
 *
 * No `vscode` import.
 */

import { redactSecrets } from './agentCliCredit';
import {
  AGENT_CLI_LABELS,
  AGENT_CLI_PROVIDER_IDS,
  agentCliExecutableProvider,
  resolveAgentCliTarget,
  type AgentCliHandoffKind,
  type AgentCliPathOverrides,
  type AgentCliProviderId,
  type AgentCliResolution,
  type AgentCliTarget,
  type ExecutableDiscoveryOptions,
} from './agentCliHandoff';
import {
  describeRankedAgentCli,
  rankAgentClis,
  selectCursorUsageForProvider,
  unknownUsage,
  type AgentCliRankCandidate,
  type AgentCliRankableUsageSnapshot,
  type AgentCliRanking,
  type AgentCliUsageSnapshot,
  type RankedAgentCli,
} from './agentCliUsage';
import {
  DEFAULT_USAGE_PROBE_TIMEOUT_MS,
  probeAgentCliUsage,
  type AgentCliUsageProbe,
} from './agentCliUsageProbe';
import { type CursorUsagePoolId } from './cursorModelPool';

/**
 * How long a usage snapshot is reused. Long enough that the several stages of
 * one card do not each start a probe process, short enough that a run spread
 * over an afternoon follows the allowances as they move.
 */
export const USAGE_SNAPSHOT_FRESHNESS_MS = 60_000;

/** Extra time allowed past a probe's own timeout before it is abandoned. */
const PROBE_GUARD_MS = 3_000;

export interface AgentCliOrchestratorDeps {
  readonly configuredPaths: AgentCliPathOverrides;
  readonly cwd: string;
  /** Aborting stops in-flight probes. */
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly freshnessMs?: number;
  readonly probeTimeoutMs?: number;
  /**
   * CLIs the user excluded from orchestration
   * (`mwnn-kanban.usageOrchestratorExcludedClis`). They are neither resolved
   * nor probed, and appear in the ranking as skipped.
   */
  readonly excludedProviders?: readonly AgentCliProviderId[];
  /**
   * When true (AI loop only, from `mwnn-kanban.usageOrchestratorBehindPaceOnly`),
   * only CLIs behind on every known-length window are eligible. Checked on
   * every `choose` call. Run Card with AI leaves this false.
   */
  readonly behindPaceOnly?: boolean;
  /** Test seams; default to the real resolution and probes. */
  readonly probe?: AgentCliUsageProbe;
  readonly resolveTarget?: (
    provider: AgentCliProviderId,
    configuredPaths: AgentCliPathOverrides,
    options: ExecutableDiscoveryOptions,
  ) => Promise<AgentCliResolution>;
}

/**
 * Per-dispatch context retained for callers that still pass Cursor model hints.
 * Ranking now keys pools off the selectable provider id (`cursor` vs
 * `cursor-other`); these fields are ignored for pool selection.
 */
export interface AgentCliOrchestratorChooseContext {
  /** @deprecated Pool selection uses the provider id; retained for call-site compat. */
  readonly cursorModel?: string;
  /** @deprecated Pool selection uses the provider id; retained for call-site compat. */
  readonly cursorProductDefault?: string;
}

export type AgentCliOrchestratorDecision =
  | {
      readonly kind: 'chosen';
      readonly target: AgentCliTarget;
      readonly chosen: RankedAgentCli;
      readonly ranking: AgentCliRanking;
    }
  | {
      readonly kind: 'none';
      readonly ranking: AgentCliRanking;
      readonly reason: string;
    };

export interface AgentCliUsageOrchestrator {
  /**
   * Probe (or reuse fresh snapshots), rank, and pick the best eligible CLI.
   */
  choose(context?: AgentCliOrchestratorChooseContext): Promise<AgentCliOrchestratorDecision>;
  /**
   * Record that a CLI stopped accepting work. It is not chosen again before
   * its reported reset time, or for the rest of the run when it has none
   * (which is always the case for an unknown-usage CLI).
   *
   * `cursor` and `cursor-other` are independent. Legacy
   * `markExhausted('cursor', { cursorPool: 'other-models' })` maps onto
   * `cursor-other`.
   */
  markExhausted(provider: AgentCliProviderId, options?: { readonly cursorPool?: CursorUsagePoolId }): void;
  /**
   * Undo `markExhausted` after the loop waited out that CLI's reset, so it is
   * eligible again and its next snapshot is probed fresh.
   */
  clearExhausted(provider: AgentCliProviderId): void;
  /** True when this run ranks only behind-pace CLIs (AI loop setting). */
  readonly behindPaceOnly: boolean;
}

interface CachedSnapshot {
  readonly at: number;
  readonly snapshot: AgentCliUsageSnapshot;
}

interface RunExclusion {
  readonly until?: number;
}

/** Map legacy `cursor` + pool options onto the selectable identity. */
export function exhaustionProviderId(
  provider: AgentCliProviderId,
  cursorPool?: CursorUsagePoolId,
): AgentCliProviderId {
  if (provider === 'cursor' && cursorPool === 'other-models') {
    return 'cursor-other';
  }
  if (provider === 'cursor-other' && cursorPool === 'auto') {
    return 'cursor';
  }
  return provider;
}

export function createAgentCliUsageOrchestrator(
  deps: AgentCliOrchestratorDeps,
): AgentCliUsageOrchestrator {
  const now = deps.now ?? (() => Date.now());
  const probe = deps.probe ?? probeAgentCliUsage;
  const resolveTarget = deps.resolveTarget ?? resolveAgentCliTarget;
  const freshnessMs = deps.freshnessMs ?? USAGE_SNAPSHOT_FRESHNESS_MS;
  const probeTimeoutMs = deps.probeTimeoutMs ?? DEFAULT_USAGE_PROBE_TIMEOUT_MS;
  /** Shared across `cursor` / `cursor-other` via executable provider key. */
  const cache = new Map<AgentCliProviderId, CachedSnapshot>();
  const exclusions = new Map<AgentCliProviderId, RunExclusion>();
  const excludedBySetting = new Set(deps.excludedProviders ?? []);
  const behindPaceOnly = deps.behindPaceOnly === true;

  const isExcluded = (provider: AgentCliProviderId, at: number): boolean => {
    const exclusion = exclusions.get(provider);
    return exclusion !== undefined && (exclusion.until === undefined || exclusion.until > at);
  };

  const readSnapshot = async (target: AgentCliTarget): Promise<AgentCliUsageSnapshot> => {
    const cacheKey = agentCliExecutableProvider(target.provider);
    const cached = cache.get(cacheKey);
    if (cached && now() - cached.at < freshnessMs) {
      return cached.snapshot;
    }
    let guard: ReturnType<typeof setTimeout> | undefined;
    const abandoned = new Promise<AgentCliUsageSnapshot>((resolve) => {
      guard = setTimeout(
        () => resolve(unknownUsage(target.provider, `${target.label} did not report usage in time.`)),
        probeTimeoutMs + PROBE_GUARD_MS,
      );
    });
    let snapshot: AgentCliUsageSnapshot;
    try {
      snapshot = await Promise.race([
        probe(target, {
          cwd: deps.cwd,
          timeoutMs: probeTimeoutMs,
          ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
        }).catch((error: unknown) =>
          unknownUsage(target.provider, `${target.label} usage probe failed: ${error instanceof Error ? error.message : String(error)}`)),
        abandoned,
      ]);
    } finally {
      clearTimeout(guard);
    }
    cache.set(cacheKey, { at: now(), snapshot });
    return snapshot;
  };

  const choose = async (
    // Reserved for future ranking hints; callers may already pass a context.
    context?: AgentCliOrchestratorChooseContext,
  ): Promise<AgentCliOrchestratorDecision> => {
    void context;
    const resolutions = await Promise.all(
      AGENT_CLI_PROVIDER_IDS.map(async (provider) => ({
        provider,
        resolution: excludedBySetting.has(provider)
          ? undefined
          : await resolveTarget(provider, deps.configuredPaths, { cwd: deps.cwd }),
      })),
    );
    const startedAt = now();
    const candidates = await Promise.all(
      resolutions.map(async ({ provider, resolution }): Promise<{
        readonly candidate: AgentCliRankCandidate;
        readonly target?: AgentCliTarget;
      }> => {
        if (resolution === undefined) {
          return {
            candidate: {
              provider,
              available: false,
              unavailableReason: `${AGENT_CLI_LABELS[provider]}: excluded by mwnn-kanban.usageOrchestratorExcludedClis`,
            },
          };
        }
        if (!resolution.available) {
          return {
            candidate: {
              provider: resolution.provider,
              available: false,
              unavailableReason: `${AGENT_CLI_LABELS[resolution.provider]}: executable unavailable (${resolution.reason})`,
            },
          };
        }
        const { target } = resolution;
        if (isExcluded(target.provider, startedAt)) {
          return { candidate: { provider: target.provider, available: true }, target };
        }
        const raw = await readSnapshot(target);
        const snapshot = selectCursorUsageForProvider(raw, target.provider);
        if (snapshot.kind === 'reported' && snapshot.remainingPercent <= 0 && snapshot.resetsAt === undefined) {
          exclusions.set(target.provider, {});
        }
        return { candidate: { provider: target.provider, available: true, snapshot }, target };
      }),
    );

    const ranking = rankAgentClis(
      candidates.map((entry) => entry.candidate),
      new Map(exclusions),
      now(),
      behindPaceOnly ? { behindPaceOnly: true } : undefined,
    );
    const chosen = ranking.ranked[0];
    const target = chosen
      ? candidates.find((entry) => entry.candidate.provider === chosen.provider)?.target
      : undefined;
    if (!chosen || !target) {
      return { kind: 'none', ranking, reason: formatNoEligibleCliReason(ranking) };
    }
    return { kind: 'chosen', target, chosen, ranking };
  };

  const markExhausted = (
    provider: AgentCliProviderId,
    options?: { readonly cursorPool?: CursorUsagePoolId },
  ): void => {
    const identity = exhaustionProviderId(provider, options?.cursorPool);
    const snapshot = cache.get(agentCliExecutableProvider(identity))?.snapshot;
    const rankable = rankableFromCache(snapshot, identity);
    const until = rankable?.kind === 'reported'
      && rankable.resetsAt !== undefined
      && rankable.resetsAt > now()
      ? rankable.resetsAt
      : undefined;
    exclusions.set(identity, until !== undefined ? { until } : {});
    // Shared Cursor probe: drop the executable-provider cache entry.
    cache.delete(agentCliExecutableProvider(identity));
  };

  const clearExhausted = (provider: AgentCliProviderId): void => {
    exclusions.delete(provider);
    cache.delete(agentCliExecutableProvider(provider));
  };

  return { choose, markExhausted, clearExhausted, behindPaceOnly };
}

function rankableFromCache(
  snapshot: AgentCliUsageSnapshot | undefined,
  provider: AgentCliProviderId,
): AgentCliRankableUsageSnapshot | undefined {
  if (snapshot === undefined) {
    return undefined;
  }
  if (snapshot.kind === 'cursor-pools') {
    return selectCursorUsageForProvider(snapshot, provider);
  }
  return snapshot;
}

const STAGE_LABELS: Record<AgentCliHandoffKind, string> = {
  implementation: 'implementation',
  definition: 'definition',
  triage: 'triage',
  verification: 'verification',
};

/** Why the chosen CLI won, in one sentence for the card's Activity. */
export function describeOrchestratorChoice(chosen: RankedAgentCli): string {
  const label = AGENT_CLI_LABELS[chosen.provider];
  const { snapshot } = chosen;
  if (snapshot.kind === 'unknown') {
    return `${label}'s usage is unknown (${snapshot.reason}), so it is being drained until it stops accepting work.`;
  }
  const remaining = `${Math.round(snapshot.remainingPercent * 10) / 10}%`;
  const paceNote = chosen.paceVariancePoints !== undefined
    ? ` Pace variance ${formatSignedPoints(chosen.paceVariancePoints)}`
      + (chosen.paceElapsedPercent !== undefined
        ? ` (${Math.round(chosen.paceElapsedPercent * 10) / 10}% elapsed).`
        : '.')
    : '';
  if (chosen.rule === 'soonest-reset' && snapshot.resetsAt !== undefined) {
    return `${label} reports ${remaining} remaining, resetting ${new Date(snapshot.resetsAt).toISOString()} - the soonest reset among the CLIs with usage left, so it is spent before it is lost.${paceNote}`;
  }
  return `${label} reports ${remaining} remaining and no reset time - the most among the remaining CLIs.${paceNote}`;
}

function formatSignedPoints(variancePoints: number): string {
  const points = Math.round(variancePoints * 10) / 10;
  return `${points > 0 ? '+' : ''}${points} pts`;
}

/** The Activity entry recorded for each orchestrated dispatch. */
export function formatOrchestratorChoiceEntry(
  chosen: RankedAgentCli,
  kind: AgentCliHandoffKind,
  timestamp: Date = new Date(),
): string {
  return redactSecrets([
    `### ${timestamp.toISOString()} - Usage Orchestrator chose ${AGENT_CLI_LABELS[chosen.provider]}`,
    `Stage: ${STAGE_LABELS[kind]}. ${describeOrchestratorChoice(chosen)}`,
  ].join('\n'));
}

/** The full candidate ranking, with skipped CLIs and why, for the output channel. */
export function formatOrchestratorRanking(
  ranking: AgentCliRanking,
  kind: AgentCliHandoffKind,
  cardTitle: string,
): string[] {
  return [
    `Usage Orchestrator ranking for the ${STAGE_LABELS[kind]} stage of "${cardTitle}":`,
    ...(ranking.ranked.length > 0
      ? ranking.ranked.map((entry, index) => `  ${index + 1}. ${describeRankedAgentCli(entry)}`)
      : ['  (no eligible CLI)']),
    ...ranking.skipped.map((entry) => `  skipped - ${entry.reason}`),
  ].map(redactSecrets);
}

export function formatNoEligibleCliReason(ranking: AgentCliRanking): string {
  const skipped = ranking.skipped.map((entry) => entry.reason).join(' ');
  return redactSecrets(
    `Usage Orchestrator found no agent CLI with usage left to run this stage.${skipped ? ` ${skipped}` : ''} Install or restore an agent CLI, or wait for a reset, then run again.`,
  );
}
