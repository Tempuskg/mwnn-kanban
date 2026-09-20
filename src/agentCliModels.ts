/**
 * Which model an agent CLI dispatch runs on.
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
import { normalizePreferredModel } from './utils';

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

/**
 * A model name per AI-loop stage. A stage is absent rather than present with a
 * blank value, so `rules[stage]` being undefined always means "no rule for this
 * stage" and resolution falls through to the workspace default.
 *
 * Keyed on stage rather than on stage *and* provider: a stage rule is a
 * deliberate override of the workspace default, and the workspace default is
 * where per-provider spelling already lives. A rule the active CLI does not
 * accept is refused by that CLI and reported through the same model-rejection
 * path as a bad card model, naming this setting and the stage.
 */
export type AgentCliStageModels = { readonly [K in AgentCliHandoffKind]?: string };

/** The "no stage rules configured" value, and the default for every resolution. */
export const EMPTY_AGENT_CLI_STAGE_MODELS: AgentCliStageModels = Object.freeze({});

/**
 * Read `mwnn-kanban.agentCliStageModels` from an unvalidated configuration
 * value. Nothing here throws: a malformed setting degrades to "no rule" for the
 * affected stage rather than breaking a dispatch. Non-object values, unknown
 * stage keys, non-string values, and blank or unusable names are all dropped,
 * so an empty or misspelled setting leaves behavior exactly as it was.
 */
export function readAgentCliStageModels(value: unknown): AgentCliStageModels {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return EMPTY_AGENT_CLI_STAGE_MODELS;
  }

  const configured = value as Record<string, unknown>;
  // Only known stages are read, which is what makes an unknown key a no-op
  // rather than an error: a stale or misspelled key simply never matches.
  const rules: { -readonly [K in AgentCliHandoffKind]?: string } = {};
  for (const stage of AGENT_CLI_HANDOFF_KINDS) {
    const configuredModel = configured[stage];
    if (typeof configuredModel !== 'string') {
      continue;
    }
    // Same normalization a card's own model gets, so a name that is unusable
    // as a single spawn argument cannot enter through the settings either.
    const model = normalizePreferredModel(configuredModel);
    if (model !== undefined) {
      rules[stage] = model;
    }
  }
  return Object.freeze(rules);
}

/** The model configured for one stage, or undefined when that stage has none. */
export function stageAgentCliModel(
  rules: AgentCliStageModels,
  stage: AgentCliHandoffKind,
): string | undefined {
  return rules[stage];
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
  const fromStage = stage ? stageAgentCliModel(stage.stageModels, stage.stage) : undefined;
  if (fromStage !== undefined) {
    return { model: fromStage, source: 'stage-rule' };
  }
  const fromWorkspace = defaultAgentCliModel(catalog, provider);
  if (fromWorkspace !== undefined) {
    return { model: fromWorkspace, source: 'workspace-default' };
  }
  return undefined;
}
