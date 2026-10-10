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
  unknownUsage,
  type AgentCliRankCandidate,
  type AgentCliRanking,
  type AgentCliUsageSnapshot,
  type RankedAgentCli,
} from './agentCliUsage';
import {
  DEFAULT_USAGE_PROBE_TIMEOUT_MS,
  probeAgentCliUsage,
  type AgentCliUsageProbe,
} from './agentCliUsageProbe';

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
  /** Test seams; default to the real resolution and probes. */
  readonly probe?: AgentCliUsageProbe;
  readonly resolveTarget?: (
    provider: AgentCliProviderId,
    configuredPaths: AgentCliPathOverrides,
    options: ExecutableDiscoveryOptions,
  ) => Promise<AgentCliResolution>;
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
  /** Probe (or reuse fresh snapshots), rank, and pick the best eligible CLI. */
  choose(): Promise<AgentCliOrchestratorDecision>;
  /**
   * Record that a CLI stopped accepting work. It is not chosen again before
   * its reported reset time, or for the rest of the run when it has none
   * (which is always the case for an unknown-usage CLI).
   */
  markExhausted(provider: AgentCliProviderId): void;
}

interface CachedSnapshot {
  readonly at: number;
  readonly snapshot: AgentCliUsageSnapshot;
}

export function createAgentCliUsageOrchestrator(
  deps: AgentCliOrchestratorDeps,
): AgentCliUsageOrchestrator {
  const now = deps.now ?? (() => Date.now());
  const probe = deps.probe ?? probeAgentCliUsage;
  const resolveTarget = deps.resolveTarget ?? resolveAgentCliTarget;
  const freshnessMs = deps.freshnessMs ?? USAGE_SNAPSHOT_FRESHNESS_MS;
  const probeTimeoutMs = deps.probeTimeoutMs ?? DEFAULT_USAGE_PROBE_TIMEOUT_MS;
  const cache = new Map<AgentCliProviderId, CachedSnapshot>();
  const exclusions = new Map<AgentCliProviderId, { readonly until?: number }>();

  const isExcluded = (provider: AgentCliProviderId, at: number): boolean => {
    const exclusion = exclusions.get(provider);
    return exclusion !== undefined && (exclusion.until === undefined || exclusion.until > at);
  };

  const readSnapshot = async (target: AgentCliTarget): Promise<AgentCliUsageSnapshot> => {
    const cached = cache.get(target.provider);
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
    cache.set(target.provider, { at: now(), snapshot });
    return snapshot;
  };

  const choose = async (): Promise<AgentCliOrchestratorDecision> => {
    const resolutions = await Promise.all(
      AGENT_CLI_PROVIDER_IDS.map((provider) =>
        resolveTarget(provider, deps.configuredPaths, { cwd: deps.cwd })),
    );
    const startedAt = now();
    const candidates = await Promise.all(
      resolutions.map(async (resolution): Promise<{
        readonly candidate: AgentCliRankCandidate;
        readonly target?: AgentCliTarget;
      }> => {
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
          // No probe for a CLI that cannot be chosen anyway.
          return { candidate: { provider: target.provider, available: true }, target };
        }
        const snapshot = await readSnapshot(target);
        if (snapshot.kind === 'reported' && snapshot.remainingPercent <= 0 && snapshot.resetsAt === undefined) {
          // Spent with nothing to wait for: out for the rest of the run.
          exclusions.set(target.provider, {});
        }
        return { candidate: { provider: target.provider, available: true, snapshot }, target };
      }),
    );

    const ranking = rankAgentClis(
      candidates.map((entry) => entry.candidate),
      exclusions,
      now(),
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

  const markExhausted = (provider: AgentCliProviderId): void => {
    const snapshot = cache.get(provider)?.snapshot;
    const until = snapshot?.kind === 'reported' && snapshot.resetsAt !== undefined && snapshot.resetsAt > now()
      ? snapshot.resetsAt
      : undefined;
    exclusions.set(provider, until !== undefined ? { until } : {});
    // Re-read after the reset rather than trusting the figure that just failed.
    cache.delete(provider);
  };

  return { choose, markExhausted };
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
  if (chosen.rule === 'soonest-reset' && snapshot.resetsAt !== undefined) {
    return `${label} reports ${remaining} remaining, resetting ${new Date(snapshot.resetsAt).toISOString()} - the soonest reset among the CLIs with usage left, so it is spent before it is lost.`;
  }
  return `${label} reports ${remaining} remaining and no reset time - the most among the remaining CLIs.`;
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
