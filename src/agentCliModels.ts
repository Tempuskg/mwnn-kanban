/**
 * Which model an agent CLI dispatch runs on, and how hard that model thinks.
 *
 * Two independent axes of one selection. The model policy is below; the
 * thinking-level policy is the last section of this file and mirrors it layer
 * for layer, so the two can never drift into different precedence rules.
 *
 * This module owns the whole policy, in one place, so the per-card run, the AI
 * loop's four stages, and the credit fallback cannot disagree:
 *
 * 0. a model the AI loop's escalation ladder picked for *this retry* - the only
 *    layer above the card, because it exists precisely to replace the model an
 *    attempt already failed on, and the loop applies it only after the user
 *    opted into escalation;
 * 1. the model the card names for *this* provider (`preferredModel.<provider>`
 *    in the card file), resolved per dispatch against the CLI actually running;
 * 2. otherwise the rule configured for the stage being dispatched
 *    (`mwnn-kanban.agentCliStageModels`), so a cheap stage need not pay for an
 *    expensive model;
 * 3. otherwise the *first* entry of the active provider's configured model
 *    list (`mwnn-kanban.agentCliModels`), the workspace default;
 * 4. otherwise nothing — no model argument is added and the CLI runs whatever
 *    model it defaults to, byte-identically to how it ran before these settings
 *    existed.
 *
 * The card beats the stage rule because a card-level choice is the more
 * specific intent: the user picked a model for *this* work, not for a class of
 * work. The stage rule beats the workspace default because it is the more
 * specific of the two workspace-wide opinions.
 *
 * The workspace-default setting is a per-provider map rather than one string
 * because model names
 * are provider-specific: a single shared default would be wrong for every CLI
 * but one, and the credit fallback can change the active provider mid-run, so a
 * replacement CLI must resolve its own default rather than inherit the
 * exhausted CLI's. Each value is a *list* so one curated setting serves two
 * purposes without a second source of truth that could disagree with it: the
 * first entry is that provider's default, and the whole list is the suggestion
 * set behind the card UI's model picker. The CLIs cannot be asked what they
 * accept — `copilot`, `codex`, `claude`, and `cursor-agent` all take
 * `--model <name>` and none enumerates models non-interactively — so this
 * curated list is the only place a model list can come from.
 *
 * No `vscode` import: the raw setting arrives here as `unknown` and is
 * validated here, so the policy is unit-testable and `src/extension.ts` only
 * has to read the configuration key.
 */

import { AGENT_CLI_PROVIDER_IDS, type AgentCliProviderId } from './agentCliProviders';
import type { AgentCliModelSuggestions } from './types';
import { AGENT_CLI_HANDOFF_KINDS, type AgentCliHandoffKind } from './agentCliStages';
import { normalizePreferredModel, normalizeThinkingLevel } from './utils';

/** The user-facing id of the setting this module validates. */
export const AGENT_CLI_MODELS_SETTING = 'mwnn-kanban.agentCliModels';

/**
 * Validated model names per provider. A provider is absent rather than present
 * with an empty list, so `catalog[provider]` being undefined always means "no
 * workspace opinion for this CLI".
 */
export type AgentCliModelCatalog = { readonly [K in AgentCliProviderId]?: readonly string[] };

/** The "nothing configured" catalog, and the default for every resolution. */
export const EMPTY_AGENT_CLI_MODEL_CATALOG: AgentCliModelCatalog = Object.freeze({});

/**
 * Read `mwnn-kanban.agentCliModels` from an unvalidated configuration value.
 * Nothing here throws: a malformed setting degrades to "no default configured"
 * for the affected provider instead of breaking a dispatch. Non-object values,
 * unknown provider keys, non-array values, non-string entries, blank entries,
 * duplicates, and empty lists are all dropped.
 */
export function readAgentCliModelCatalog(value: unknown): AgentCliModelCatalog {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return EMPTY_AGENT_CLI_MODEL_CATALOG;
  }

  const configured = value as Record<string, unknown>;
  // Only known providers are read, which is what makes an unknown key a no-op
  // rather than an error: a stale or misspelled key simply never matches.
  const catalog: { -readonly [K in AgentCliProviderId]?: readonly string[] } = {};
  for (const provider of AGENT_CLI_PROVIDER_IDS) {
    const models = readModelList(configured[provider]);
    if (models.length > 0) {
      catalog[provider] = Object.freeze(models);
    }
  }
  return Object.freeze(catalog);
}

/**
 * One provider's list: strings only, trimmed, blanks dropped, duplicates
 * dropped keeping the first occurrence so the configured default is stable.
 */
