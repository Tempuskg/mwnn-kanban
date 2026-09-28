/**
 * Run-settings recommendations made while a card is being defined.
 *
 * Defining a card is the cheapest moment to decide how it should be run: the
 * scope is being written down anyway, so the definer can size the model and
 * the thinking level (reasoning effort) to it - a doc tweak does not need the
 * strongest model at maximum effort, and cross-boundary work should not run on
 * the cheapest one. The result is written as per-provider card keys
 * (`preferredModel.<provider>`, `thinkingLevel.<provider>`), the top layer of
 * the resolution order owned by `agentCliModels`.
 *
 * Two recommenders, one contract:
 *
 * - **Jev** (TypeSafe's System One model), when an API key is available. The
 *   judgment is a typed Choice over the workspace's own candidate names, so it
 *   can only ever pick a value the settings already list; the extension writes
 *   the picks itself and records the difficulty tier in Activity.
 * - **The defining agent**, otherwise. The definition prompt lists the same
 *   candidates and asks the agent to pick from them.
 *
 * Jev is strictly an enhancement: every failure - no key, disabled, network
 * error, timeout, unexpected response - resolves to a fallback outcome with a
 * reason, never a thrown error, so a definition can never fail because of it.
 *
 * No `vscode` import: settings arrive already validated and the HTTP call is
 * injected, so the whole policy is unit-testable.
 */

import { AGENT_CLI_PROVIDER_IDS, type AgentCliProviderId } from './agentCliProviders';
import type { AgentCliModelSuggestions, Card, CardPreferredModels, CardThinkingLevels } from './types';
import { cardPreferredModelFor, cardThinkingLevelFor, normalizePreferredModel, normalizeThinkingLevel } from './utils';

/** Known-valid names per provider, as the workspace settings list them. */
export interface RunSettingCandidates {
  readonly models: AgentCliModelSuggestions;
  readonly thinkingLevels: AgentCliModelSuggestions;
}

/** How demanding a card is; the Jev judgment the run settings are sized to. */
export type DifficultyTier = 'light' | 'standard' | 'heavy';

export const DIFFICULTY_TIERS: readonly DifficultyTier[] = ['light', 'standard', 'heavy'];

export interface JevRunRecommendation {
  readonly tier: DifficultyTier;
  readonly models: CardPreferredModels;
  readonly thinkingLevels: CardThinkingLevels;
}

export type RunSettingsRecommendation =
  | { readonly kind: 'jev'; readonly recommendation: JevRunRecommendation }
  | { readonly kind: 'fallback'; readonly reason: string };

/** What the definition prompt needs to know about run settings. */
export interface DefinitionRunSettings {
  readonly candidates: RunSettingCandidates;
  /** Whether a card's existing non-empty keys may be replaced. Off by default. */
  readonly overwriteExisting: boolean;
  readonly recommendation: RunSettingsRecommendation;
}

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-latest';
export const JEV_TIMEOUT_MS = 8_000;
/** The environment variable the TypeSafe API key is read from. */
export const JEV_API_KEY_ENV = 'TYPESAFE_API_KEY';

/** The subset of `fetch` the recommender uses, so tests can inject a fake. */
export type JevFetch = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
  },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export interface JevOptions {
  /** Absent or blank means Jev is not configured. */
  readonly apiKey?: string;
  readonly enabled: boolean;
  readonly overwriteExisting: boolean;
  readonly fetch?: JevFetch;
  readonly timeoutMs?: number;
}

/**
 * Providers whose model / level the recommender may set on this card: at least
 * two known candidates (with one there is nothing to choose, and the workspace
 * default already resolves to it) and no explicit value on the card unless
 * overwriting is opted in.
 */
