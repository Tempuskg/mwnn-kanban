/**
 * List-editing rules for the "Manage Agent CLI Models and Thinking Levels"
 * command: how one provider's entry in `mwnn-kanban.agentCliModels` or
 * `mwnn-kanban.agentCliThinkingLevels` changes when the user adds, removes, or
 * promotes a name, and the text the command's overview shows for it.
 *
 * Every edit takes the raw value of ONE settings scope (as `inspect()` returns
 * it) and returns the value to write back to that same scope. Other providers'
 * keys are copied through untouched, so an edit never rewrites or "cleans" an
 * entry the user did not touch. The command in `extension.ts` only asks the
 * user and writes; nothing here imports `vscode`.
 *
 * Names stay free-form pass-through strings: they are trimmed and checked for
 * blanks and duplicates, never validated against a list of known names.
 */
import { AGENT_CLI_THINKING_FLAGS, type AgentCliProviderId } from './agentCliHandoff';
import { normalizePreferredModel } from './utils';
import { isAgentCliHandoffKind, type AgentCliHandoffKind } from './agentCliStages';
import { AGENT_CLI_PROVIDER_IDS, isAgentCliProviderId } from './agentCliProviders';

/** Which of the two settings an edit targets; they differ only in shape. */
export type AgentCliSettingsList = 'models' | 'thinkingLevels';

/**
 * The value to write back to a scope: a provider map, or `undefined` when the
 * map ended up empty so `config.update` removes the setting from that scope
 * instead of leaving an empty `{}` behind.
 */
export type AgentCliSettingsValue = Record<string, unknown> | undefined;

