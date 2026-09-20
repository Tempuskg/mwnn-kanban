/**
 * Shared types for MWNN Kanban.
 *
 * The board model and the extension-host ⇄ webview message protocol are both
 * declared here so the extension host and the webview type-check against the
 * same contract. The webview script (media/board.js) mirrors these shapes.
 */

import { AGENT_CLI_PROVIDER_IDS, isAgentCliProviderId, type AgentCliProviderId } from './agentCliProviders';

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
}

/**
 * One model name per agent CLI provider. A provider is absent rather than
 * present with a blank value, so `preferredModels[provider]` being undefined
 * always means "this card names no model for that CLI".
 */
export type CardPreferredModels = { [K in AgentCliProviderId]?: string };

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
  | { readonly type: 'runCardWithAI'; readonly cardId: string }
  | { readonly type: 'fillCardDefinition'; readonly cardId: string }
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
    }
  | { readonly type: 'openCard'; readonly cardId: string }
  | {
      readonly type: 'cardPathCopyResult';
      readonly cardId: string;
      readonly ok: boolean;
      readonly path: string;
      readonly message: string;
    }
  | ({ readonly type: 'cliRunStatus' } & CliRunStatus);

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
    case 'runCardWithAI':
      return typeof value['cardId'] === 'string';
    case 'fillCardDefinition':
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
    (candidate['preferredModels'] === undefined || isCardPreferredModels(candidate['preferredModels']))
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