export function recommendableProviders(
  card: Pick<Card, 'preferredModels' | 'thinkingLevels'>,
  candidates: RunSettingCandidates,
  overwriteExisting: boolean,
): { readonly models: AgentCliProviderId[]; readonly thinkingLevels: AgentCliProviderId[] } {
  const models: AgentCliProviderId[] = [];
  const thinkingLevels: AgentCliProviderId[] = [];
  for (const provider of AGENT_CLI_PROVIDER_IDS) {
    if ((candidates.models[provider]?.length ?? 0) >= 2
      && (overwriteExisting || cardPreferredModelFor(card, provider) === undefined)) {
      models.push(provider);
    }
    if ((candidates.thinkingLevels[provider]?.length ?? 0) >= 2
      && (overwriteExisting || cardThinkingLevelFor(card, provider) === undefined)) {
      thinkingLevels.push(provider);
    }
  }
  return { models, thinkingLevels };
}

const TIER_CRITERIA: Readonly<Record<DifficultyTier, string>> = {
  light: 'Small, low-risk, well-understood work: documentation, copy, configuration, or a local one-file change with an obvious approach.',
  standard: 'Ordinary feature or bug-fix work touching a few files in one area, with tests, and a mostly clear approach.',
  heavy: 'Architectural, cross-boundary, or ambiguous work: many files or layers, a protocol or data-model change, subtle correctness, or open design questions.',
};

function cardState(card: Pick<Card, 'title' | 'description' | 'acceptanceCriteria'>): Record<string, string> {
  return {
    title: card.title,
    description: card.description?.trim() || 'No description yet.',
    acceptance_criteria: card.acceptanceCriteria?.trim() || 'None yet.',
  };
}

/**
 * The Jev request: one difficulty tier plus, per recommendable provider, a
 * Choice over that provider's own candidate names. All questions share one
 * state and run in parallel, so each carries the sizing policy itself rather
 * than depending on the tier answer.
 */
export function buildJevRunSettingsRequest(
  card: Pick<Card, 'title' | 'description' | 'acceptanceCriteria' | 'preferredModels' | 'thinkingLevels'>,
  candidates: RunSettingCandidates,
  overwriteExisting: boolean,
): { state: Record<string, unknown>; model: string; questions: Record<string, unknown> } {
  const providers = recommendableProviders(card, candidates, overwriteExisting);
  const questions: Record<string, unknown> = {
    tier: {
      type: 'choice',
      instructions: 'How demanding is the software task described by `card` for an AI coding agent to complete correctly?',
      criteria: { ...TIER_CRITERIA },
    },
  };
  for (const provider of providers.models) {
    questions[`model.${provider}`] = {
      type: 'choice',
      instructions: {
        question: 'Which AI model from `options` is the best cost-appropriate fit for completing `card`? Prefer smaller, cheaper, faster models for light work and the strongest model for heavy, architectural, or ambiguous work.',
        agent_cli: provider,
      },
      criteria: Object.fromEntries((candidates.models[provider] ?? []).map((name) => [name, null])),
    };
  }
  for (const provider of providers.thinkingLevels) {
    questions[`level.${provider}`] = {
      type: 'choice',
      instructions: {
        question: 'Which reasoning-effort level from `options` best fits completing `card`? Prefer low effort for light work and high effort for heavy, architectural, or ambiguous work.',
        agent_cli: provider,
      },
      criteria: Object.fromEntries((candidates.thinkingLevels[provider] ?? []).map((name) => [name, null])),
    };
  }
  return { state: { card: cardState(card) }, model: JEV_MODEL, questions };
}

function choiceOf(answers: Record<string, unknown>, id: string): string | undefined {
  const answer = answers[id];
  if (typeof answer !== 'object' || answer === null) {
    return undefined;
  }
  const choice = (answer as Record<string, unknown>)['choice'];
  return typeof choice === 'string' ? choice : undefined;
}

/**
 * Read a Jev response, keeping only picks that are one of the candidates asked
 * about. Returns undefined when the response has no usable tier.
 */