function readModelList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const models: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    // Same normalization a card's own model gets, so a name that is unusable
    // as a single spawn argument cannot enter through the settings either.
    const model = normalizePreferredModel(entry);
    if (model === undefined || models.includes(model)) {
      continue;
    }
    models.push(model);
  }
  return models;
}

/**
 * Every model name configured for one provider, in configured order. Exported
 * for the card UI's model picker, which consumes the already-validated list
 * rather than re-reading or re-validating configuration.
 */
export function agentCliModelsFor(
  catalog: AgentCliModelCatalog,
  provider: AgentCliProviderId,
): readonly string[] {
  return catalog[provider] ?? [];
}

/**
 * The provider's workspace default: the first configured entry, or undefined
 * when the provider has none. Later entries are known models only.
 */
export function defaultAgentCliModel(
  catalog: AgentCliModelCatalog,
  provider: AgentCliProviderId,
): string | undefined {
  return agentCliModelsFor(catalog, provider)[0];
}

/**
 * The catalog as the card UI's model picker consumes it: the same per-provider
 * lists, narrowed to the message-protocol type so the suggestion list crosses
 * the extension-host ⇄ webview boundary as a declared shape rather than an
 * incidental one.
 *
 * A separate function rather than posting the catalog directly because the two
 * are the same values for different reasons - the catalog's *first* entry is a
 * dispatch default, while the whole list is a presentation hint - and only this
 * seam should widen if a provider ever gains suggestions it has no default for.
 * Providers with nothing configured stay absent, so the webview sees "no
 * suggestions" rather than an empty list it would have to special-case.
 */
export function agentCliModelSuggestions(catalog: AgentCliModelCatalog): AgentCliModelSuggestions {
  const suggestions: { -readonly [K in AgentCliProviderId]?: readonly string[] } = {};
  for (const provider of AGENT_CLI_PROVIDER_IDS) {
    const models = agentCliModelsFor(catalog, provider);
    if (models.length > 0) {
      suggestions[provider] = models;
    }
  }
  return Object.freeze(suggestions);
}

/** The user-facing id of the per-stage rules setting this module validates. */
export const AGENT_CLI_STAGE_MODELS_SETTING = 'mwnn-kanban.agentCliStageModels';

/**
 * The user-facing id of the AI loop's model escalation ladder. The setting is
 * read and validated in `agentCliEscalation`; the id lives here beside the
 * other two model-setting ids so failure messages can name the right key to
 * edit without `agentCliHandoff` importing the escalation policy.
 */
export const AGENT_CLI_ESCALATION_LADDER_SETTING = 'mwnn-kanban.aiLoopModelEscalationLadder';

/** A stage can hold CLI-specific names or a legacy shared string. */
export type AgentCliStagePreference = string | { readonly [K in AgentCliProviderId]?: string };
export type AgentCliStageModels = { readonly [K in AgentCliHandoffKind]?: AgentCliStagePreference };
export const EMPTY_AGENT_CLI_STAGE_MODELS: AgentCliStageModels = Object.freeze({});

/** Validate only known stages/providers; malformed or blank entries are ignored. */
export function readAgentCliStageModels(value: unknown): AgentCliStageModels {
  return readStagePreferences(value, normalizePreferredModel);
}

function readStagePreferences(
  value: unknown,
  normalize: (value: string | undefined) => string | undefined,
): AgentCliStageModels {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return EMPTY_AGENT_CLI_STAGE_MODELS;
  }
  const configured = value as Record<string, unknown>;
  const rules: { -readonly [K in AgentCliHandoffKind]?: AgentCliStagePreference } = {};
  for (const stage of AGENT_CLI_HANDOFF_KINDS) {
    const entry = configured[stage];
    if (typeof entry === 'string') {
      const name = normalize(entry);
      if (name !== undefined) {
        rules[stage] = name;
      }
    } else if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      const providers: { -readonly [K in AgentCliProviderId]?: string } = {};
      for (const provider of AGENT_CLI_PROVIDER_IDS) {
        const name = normalize(typeof (entry as Record<string, unknown>)[provider] === 'string'
          ? (entry as Record<string, string>)[provider] : undefined);
        if (name !== undefined) {
          providers[provider] = name;
        }
      }
      if (Object.keys(providers).length > 0) {
        rules[stage] = Object.freeze(providers);
      }
    }
  }
  return Object.freeze(rules);
}

/** Merge scopes by stage and CLI, including lower-scope legacy shared strings.
 * Reading inheritance never materializes these effective values in settings.
 */
