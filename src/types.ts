/**
 * Shared types for MWNN Kanban.
 *
 * The board model and the extension-host ⇄ webview message protocol are both
 * declared here so the extension host and the webview type-check against the
 * same contract. The webview script (media/board.js) mirrors these shapes.
 */

import { AGENT_CLI_PROVIDER_IDS, isAgentCliProviderId, type AgentCliProviderId } from './agentCliProviders';
import { isAgentCliHandoffKind, type AgentCliHandoffKind } from './agentCliStages';

/** Protocol for the settings editor, separate from board mutations. */
export type AgentCliSettingsScope = 'workspace' | 'user';
export type AgentCliPanelList = 'models' | 'thinkingLevels';
export type AgentCliSettingsPanelMessage =
  | { readonly type: 'settingsReady' }
  | { readonly type: 'settingsScope'; readonly scope: AgentCliSettingsScope }
  | {
      readonly type: 'settingsListEdit';
      readonly scope: AgentCliSettingsScope;
      readonly provider: AgentCliProviderId;
      readonly list: AgentCliPanelList;
      readonly action: 'add' | 'remove' | 'makeDefault' | 'clear';
      readonly name: string;
    }
  | {
      readonly type: 'settingsStageEdit';
      readonly provider: AgentCliProviderId;
      readonly scope: AgentCliSettingsScope;
      readonly list: AgentCliPanelList;
      readonly stage: AgentCliHandoffKind;
      readonly action: 'set' | 'remove';
      readonly name: string;
    };

export interface AgentCliSettingsPanelProvider {
  readonly id: AgentCliProviderId;
  readonly label: string;
  readonly models: readonly string[];
  readonly thinkingLevels: readonly string[];
  readonly inheritedModels: readonly string[];
  readonly inheritedThinkingLevels: readonly string[];
  readonly suggestedModels: readonly string[];
  readonly suggestedThinkingLevels: readonly string[];
  readonly thinkingApplied: boolean;
}

export interface AgentCliSettingsPanelStage {
  readonly provider: AgentCliProviderId;
  readonly suggestedModels: readonly string[];
  readonly suggestedThinkingLevels: readonly string[];
  readonly id: AgentCliHandoffKind;
  readonly model: string | null;
  readonly thinkingLevel: string | null;
  readonly inheritedModel: string | null;
  readonly inheritedThinkingLevel: string | null;
}

export interface AgentCliSettingsPanelState {
  readonly type: 'settingsState';
  readonly scope: AgentCliSettingsScope;
  readonly workspaceAvailable: boolean;
  readonly inheritedScope: 'User' | 'Extension default';
  readonly providers: readonly AgentCliSettingsPanelProvider[];
  readonly stages: readonly AgentCliSettingsPanelStage[];
  readonly error: string | null;
}

/** Treat incoming webview data as untrusted, including the scope and operation. */
export function isAgentCliSettingsPanelMessage(value: unknown): value is AgentCliSettingsPanelMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const message = value as Record<string, unknown>;
  if (message['type'] === 'settingsReady') {
    return true;
  }
  if (message['scope'] !== 'workspace' && message['scope'] !== 'user') {
    return false;
  }
  if (message['type'] === 'settingsScope') {
    return true;
  }
  if ((message['list'] !== 'models' && message['list'] !== 'thinkingLevels') || typeof message['name'] !== 'string') {
    return false;
  }
  if (message['type'] === 'settingsListEdit') {
    return isAgentCliProviderId(message['provider']) &&
      typeof message['action'] === 'string' &&
      ['add', 'remove', 'makeDefault', 'clear'].includes(message['action']);
  }
  if (message['type'] === 'settingsStageEdit') {
    return isAgentCliHandoffKind(message['stage']) && isAgentCliProviderId(message['provider']) &&
      (message['action'] === 'set' || message['action'] === 'remove');
  }
  return false;
}

export const BOARD_STATE_VERSION = 2 as const;

export type AssigneeKind = 'human' | 'ai';
export type ColumnRole = 'backlog' | 'ready' | 'in-progress' | 'verify' | 'done' | 'custom';

export interface Assignee {
  readonly kind: AssigneeKind;
  readonly name?: string;
}