export function parseJevRunSettingsResponse(
  body: unknown,
  card: Pick<Card, 'preferredModels' | 'thinkingLevels'>,
  candidates: RunSettingCandidates,
  overwriteExisting: boolean,
): JevRunRecommendation | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const answers = (body as Record<string, unknown>)['answers'];
  if (typeof answers !== 'object' || answers === null) {
    return undefined;
  }
  const answerMap = answers as Record<string, unknown>;
  const tier = choiceOf(answerMap, 'tier');
  if (!DIFFICULTY_TIERS.includes(tier as DifficultyTier)) {
    return undefined;
  }

  const providers = recommendableProviders(card, candidates, overwriteExisting);
  const models: CardPreferredModels = {};
  for (const provider of providers.models) {
    const pick = normalizePreferredModel(choiceOf(answerMap, `model.${provider}`));
    if (pick !== undefined && candidates.models[provider]?.includes(pick)) {
      models[provider] = pick;
    }
  }
  const thinkingLevels: CardThinkingLevels = {};
  for (const provider of providers.thinkingLevels) {
    const pick = normalizeThinkingLevel(choiceOf(answerMap, `level.${provider}`));
    if (pick !== undefined && candidates.thinkingLevels[provider]?.includes(pick)) {
      thinkingLevels[provider] = pick;
    }
  }
  return { tier: tier as DifficultyTier, models, thinkingLevels };
}

function defaultFetch(): JevFetch | undefined {
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  return typeof candidate === 'function' ? (candidate as JevFetch) : undefined;
}

/**
 * Ask Jev for run settings. Never throws and never rejects: anything short of
 * a usable typed answer is a fallback with the reason to record on the card.
 */
export async function requestJevRunSettings(
  card: Pick<Card, 'title' | 'description' | 'acceptanceCriteria' | 'preferredModels' | 'thinkingLevels'>,
  candidates: RunSettingCandidates,
  options: JevOptions,
): Promise<RunSettingsRecommendation> {
  if (!options.enabled) {
    return { kind: 'fallback', reason: 'Jev recommendations are turned off in settings' };
  }
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    return { kind: 'fallback', reason: `Jev is not configured (${JEV_API_KEY_ENV} is not set)` };
  }
  const fetchImpl = options.fetch ?? defaultFetch();
  if (!fetchImpl) {
    return { kind: 'fallback', reason: 'Jev is unreachable (no HTTP client available)' };
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? JEV_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(JEV_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(buildJevRunSettingsRequest(card, candidates, options.overwriteExisting)),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { kind: 'fallback', reason: `Jev request failed (HTTP ${response.status})` };
    }
    const recommendation = parseJevRunSettingsResponse(
      await response.json(),
      card,
      candidates,
      options.overwriteExisting,
    );
    return recommendation
      ? { kind: 'jev', recommendation }
      : { kind: 'fallback', reason: 'Jev returned an unusable answer' };
  } catch (error) {
    return {
      kind: 'fallback',
      reason: controller.signal.aborted
        ? `Jev timed out after ${timeoutMs} ms`
        : `Jev request failed (${error instanceof Error ? error.message : String(error)})`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function describePicks(recommendation: JevRunRecommendation): string[] {
  const lines: string[] = [];
  for (const provider of AGENT_CLI_PROVIDER_IDS) {
    const model = recommendation.models[provider];
    const level = recommendation.thinkingLevels[provider];
    if (model === undefined && level === undefined) {
      continue;
    }
    const parts = [
      ...(model === undefined ? [] : [`model \`${model}\``]),
      ...(level === undefined ? [] : [`thinking level \`${level}\``]),
    ];
    lines.push(`- ${provider}: ${parts.join(', ')}`);
  }
  return lines;
}

/** The Activity entry the extension writes before handing the definition off. */
export function formatRunSettingsActivityEntry(
  recommendation: RunSettingsRecommendation,
  timestamp: Date = new Date(),
): string {
  if (recommendation.kind === 'fallback') {
    return [
      `### ${timestamp.toISOString()} - Run settings: Jev fallback`,
      `${recommendation.reason}; the defining agent chooses the model and thinking level from the configured candidates instead.`,
    ].join('\n');
  }
  const picks = describePicks(recommendation.recommendation);
  return [
    `### ${timestamp.toISOString()} - Run settings recommended by Jev`,
    `Jev (TypeSafe) judged this card's difficulty tier: **${recommendation.recommendation.tier}**.`,
    ...(picks.length > 0 ? ['', ...picks] : ['No provider had a choice to make, so no run settings were changed.']),
  ].join('\n');
}
