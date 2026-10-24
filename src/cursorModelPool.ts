/**
 * Classify a resolved Cursor Agent CLI model name into the usage pool it draws
 * from. This is the allowance seam beside `agentCliUsageProbe` and
 * `agentCliOrchestrator`.
 *
 * Two selectable identities share one Cursor Agent CLI executable:
 * - `cursor` (**Cursor Agent CLI**) → Auto / Cursor-models pool
 * - `cursor-other` (**Cursor Agent CLI Other**) → Other Models pool
 *
 * Display names below name those pools in ranking / wait copy. Model→pool
 * classification still filters suggestion lists (Auto vs Other Models) when a
 * catalog is shared.
 *
 * Allow-list (Auto / Cursor-models), matched on the canonical id below.
 * Everything else that names a model is Other Models.
 *
 * Exact ids:
 * - `auto` — Cursor Auto. A resolved `auto` does not name a third-party model,
 *   so it stays on this pool. A Teams Balance or Intelligence route that the
 *   CLI reports as a concrete third-party id is classified from that id.
 *
 * Prefixes (the id equals the prefix, or continues with `-`):
 * - `composer` — Composer family (`composer`, `composer-2.5`,
 *   `composer-2.5-fast`, and later Composer ids).
 * - `grok-4.5`, `grok-4.6`, `grok-4.7` — Cursor's first-party Grok models,
 *   including Fast and long-context suffixes (`grok-4.7-fast`,
 *   `grok-4.7-500k`). The all-hyphen spellings (`grok-4-7`) are accepted too.
 *   Older Grok ids (`grok-4`, `grok-3`) are not on this list.
 *
 * Canonical form: trim, lowercase, and collapse spaces and underscores to a
 * single hyphen, so `Composer 2.5` and `composer-2.5` are the same id. A blank
 * id, a control character, or `default` does not name a model.
 *
 * An empty or ambiguous id is Auto only when `productDefault` itself is on
 * this allow-list (that dispatch's product default draws from Auto). Any other
 * product default, including an empty one, is Other Models. A concrete
 * resolved name ignores `productDefault`.
 *
 * No `vscode` import.
 */

import type { AgentCliProviderId } from './agentCliProviders';

/** User-facing name of the Auto / Cursor-models pool. */
export const CURSOR_AUTO_POOL_DISPLAY_NAME = 'Cursor';

/** User-facing name of the Other Models pool / Cursor Agent CLI Other identity. */
export const CURSOR_OTHER_MODELS_DISPLAY_NAME = 'Cursor Agent CLI Other';

/** Exact Auto-pool ids, compared after canonicalization. */
export const CURSOR_AUTO_POOL_EXACT_IDS = ['auto'] as const;

/**
 * Auto-pool prefixes, compared after canonicalization. A match is the prefix
 * itself or the prefix followed by `-`.
 */
export const CURSOR_AUTO_POOL_PREFIXES = [
  'composer',
  'grok-4.5',
  'grok-4-5',
  'grok-4.6',
  'grok-4-6',
  'grok-4.7',
  'grok-4-7',
] as const;

/**
 * Canonical ids that mean "no model was named". They use the product-default
 * rule instead of the Other Models default for resolved names.
 */
export const CURSOR_AMBIGUOUS_MODEL_IDS = ['default'] as const;

export type CursorUsagePoolId = 'auto' | 'other-models';

export interface CursorModelPool {
  readonly pool: CursorUsagePoolId;
  readonly displayName: typeof CURSOR_AUTO_POOL_DISPLAY_NAME | typeof CURSOR_OTHER_MODELS_DISPLAY_NAME;
}

export interface ClassifyCursorModelPoolInput {
  /** Resolved model for this dispatch. Omit when the dispatch named none. */
  readonly model?: string;
  /**
   * Model this dispatch runs when `model` is empty or ambiguous: the product
   * default for that invocation (`auto` when the CLI is left on Auto). Omit
   * when that default is not known.
   */
  readonly productDefault?: string;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** Trim, lowercase, and turn spaces or underscores into hyphens. */
export function canonicalCursorModelId(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || hasControlCharacter(trimmed)) {
    return undefined;
  }
  return trimmed.replace(/[\s_]+/g, '-');
}

function isAmbiguousCursorModel(canonical: string | undefined): boolean {
  return canonical === undefined || (CURSOR_AMBIGUOUS_MODEL_IDS as readonly string[]).includes(canonical);
}

/** True when the canonical id is on the Auto / Cursor-models allow-list. */
export function isCursorAutoPoolModel(canonical: string): boolean {
  if ((CURSOR_AUTO_POOL_EXACT_IDS as readonly string[]).includes(canonical)) {
    return true;
  }
  return CURSOR_AUTO_POOL_PREFIXES.some(
    (prefix) => canonical === prefix || canonical.startsWith(`${prefix}-`),
  );
}

function poolResult(pool: CursorUsagePoolId): CursorModelPool {
  return pool === 'auto'
    ? { pool, displayName: CURSOR_AUTO_POOL_DISPLAY_NAME }
    : { pool, displayName: CURSOR_OTHER_MODELS_DISPLAY_NAME };
}

/**
 * Map one Cursor dispatch onto Auto or Other Models.
 * A resolved name on the allow-list is Auto; every other resolved name is
 * Other Models. An empty or ambiguous name follows `productDefault`, and is
 * Auto only when that default is itself on the allow-list.
 */
export function classifyCursorModelPool(input: ClassifyCursorModelPoolInput): CursorModelPool {
  const resolved = canonicalCursorModelId(input.model);
  if (!isAmbiguousCursorModel(resolved) && resolved !== undefined) {
    return poolResult(isCursorAutoPoolModel(resolved) ? 'auto' : 'other-models');
  }
  const productDefault = canonicalCursorModelId(input.productDefault);
  const productDefaultIsAuto = !isAmbiguousCursorModel(productDefault)
    && productDefault !== undefined
    && isCursorAutoPoolModel(productDefault);
  return poolResult(productDefaultIsAuto ? 'auto' : 'other-models');
}

/**
 * Usage pool for a selectable Cursor identity. `cursor` is Auto;
 * `cursor-other` is Other Models. Non-Cursor providers return undefined.
 */
export function cursorUsagePoolForProvider(
  provider: AgentCliProviderId,
): CursorUsagePoolId | undefined {
  if (provider === 'cursor') {
    return 'auto';
  }
  if (provider === 'cursor-other') {
    return 'other-models';
  }
  return undefined;
}