export function mergeAgentCliStagePreferences(...values: readonly unknown[]): AgentCliStageModels {
  const result: { -readonly [K in AgentCliHandoffKind]?: AgentCliStagePreference } = {};
  for (const value of values) {
    const rules = readAgentCliStageModels(value);
    for (const stage of AGENT_CLI_HANDOFF_KINDS) {
      const entry = rules[stage];
      if (entry === undefined) {
        continue;
      }
      if (typeof entry === 'string') {
        result[stage] = entry;
      } else {
        const previous = result[stage];
        const lower = typeof previous === 'string'
          ? Object.fromEntries(AGENT_CLI_PROVIDER_IDS.map((provider) => [provider, previous]))
          : previous;
        result[stage] = Object.freeze({ ...lower, ...entry });
      }
    }
  }
  return Object.freeze(result);
}

/** Legacy strings apply to every CLI; provider maps apply only to that CLI. */
export function stageAgentCliModel(
  rules: AgentCliStageModels,
  stage: AgentCliHandoffKind,
  provider?: AgentCliProviderId,
): string | undefined {
  const entry = rules[stage];
  return typeof entry === 'string' ? entry : provider === undefined ? undefined : entry?.[provider];
}

/**
 * Which stage a dispatch belongs to, together with the configured rules. Passed
 * as one value so a caller cannot supply half of it: a stage with no rules and
 * rules with no stage both mean "no stage layer", and neither is a useful
 * argument on its own.
 */
export interface AgentCliStageContext {
  readonly stage: AgentCliHandoffKind;
  readonly stageModels: AgentCliStageModels;
}

/** Where a resolved model came from; drives how the run is reported. */
export type AgentCliModelSource =
  | 'card'
  | 'stage-rule'
  | 'workspace-default'
  | 'escalation';

/**
 * How a selection is named mid-sentence in notifications and failure messages.
 * Shared so every surface names the three sources the same way.
 */
export function describeAgentCliModelSource(source: AgentCliModelSource): string {
  switch (source) {
    case 'card':
      return "the card's preferred model";
    case 'stage-rule':
      return 'the AI loop stage model rule';
    case 'escalation':
      return 'the AI loop model escalation ladder';
    default:
      return 'the workspace default model';
  }
}

/** Sentence-leading form of {@link describeAgentCliModelSource}. */
export function agentCliModelSourceLabel(source: AgentCliModelSource): string {
  switch (source) {
    case 'card':
      return 'Card preferred model';
    case 'stage-rule':
      return 'AI loop stage model rule';
    case 'escalation':
      return 'AI loop escalation model';
    default:
      return 'Workspace default model';
  }
}

export interface ResolvedAgentCliModel {
  /** The name exactly as it will reach the CLI. */
  readonly model: string;
  readonly source: AgentCliModelSource;
}

/**
 * Resolve the model for one dispatch of one card on one provider, at one stage.
 * This is the single resolution site: every dispatch path - the per-card run,
 * each of the loop's four stages, and the credit fallback's replacement CLI -
 * reaches the layered order through here and nowhere else.
 *
 * Returns undefined when no layer names a model, which is what keeps an
 * unconfigured workspace producing exactly the arguments it produced before
 * these settings existed. `stage` is optional so a caller with no stage in hand
 * simply skips that layer.
 *
 * Resolving never writes anything back to the card or the settings: both
 * workspace layers stay defaults, so changing either changes every dispatch
 * that has not opted out.
 */
export function resolveAgentCliModel(
  provider: AgentCliProviderId,
  cardModel: string | undefined,
  catalog: AgentCliModelCatalog = EMPTY_AGENT_CLI_MODEL_CATALOG,
  stage?: AgentCliStageContext,
  escalatedModel?: string,
): ResolvedAgentCliModel | undefined {
  // Above the card: an escalation model is a per-retry decision the loop only
  // makes after an attempt on a lower layer already failed, so re-resolving the
  // same layers would simply repeat that failure. It is never persisted - the
  // card and the settings are untouched, so the next dispatch starts over at
  // the card layer.
  const fromEscalation = normalizePreferredModel(escalatedModel);
  if (fromEscalation !== undefined) {
    return { model: fromEscalation, source: 'escalation' };
  }
  const fromCard = normalizePreferredModel(cardModel);
  if (fromCard !== undefined) {
    return { model: fromCard, source: 'card' };
  }
  const fromStage = stage ? stageAgentCliModel(stage.stageModels, stage.stage, provider) : undefined;
  if (fromStage !== undefined) {
    return { model: fromStage, source: 'stage-rule' };
  }
  const fromWorkspace = defaultAgentCliModel(catalog, provider);
  if (fromWorkspace !== undefined) {
    return { model: fromWorkspace, source: 'workspace-default' };
  }
  return undefined;
}