export type AgentCliSettingsEdit =
  | { readonly ok: true; readonly value: AgentCliSettingsValue; readonly list: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * One provider's entries in a scope's raw value, in stored order: trimmed,
 * blanks and unusable values dropped, duplicates dropped keeping the first.
 * A bare string (the single-level thinking shape) is a one-entry list.
 */
export function agentCliSettingsEntries(value: unknown, provider: AgentCliProviderId): string[] {
  const map = asMap(value);
  const raw = map[provider];
  const entries = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
  const result: string[] = [];
  for (const entry of entries) {
    const name = typeof entry === 'string' ? normalizePreferredModel(entry) : undefined;
    if (name !== undefined && !result.includes(name)) {
      result.push(name);
    }
  }
  return result;
}

/**
 * Why `input` cannot be added to `existing`, or undefined when it can. Used
 * both by the edits below and as an input box's live validation, so the box
 * and the write agree on what is accepted.
 */
export function agentCliSettingsEntryProblem(
  existing: readonly string[],
  input: string,
  noun: string,
): string | undefined {
  const name = normalizePreferredModel(input);
  if (name === undefined) {
    return `Enter a ${noun}; a blank name is not accepted.`;
  }
  if (existing.includes(name)) {
    return `"${name}" is already in the list.`;
  }
  return undefined;
}

/** Append a name. It becomes the default only when the list was empty. */
export function addAgentCliSettingsEntry(
  value: unknown,
  list: AgentCliSettingsList,
  provider: AgentCliProviderId,
  input: string,
): AgentCliSettingsEdit {
  const entries = agentCliSettingsEntries(value, provider);
  const problem = agentCliSettingsEntryProblem(entries, input, nounFor(list));
  if (problem !== undefined) {
    return { ok: false, reason: problem };
  }
  return write(value, list, provider, [...entries, input.trim()]);
}

/**
 * Drop a name. Removing a provider's last entry deletes that provider's key
 * rather than writing an empty list.
 */
export function removeAgentCliSettingsEntry(
  value: unknown,
  list: AgentCliSettingsList,
  provider: AgentCliProviderId,
  name: string,
): AgentCliSettingsEdit {
  const entries = agentCliSettingsEntries(value, provider);
  if (!entries.includes(name)) {
    return { ok: false, reason: `"${name}" is not in the list.` };
  }
  return write(value, list, provider, entries.filter((entry) => entry !== name));
}

/**
 * Make a name the one used: move it to first place, or insert it first when it
 * is not listed yet. For models that is the CLI's default model; for thinking
 * levels it is the level runs use, with the rest kept as suggestions.
 */
export function makeAgentCliSettingsDefault(
  value: unknown,
  list: AgentCliSettingsList,
  provider: AgentCliProviderId,
  input: string,
): AgentCliSettingsEdit {
  const name = normalizePreferredModel(input);
  if (name === undefined) {
    return { ok: false, reason: `Enter a ${nounFor(list)}; a blank name is not accepted.` };
  }
  const entries = agentCliSettingsEntries(value, provider);
  return write(value, list, provider, [name, ...entries.filter((entry) => entry !== name)]);
}

/** Remove the provider's key entirely, so it falls back to the CLI default. */
export function clearAgentCliSettingsProvider(
  value: unknown,
  list: AgentCliSettingsList,
  provider: AgentCliProviderId,
): AgentCliSettingsEdit {
  return write(value, list, provider, []);
}

/** Overview text for one provider, from the chosen scope's two raw values. */
export interface AgentCliProviderSummary {
  readonly models: readonly string[];
  readonly thinkingLevels: readonly string[];
  /** e.g. `model: sonnet (+2 other) · thinking: high`. */
  readonly description: string;
  /** The other models and suggested levels, or what an empty entry means. */
  readonly detail: string;
}

export function summarizeAgentCliProvider(
  modelsValue: unknown,
  thinkingValue: unknown,
  provider: AgentCliProviderId,
): AgentCliProviderSummary {
  const models = agentCliSettingsEntries(modelsValue, provider);
  const thinkingLevels = agentCliSettingsEntries(thinkingValue, provider);
  const others = models.length - 1;
  const modelText =
    models[0] === undefined
      ? 'model: CLI default'
      : `model: ${models[0]}${others > 0 ? ` (+${others} other)` : ''}`;
  const notApplied = AGENT_CLI_THINKING_FLAGS[provider] === undefined ? ' (not applied by this CLI)' : '';
  const thinkingText = `thinking: ${thinkingLevels[0] ?? 'CLI default'}${notApplied}`;
  const detailParts = [
    others > 0 ? `Other models: ${models.slice(1).join(', ')}` : undefined,
    thinkingLevels.length > 1 ? `Suggested levels: ${thinkingLevels.slice(1).join(', ')}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return {
    models,
    thinkingLevels,
    description: `${modelText} · ${thinkingText}`,
    detail: detailParts.length > 0 ? detailParts.join(' · ') : 'No other models or suggested levels',
  };
}

function nounFor(list: AgentCliSettingsList): string {
  return list === 'models' ? 'model name' : 'thinking level';
}

function asMap(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Edit one stage/CLI in one raw scope, preserving every unrelated entry. */
export function setAgentCliSettingsStage(
  value: unknown,
  list: AgentCliSettingsList,
  stage: AgentCliHandoffKind,
  provider: AgentCliProviderId,
  input: string,
): AgentCliSettingsEdit {
  const problem = stageEntryProblem(stage, provider);
  if (problem !== undefined) {
    return { ok: false, reason: problem };
  }
  const name = normalizePreferredModel(input);
  if (name === undefined) {
    return { ok: false, reason: 'Enter a ' + nounFor(list) + '; use a non-blank name without control characters.' };
  }
  const next = { ...asMap(value) };
  next[stage] = { ...stageProviderMap(next[stage]), [provider]: name };
  return { ok: true, value: next, list: [name] };
}

/** Clearing deletes only this CLI's key, then empty stage/setting containers. */
export function removeAgentCliSettingsStage(
  value: unknown,
  stage: AgentCliHandoffKind,
  provider: AgentCliProviderId,
): AgentCliSettingsEdit {
  const problem = stageEntryProblem(stage, provider);
  if (problem !== undefined) {
    return { ok: false, reason: problem };
  }
  const current = asMap(value);
  const next = Object.fromEntries(Object.entries(current).filter(([key]) => key !== stage));
  const entries = Object.fromEntries(Object.entries(stageProviderMap(current[stage])).filter(([key]) => key !== provider));
  if (Object.keys(entries).length > 0) {
    next[stage] = entries;
  }
  return { ok: true, value: Object.keys(next).length > 0 ? next : undefined, list: [] };
}

function stageEntryProblem(stage: AgentCliHandoffKind, provider: AgentCliProviderId): string | undefined {
  return !isAgentCliHandoffKind(stage) || !isAgentCliProviderId(provider)
    ? 'Unknown AI loop stage or CLI; nothing was written.' : undefined;
}

/** Expand only a legacy value stored in this scope, never an inherited value. */
function stageProviderMap(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    const name = normalizePreferredModel(value);
    return name === undefined ? {} : Object.fromEntries(AGENT_CLI_PROVIDER_IDS.map((provider) => [provider, name]));
  }
  return { ...asMap(value) };
}

/**
 * Write one provider's list back into a copy of the scope's map. Models are
 * always a list; a thinking level is a bare string when there is one and a
 * list (first entry used) when there are several. An empty list deletes the
 * key, and an emptied map becomes `undefined`.
 */
function write(
  value: unknown,
  list: AgentCliSettingsList,
  provider: AgentCliProviderId,
  entries: readonly string[],
): AgentCliSettingsEdit {
  const next: Record<string, unknown> = Object.fromEntries(
    Object.entries(asMap(value)).filter(([key]) => key !== provider),
  );
  // With no entries the provider stays left out: no empty list is written.
  if (list === 'thinkingLevels' && entries.length === 1) {
    next[provider] = entries[0];
  } else if (entries.length > 0) {
    next[provider] = [...entries];
  }
  return {
    ok: true,
    value: Object.keys(next).length > 0 ? next : undefined,
    list: Object.freeze([...entries]),
  };
}