export interface Card {
  readonly id: string;
  title: string;
  readonly createdAt: number;
  updatedAt?: number;
  description?: string;
  acceptanceCriteria?: string;
  activity?: string;
  assignee?: Assignee;
  /** Ids of other cards this card depends on; it is blocked until they are done. */
  dependsOn?: string[];
  /**
   * AI model this card should be run with, **per agent CLI provider**.
   *
   * Scoped per provider rather than held as one name because a card never
   * chooses the CLI it runs on: the provider is picked per dispatch by the
   * `Run Card with AI` picker or `mwnn-kanban.aiLoopProvider`, and the credit
   * fallback can swap it again mid-run. Model names are CLI-specific, so a
   * single name would be valid for exactly one of the four providers and
   * rejected by the other three the moment the active provider is not the one
   * the card's author had in mind.
   *
   * Each value is free-form on purpose: model names change faster than the
   * extension ships, so a value is passed through to its provider rather than
   * validated against a list. A provider absent from the map simply uses its
   * own default, so the property is omitted entirely rather than stored with an
   * empty map or blank values.
   */
  preferredModels?: CardPreferredModels;
  /**
   * How hard the agent should think while running this card - the reasoning
   * effort - **per agent CLI provider**, and independent of which model runs.
   *
   * A second axis of the same selection: "which model" and "how hard should it
   * think" are separate questions, and encoding the second into the first
   * would mean inventing model names the CLIs do not accept. Scoped per
   * provider for exactly the reasons `preferredModels` is: the card never
   * chooses its own CLI, the credit fallback can swap it mid-run, and each CLI
   * spells its effort levels its own way.
   *
   * Free-form, and never validated against a list: a CLI that gains a new
   * level should be usable the day it ships. A provider absent from the map
   * runs at whatever effort that CLI defaults to, so the property is omitted
   * entirely rather than stored with an empty map or blank values.
   */
  thinkingLevels?: CardThinkingLevels;
}

/**
 * One model name per agent CLI provider. A provider is absent rather than
 * present with a blank value, so `preferredModels[provider]` being undefined
 * always means "this card names no model for that CLI".
 */
export type CardPreferredModels = { [K in AgentCliProviderId]?: string };

/**
 * One thinking level per agent CLI provider. A provider is absent rather than
 * present with a blank value, so `thinkingLevels[provider]` being undefined
 * always means "this card names no thinking level for that CLI" and the run
 * uses that CLI's own default effort.
 */
export type CardThinkingLevels = { [K in AgentCliProviderId]?: string };

export interface Column {
  readonly id: string;
  title: string;
  cards: Card[];
  role?: ColumnRole;
  wipLimit?: number | null;
  reverseWip?: number | null;
}

export interface BoardState {
  readonly version: typeof BOARD_STATE_VERSION;
  columns: Column[];
}

/** Messages sent from the webview to the extension host. */
export type WebviewToHostMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'requestAddCard'; readonly columnId: string }
  | { readonly type: 'requestAddColumn' }
  /** Open the settings editor on the per-CLI model list behind the card model picker. */
  | { readonly type: 'openModelSettings' }
  | { readonly type: 'addCard'; readonly columnId: string; readonly title: string }
  | { readonly type: 'addColumn'; readonly title: string }
  | { readonly type: 'editCard'; readonly cardId: string; readonly title: string }
  | { readonly type: 'duplicateCard'; readonly cardId: string }
  | { readonly type: 'copyCardPath'; readonly cardId: string }
  | { readonly type: 'renameColumn'; readonly columnId: string; readonly title: string }
  | {
      readonly type: 'setColumnLimits';
      readonly columnId: string;
      readonly wipLimit: number | null;
      readonly reverseWip: number | null;
    }
  | { readonly type: 'deleteColumn'; readonly columnId: string; readonly targetColumnId?: string }
  | { readonly type: 'reorderColumn'; readonly columnId: string; readonly toIndex: number }
  | { readonly type: 'setDescription'; readonly cardId: string; readonly description: string }
  | { readonly type: 'setAcceptanceCriteria'; readonly cardId: string; readonly acceptanceCriteria: string }
  | { readonly type: 'setActivity'; readonly cardId: string; readonly activity: string }
  | { readonly type: 'setAssignee'; readonly cardId: string; readonly assignee?: Assignee }
  | { readonly type: 'setDependencies'; readonly cardId: string; readonly dependsOn: readonly string[] }
  | {
      readonly type: 'setPreferredModel';
      readonly cardId: string;
      /** Which CLI the model is for; a card names one model per provider. */
      readonly provider: AgentCliProviderId;
      readonly preferredModel?: string;
    }
  | {
      readonly type: 'setThinkingLevel';
      readonly cardId: string;
      /** Which CLI the level is for; a card names one level per provider. */
      readonly provider: AgentCliProviderId;
      readonly thinkingLevel?: string;
    }
  | { readonly type: 'runCardWithAI'; readonly cardId: string }
  /** Abort only this card's single-card CLI run; other runs and the AI loop are untouched. */
  | { readonly type: 'stopCardRun'; readonly cardId: string }
  /** Start or resume a Human card's AI-guided interview. */
  | { readonly type: 'startCardInterview'; readonly cardId: string }
  | { readonly type: 'fillCardDefinition'; readonly cardId: string }
  | { readonly type: 'offerCardDefinition'; readonly cardId: string }
  | { readonly type: 'deleteCard'; readonly cardId: string }
  | { readonly type: 'moveCard'; readonly cardId: string; readonly toColumnId: string; readonly toIndex: number }
  | { readonly type: 'setZoom'; readonly zoom: number };