/* ------------------------------------------------------------------------ *
 * Thinking level
 *
 * The second axis of the same selection. "Which model" and "how hard should it
 * think" are independent questions, and a user should not have to answer the
 * second by inventing a model name that encodes it. The level therefore
 * resolves through *this* module, layer for layer with the model, rather than
 * through a policy of its own that could drift out of step:
 *
 * 0. a level the AI loop's escalation ladder picked for this retry;
 * 1. the level the card names for *this* provider (`thinkingLevel.<provider>`);
 * 2. otherwise the rule configured for the stage being dispatched
 *    (`mwnn-kanban.agentCliStageThinkingLevels`);
 * 3. otherwise the per-provider workspace default
 *    (`mwnn-kanban.agentCliThinkingLevels`);
 * 4. otherwise nothing - no argument is added and the CLI runs at whatever
 *    effort it defaults to, byte-identically to before this axis existed.
 *
 * The workspace default is one string per provider, or a list whose *first*
 * entry is that default - the same shape rule as the model catalog. The rest of
 * a list is presentation only: the card UI offers it as the provider's known
 * levels, which is what lets the populate command write the whole vocabulary a
 * CLI reports without the extra entries ever changing a dispatch.
 * ------------------------------------------------------------------------ */

/** The user-facing id of the per-provider workspace default this module reads. */
export const AGENT_CLI_THINKING_LEVELS_SETTING = 'mwnn-kanban.agentCliThinkingLevels';

/** The user-facing id of the per-stage thinking-level rules. */
export const AGENT_CLI_STAGE_THINKING_LEVELS_SETTING = 'mwnn-kanban.agentCliStageThinkingLevels';

/**
 * One validated thinking level per provider. A provider is absent rather than
 * present with a blank value, so `defaults[provider]` being undefined always
 * means "no workspace opinion about effort for this CLI".
 */
export type AgentCliThinkingLevelDefaults = { readonly [K in AgentCliProviderId]?: string };

/** The "nothing configured" defaults, and the default for every resolution. */
export const EMPTY_AGENT_CLI_THINKING_LEVELS: AgentCliThinkingLevelDefaults = Object.freeze({});

/**
 * Read `mwnn-kanban.agentCliThinkingLevels` from an unvalidated configuration
 * value. Nothing here throws: a malformed setting degrades to "no default
 * configured" for the affected provider instead of breaking a dispatch.
 * Non-object values, unknown provider keys, values that are neither a string
 * nor a list, and blank or otherwise unusable levels are all dropped. For a
 * list, the first usable entry is the default.
 */
export function readAgentCliThinkingLevels(value: unknown): AgentCliThinkingLevelDefaults {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return EMPTY_AGENT_CLI_THINKING_LEVELS;
  }

  const configured = value as Record<string, unknown>;
  // Only known providers are read, which is what makes an unknown key a no-op
  // rather than an error: a stale or misspelled key simply never matches.
  const defaults: { -readonly [K in AgentCliProviderId]?: string } = {};
  for (const provider of AGENT_CLI_PROVIDER_IDS) {
    const level = readThinkingLevelList(configured[provider])[0];
    if (level !== undefined) {
      defaults[provider] = level;
    }
  }
  return Object.freeze(defaults);
}

/**
 * Every thinking level configured per provider, in configured order, as the
 * card UI's thinking field suggests them. A bare string is a one-entry list.
 * Providers with nothing usable stay absent, exactly as in
 * {@link agentCliModelSuggestions}.
 */
export function readAgentCliThinkingLevelSuggestions(value: unknown): AgentCliModelSuggestions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return Object.freeze({});
  }
  const configured = value as Record<string, unknown>;
  const suggestions: { -readonly [K in AgentCliProviderId]?: readonly string[] } = {};
  for (const provider of AGENT_CLI_PROVIDER_IDS) {
    const levels = readThinkingLevelList(configured[provider]);
    if (levels.length > 0) {
      suggestions[provider] = Object.freeze(levels);
    }
  }
  return Object.freeze(suggestions);
}

/**
 * One provider's levels: a string or a list of strings, trimmed, blanks and
 * unusable values dropped, duplicates dropped keeping the first occurrence so
 * the configured default is stable.
 */
