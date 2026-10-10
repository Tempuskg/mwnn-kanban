/**
 * Model names an agent CLI has refused for this user's account.
 *
 * A CLI's own model list is not proof a model can be used: `copilot help
 * config`, for example, documents every model Copilot knows, while the
 * account's plan decides which of them it will actually run, and no command
 * lists only those. The one reliable signal is a refusal at dispatch time, so
 * each refusal is remembered here and the model is left out of the candidates
 * Jev and the defining agent choose a card's run settings from.
 *
 * A record is forgotten when the same model later completes a run on that CLI
 * (the plan changed) or after `REJECTED_MODEL_TTL_MS`, so a refusal never
 * hides a model for good. Nothing here stops a person from typing the model
 * on a card; it only stops the extension from recommending it.
 *
 * No `vscode` import: `extension.ts` persists the records in global state.
 */

import type { AgentCliModelSuggestions } from './types';
import { isAgentCliProviderId, type AgentCliProviderId } from './agentCliProviders';

/** How long a refusal is remembered without being seen again. */
export const REJECTED_MODEL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface RejectedAgentCliModel {
  readonly provider: AgentCliProviderId;
  readonly model: string;
  /** Epoch milliseconds of the most recent refusal. */
  readonly at: number;
}

/**
 * Validate stored records, dropping malformed and expired ones, and keep one
 * record per provider and model (the latest).
 */
export function readRejectedAgentCliModels(raw: unknown, now: number): RejectedAgentCliModel[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const latest = new Map<string, RejectedAgentCliModel>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { provider, model, at } = entry as Record<string, unknown>;
    if (
      !isAgentCliProviderId(provider)
      || typeof model !== 'string'
      || model.trim().length === 0
      || typeof at !== 'number'
      || !Number.isFinite(at)
      || now - at > REJECTED_MODEL_TTL_MS
    ) {
      continue;
    }
    const key = `${provider}\u0000${model.trim()}`;
    const existing = latest.get(key);
    if (!existing || existing.at < at) {
      latest.set(key, { provider, model: model.trim(), at });
    }
  }
  return [...latest.values()];
}

/** Records after `provider` refused `model` at `now`. */
export function recordRejectedAgentCliModel(
  records: readonly RejectedAgentCliModel[],
  provider: AgentCliProviderId,
  model: string,
  now: number,
): RejectedAgentCliModel[] {
  return [
    ...records.filter((record) => !(record.provider === provider && record.model === model.trim())),
    { provider, model: model.trim(), at: now },
  ];
}

/** Records after `provider` ran `model` to completion: the refusal is stale. */
export function forgetRejectedAgentCliModel(
  records: readonly RejectedAgentCliModel[],
  provider: AgentCliProviderId,
  model: string,
): RejectedAgentCliModel[] {
  return records.filter((record) => !(record.provider === provider && record.model === model.trim()));
}

/**
 * Leave refused models out of each provider's candidate list, keeping order.
 * A provider whose list becomes empty is dropped, exactly like a provider with
 * no configured models.
 */
export function withoutRejectedAgentCliModels(
  suggestions: AgentCliModelSuggestions,
  records: readonly RejectedAgentCliModel[],
): AgentCliModelSuggestions {
  if (records.length === 0) {
    return suggestions;
  }
  const filtered: { -readonly [K in AgentCliProviderId]?: readonly string[] } = {};
  for (const [provider, models] of Object.entries(suggestions) as [AgentCliProviderId, readonly string[] | undefined][]) {
    const kept = (models ?? []).filter((model) =>
      !records.some((record) => record.provider === provider && record.model === model));
    if (kept.length > 0) {
      filtered[provider] = kept;
    }
  }
  return Object.freeze(filtered);
}