/**
 * Model names to *suggest* for each agent CLI, sent to the webview with the
 * board so the card UI's model combo box can offer a list.
 *
 * Structurally the workspace model catalog (`AgentCliModelCatalog`), declared
 * here because it crosses the extension-host ⇄ webview boundary and every
 * message shape is declared in this module. Suggestions are presentation only:
 * the card's model stays free-form and pass-through, so a name absent from a
 * provider's list is still shown, saved, and dispatched unchanged. A provider
 * with nothing configured is absent rather than present with an empty list, so
 * `modelSuggestions[provider]` being undefined always means "no suggestions for
 * this CLI" and the field is simply offered without a list.
 */
export type AgentCliModelSuggestions = { readonly [K in AgentCliProviderId]?: readonly string[] };

/** Live status of an agent CLI run so the board can badge the card. */
export interface CliRunStatus {
  readonly cardId: string;
  readonly providerLabel: string;
  readonly running: boolean;
  readonly statusLine?: string;
  /**
   * True when the run is a single-card run the board's Stop button can abort.
   * AI loop dispatches also badge their card but are stopped from the loop
   * controls, so they omit this.
   */
  readonly stoppable?: boolean;
}

/**
 * A short label rendered on one card, supplied through the Pro board
 * capability (e.g. observed tracked hours). The board renders `text` verbatim
 * and knows nothing of its meaning; with no Pro package there are none.
 */
export interface CardBadge {
  readonly cardId: string;
  readonly text: string;
  /** Hover text. */
  readonly title?: string;
}

export const CARD_BADGE_TEXT_MAX = 24;
export const CARD_BADGE_TITLE_MAX = 200;
export const CARD_BADGES_MAX = 10_000;

/**
 * Validate badges arriving from the optional Pro package before they reach the
 * webview. Malformed entries are dropped, strings are capped, and a repeated
 * card id keeps its last badge.
 */
export function sanitizeCardBadges(value: unknown): readonly CardBadge[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const byCard = new Map<string, CardBadge>();
  for (const entry of value.slice(0, CARD_BADGES_MAX)) {
    if (!isRecord(entry)) {
      continue;
    }
    const cardId = entry['cardId'];
    const text = entry['text'];
    const title = entry['title'];
    if (typeof cardId !== 'string' || cardId.length === 0 || typeof text !== 'string') {
      continue;
    }
    const trimmedText = text.trim().slice(0, CARD_BADGE_TEXT_MAX);
    if (trimmedText.length === 0) {
      continue;
    }
    byCard.set(cardId, {
      cardId,
      text: trimmedText,
      ...(typeof title === 'string' && title.trim().length > 0
        ? { title: title.trim().slice(0, CARD_BADGE_TITLE_MAX) }
        : {}),
    });
  }
  return [...byCard.values()];
}