function readThinkingLevelList(value: unknown): string[] {
  const entries = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const levels: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') {
      continue;
    }
    const level = normalizeThinkingLevel(entry);
    if (level === undefined || levels.includes(level)) {
      continue;
    }
    levels.push(level);
  }
  return levels;
}

/** The provider's workspace default level, or undefined when it has none. */
export function defaultAgentCliThinkingLevel(
  defaults: AgentCliThinkingLevelDefaults,
  provider: AgentCliProviderId,
): string | undefined {
  return defaults[provider];
}

/** Independent thinking preferences, with the same stage/provider shape as models. */
export type AgentCliStageThinkingLevels = AgentCliStageModels;
export const EMPTY_AGENT_CLI_STAGE_THINKING_LEVELS: AgentCliStageThinkingLevels = Object.freeze({});

export function readAgentCliStageThinkingLevels(value: unknown): AgentCliStageThinkingLevels {
  return readStagePreferences(value, normalizeThinkingLevel);
}

export function stageAgentCliThinkingLevel(
  rules: AgentCliStageThinkingLevels,
  stage: AgentCliHandoffKind,
  provider?: AgentCliProviderId,
): string | undefined {
  return stageAgentCliModel(rules, stage, provider);
}

/**
 * Which stage a dispatch belongs to, together with the configured level rules.
 * Passed as one value for the same reason {@link AgentCliStageContext} is: half
 * of it is never a useful argument.
 */
export interface AgentCliThinkingStageContext {
  readonly stage: AgentCliHandoffKind;
  readonly stageThinkingLevels: AgentCliStageThinkingLevels;
}

/**
 * Where a resolved thinking level came from. The same four layers as the
 * model's, and deliberately the same union, so any surface that already
 * switches on a selection source handles both axes with one vocabulary.
 */
export type AgentCliThinkingLevelSource = AgentCliModelSource;

/** How a resolved level is named mid-sentence in notifications and failures. */
export function describeAgentCliThinkingLevelSource(source: AgentCliThinkingLevelSource): string {
  switch (source) {
    case 'card':
      return 'the card thinking level';
    case 'stage-rule':
      return 'the AI loop stage thinking level rule';
    case 'escalation':
      return 'the AI loop escalation thinking level';
    default:
      return 'the workspace default thinking level';
  }
}

/** Sentence-leading form of {@link describeAgentCliThinkingLevelSource}. */
export function agentCliThinkingLevelSourceLabel(source: AgentCliThinkingLevelSource): string {
  switch (source) {
    case 'card':
      return 'Card thinking level';
    case 'stage-rule':
      return 'AI loop stage thinking level rule';
    case 'escalation':
      return 'AI loop escalation thinking level';
    default:
      return 'Workspace default thinking level';
  }
}

export interface ResolvedAgentCliThinkingLevel {
  /** The level exactly as it will reach the CLI. */
  readonly level: string;
  readonly source: AgentCliThinkingLevelSource;
}

/**
 * Resolve the thinking level for one dispatch of one card on one provider, at
 * one stage. The single resolution site for the effort axis, exactly as
 * {@link resolveAgentCliModel} is for the model axis.
 *
 * Returns undefined when no layer names a level, which is what keeps an
 * unconfigured workspace producing exactly the arguments it produced before
 * this axis existed. Resolving never writes anything back to the card or the
 * settings.
 */
export function resolveAgentCliThinkingLevel(
  provider: AgentCliProviderId,
  cardThinkingLevel: string | undefined,
  defaults: AgentCliThinkingLevelDefaults = EMPTY_AGENT_CLI_THINKING_LEVELS,
  stage?: AgentCliThinkingStageContext,
  escalatedThinkingLevel?: string,
): ResolvedAgentCliThinkingLevel | undefined {
  // Above the card, for the same reason an escalation model is: the loop only
  // picks one after an attempt on a lower layer already failed.
  const fromEscalation = normalizeThinkingLevel(escalatedThinkingLevel);
  if (fromEscalation !== undefined) {
    return { level: fromEscalation, source: 'escalation' };
  }
  const fromCard = normalizeThinkingLevel(cardThinkingLevel);
  if (fromCard !== undefined) {
    return { level: fromCard, source: 'card' };
  }
  const fromStage = stage
    ? stageAgentCliThinkingLevel(stage.stageThinkingLevels, stage.stage, provider)
    : undefined;
  if (fromStage !== undefined) {
    return { level: fromStage, source: 'stage-rule' };
  }
  const fromWorkspace = defaultAgentCliThinkingLevel(defaults, provider);
  if (fromWorkspace !== undefined) {
    return { level: fromWorkspace, source: 'workspace-default' };
  }
  return undefined;
}