/** Messages sent from the extension host to the webview. */
export type HostToWebviewMessage =
  | {
      readonly type: 'state';
      readonly board: BoardState;
      readonly enableRunWithAI: boolean;
      readonly zoom: number;
      /**
       * Per-provider model names to offer in the card UI's model picker. The
       * webview has no `vscode` API, so the configured list has to travel with
       * the board rather than be read from settings on the webview side.
       */
      readonly modelSuggestions: AgentCliModelSuggestions;
      /**
       * Per-provider thinking levels to offer in the card UI's thinking field,
       * from `mwnn-kanban.agentCliThinkingLevels`. Presentation only, exactly
       * like `modelSuggestions`: a level absent from the list is still saved
       * and dispatched as typed.
       */
      readonly thinkingLevelSuggestions: AgentCliModelSuggestions;
    }
  | { readonly type: 'openCard'; readonly cardId: string }
  | {
      readonly type: 'cardPathCopyResult';
      readonly cardId: string;
      readonly ok: boolean;
      readonly path: string;
      readonly message: string;
    }
  | ({ readonly type: 'cliRunStatus' } & CliRunStatus)
  /** Full replacement set of card badges; an empty list clears them. */
  | { readonly type: 'cardBadges'; readonly badges: readonly CardBadge[] };

/** Runtime type guard for persisted/posted board state. */
export function isBoardState(value: unknown): value is BoardState {
  if (!isRecord(value)) {
    return false;
  }
  const candidate = value;
  if (candidate['version'] !== BOARD_STATE_VERSION) {
    return false;
  }
  if (!Array.isArray(candidate['columns'])) {
    return false;
  }
  return candidate['columns'].every(isColumn);
}

/** Runtime type guard for messages arriving from the webview. */
export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  if (!isRecord(value) || typeof value['type'] !== 'string') {
    return false;
  }

  switch (value['type']) {
    case 'ready':
      return true;
    case 'requestAddCard':
      return typeof value['columnId'] === 'string';
    case 'requestAddColumn':
      return true;
    case 'openModelSettings':
      return true;
    case 'addCard':
      return typeof value['columnId'] === 'string' && typeof value['title'] === 'string';
    case 'addColumn':
      return typeof value['title'] === 'string';
    case 'editCard':
      return typeof value['cardId'] === 'string' && typeof value['title'] === 'string';
    case 'duplicateCard':
      return typeof value['cardId'] === 'string';
    case 'copyCardPath':
      return typeof value['cardId'] === 'string';
    case 'renameColumn':
      return typeof value['columnId'] === 'string' && typeof value['title'] === 'string';
    case 'setColumnLimits':
      return (
        typeof value['columnId'] === 'string' &&
        isOptionalLimit(value['wipLimit']) &&
        value['wipLimit'] !== undefined &&
        isOptionalLimit(value['reverseWip']) &&
        value['reverseWip'] !== undefined
      );
    case 'deleteColumn':
      return (
        typeof value['columnId'] === 'string' &&
        (value['targetColumnId'] === undefined || typeof value['targetColumnId'] === 'string')
      );
    case 'reorderColumn':
      return typeof value['columnId'] === 'string' && Number.isInteger(value['toIndex']);
    case 'setDescription':
      return typeof value['cardId'] === 'string' && typeof value['description'] === 'string';
    case 'setAcceptanceCriteria':
      return typeof value['cardId'] === 'string' && typeof value['acceptanceCriteria'] === 'string';
    case 'setActivity':
      return typeof value['cardId'] === 'string' && typeof value['activity'] === 'string';
    case 'setAssignee':
      return (
        typeof value['cardId'] === 'string' &&
        (value['assignee'] === undefined || isAssignee(value['assignee']))
      );
    case 'setDependencies':
      return (
        typeof value['cardId'] === 'string' &&
        Array.isArray(value['dependsOn']) &&
        value['dependsOn'].every((id) => typeof id === 'string')
      );
    case 'setPreferredModel':
      return (
        typeof value['cardId'] === 'string' &&
        isAgentCliProviderId(value['provider']) &&
        (value['preferredModel'] === undefined || typeof value['preferredModel'] === 'string')
      );
    case 'setThinkingLevel':
      return (
        typeof value['cardId'] === 'string' &&
        isAgentCliProviderId(value['provider']) &&
        (value['thinkingLevel'] === undefined || typeof value['thinkingLevel'] === 'string')
      );
    case 'runCardWithAI':
    case 'stopCardRun':
    case 'startCardInterview':
      return typeof value['cardId'] === 'string';
    case 'fillCardDefinition':
    case 'offerCardDefinition':
      return typeof value['cardId'] === 'string';
    case 'deleteCard':
      return typeof value['cardId'] === 'string';
    case 'moveCard':
      return (
        typeof value['cardId'] === 'string' &&
        typeof value['toColumnId'] === 'string' &&
        Number.isInteger(value['toIndex'])
      );
    case 'setZoom':
      return typeof value['zoom'] === 'number' && Number.isFinite(value['zoom']);
    default:
      return false;
  }
}

/**
 * Whether a card can run as an AI-guided interview: every Human-assigned card
 * can. AI and unassigned cards never can.
 */
export function isInterviewCard(card: Pick<Card, 'assignee'>): boolean {
  return card.assignee?.kind === 'human';
}

export function isAssignee(value: unknown): value is Assignee {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isAssigneeKind(value['kind']) &&
    (value['name'] === undefined || typeof value['name'] === 'string')
  );
}

function isColumn(value: unknown): value is Column {
  if (!isRecord(value)) {
    return false;
  }
  const candidate = value;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['title'] === 'string' &&
    Array.isArray(candidate['cards']) &&
    candidate['cards'].every(isCard) &&
    (candidate['role'] === undefined || isColumnRole(candidate['role'])) &&
    isOptionalLimit(candidate['wipLimit']) &&
    isOptionalLimit(candidate['reverseWip'])
  );
}

function isCard(value: unknown): value is Card {
  if (!isRecord(value)) {
    return false;
  }
  const candidate = value;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['title'] === 'string' &&
    typeof candidate['createdAt'] === 'number' &&
    (candidate['updatedAt'] === undefined || typeof candidate['updatedAt'] === 'number') &&
    (candidate['description'] === undefined || typeof candidate['description'] === 'string') &&
    (candidate['acceptanceCriteria'] === undefined || typeof candidate['acceptanceCriteria'] === 'string') &&
    (candidate['activity'] === undefined || typeof candidate['activity'] === 'string') &&
    (candidate['assignee'] === undefined || isAssignee(candidate['assignee'])) &&
    (candidate['dependsOn'] === undefined ||
      (Array.isArray(candidate['dependsOn']) && candidate['dependsOn'].every((id) => typeof id === 'string'))) &&
    (candidate['interview'] === undefined || candidate['interview'] === true) &&
    (candidate['preferredModels'] === undefined || isCardPreferredModels(candidate['preferredModels'])) &&
    (candidate['thinkingLevels'] === undefined || isCardThinkingLevels(candidate['thinkingLevels']))
  );
}

/**
 * Runtime type guard for a card's per-provider model map.
 *
 * Deliberately strict: an unknown provider key or a blank value is rejected
 * rather than accepted-and-ignored, so nothing unusable is ever stored in board
 * state. The card-file parser and the board mutations drop such entries before
 * they reach state, which is what keeps a hand-edited card file readable while
 * this guard stays the hard boundary for posted and persisted data.
 */
export function isCardPreferredModels(value: unknown): value is CardPreferredModels {
  if (!isRecord(value) || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return false;
  }
  return entries.every(
    ([provider, model]) =>
      isAgentCliProviderId(provider) && typeof model === 'string' && model.trim().length > 0,
  );
}

/**
 * Runtime type guard for a card's per-provider thinking-level map.
 *
 * Strict for the same reason {@link isCardPreferredModels} is: an unknown
 * provider key or a blank value is rejected rather than accepted-and-ignored,
 * so nothing unusable is ever stored in board state. The card-file parser and
 * the board mutations drop such entries before they reach state, which keeps a
 * hand-edited card file forgiving while this guard stays the hard boundary for
 * posted and persisted data.
 */
export function isCardThinkingLevels(value: unknown): value is CardThinkingLevels {
  if (!isRecord(value) || Array.isArray(value)) {
    return false;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return false;
  }
  return entries.every(
    ([provider, level]) =>
      isAgentCliProviderId(provider) && typeof level === 'string' && level.trim().length > 0,
  );
}

/** Every provider id, re-exported so board code need not reach past the model. */
export { AGENT_CLI_PROVIDER_IDS, isAgentCliProviderId, type AgentCliProviderId };

function isAssigneeKind(value: unknown): value is AssigneeKind {
  return value === 'human' || value === 'ai';
}

function isColumnRole(value: unknown): value is ColumnRole {
  return (
    value === 'backlog' ||
    value === 'ready' ||
    value === 'in-progress' ||
    value === 'verify' ||
    value === 'done' ||
    value === 'custom'
  );
}

function isOptionalLimit(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
