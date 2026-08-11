import { createRequire } from 'node:module';
import type * as vscode from 'vscode';
import {
  isProFeatureRegistrarModule,
  type ProFeatureRegistrar,
  type ProFeatureRegistrationContext,
  type ProFeatureRegistrationResult,
} from './contracts';

export const DEFAULT_PRO_PACKAGE_NAME = '@tempuskg/mwnn-kanban-pro';

interface LoadProFeatureRegistrarDeps {
  readonly moduleSpecifier: string;
  readonly resolveModule: (specifier: string) => string;
  readonly requireModule: (resolvedPath: string) => unknown;
}

interface AvailableProFeatureLoadResult {
  readonly kind: 'available';
  readonly moduleSpecifier: string;
  readonly resolvedPath: string;
  readonly registrar: ProFeatureRegistrar;
}

interface UnavailableProFeatureLoadResult {
  readonly kind: 'unavailable';
  readonly reason: 'not-found' | 'invalid-module' | 'load-failed' | 'register-failed';
  readonly moduleSpecifier: string;
  readonly detail: string;
}

export type ProFeatureLoadResult = AvailableProFeatureLoadResult | UnavailableProFeatureLoadResult;

const nodeRequire = createRequire(__filename);

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as { readonly code?: unknown }).code === code;
}

function unwrapRegistrarModule(value: unknown): unknown {
  if (isProFeatureRegistrarModule(value)) {
    return value;
  }

  if (typeof value === 'object' && value !== null && 'default' in value) {
    return (value as { readonly default: unknown }).default;
  }

  return value;
}

function normalizeRegistrationResult(
  result: Awaited<ProFeatureRegistrationResult>,
): readonly vscode.Disposable[] {
  if (result === undefined) {
    return [];
  }

  if (Array.isArray(result)) {
    return result;
  }

  return [result as vscode.Disposable];
}

export function loadProFeatureRegistrar(
  deps: Partial<LoadProFeatureRegistrarDeps> = {},
): ProFeatureLoadResult {
  const moduleSpecifier = deps.moduleSpecifier ?? DEFAULT_PRO_PACKAGE_NAME;
  const resolveModule = deps.resolveModule ?? ((specifier: string) => nodeRequire.resolve(specifier));
  const requireModule = deps.requireModule ?? ((resolvedPath: string) => nodeRequire(resolvedPath));

  let resolvedPath: string;
  try {
    // Resolve first so an absent package is distinguishable from a broken
    // dependency inside the optional package itself.
    resolvedPath = resolveModule(moduleSpecifier);
  } catch (error) {
    if (isNodeErrorWithCode(error, 'MODULE_NOT_FOUND')) {
      return {
        kind: 'unavailable',
        reason: 'not-found',
        moduleSpecifier,
        detail: `Optional Pro package '${moduleSpecifier}' is not installed; continuing with free features only.`,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      kind: 'unavailable',
      reason: 'load-failed',
      moduleSpecifier,
      detail: `Failed to resolve Pro package '${moduleSpecifier}': ${message}`,
    };
  }

  try {
    const loadedModule = unwrapRegistrarModule(requireModule(resolvedPath));
    if (!isProFeatureRegistrarModule(loadedModule)) {
      return {
        kind: 'unavailable',
        reason: 'invalid-module',
        moduleSpecifier,
        detail: `Pro package '${moduleSpecifier}' does not export a registerProFeatures() function.`,
      };
    }

    return {
      kind: 'available',
      moduleSpecifier,
      resolvedPath,
      registrar: loadedModule.registerProFeatures,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      kind: 'unavailable',
      reason: 'load-failed',
      moduleSpecifier,
      detail: `Failed to load Pro package '${moduleSpecifier}': ${message}`,
    };
  }
}

export async function activateProFeatures(
  context: ProFeatureRegistrationContext,
  deps: Partial<LoadProFeatureRegistrarDeps> = {},
): Promise<ProFeatureLoadResult> {
  const loadResult = loadProFeatureRegistrar(deps);
  if (loadResult.kind !== 'available') {
    context.log(loadResult.detail);
    return loadResult;
  }

  try {
    const registrations = normalizeRegistrationResult(
      await loadResult.registrar(context),
    );
    for (const disposable of registrations) {
      context.registerDisposable(disposable);
    }

    context.log(`Loaded Pro features from '${loadResult.moduleSpecifier}'.`);
    return loadResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedResult: UnavailableProFeatureLoadResult = {
      kind: 'unavailable',
      reason: 'register-failed',
      moduleSpecifier: loadResult.moduleSpecifier,
      detail: `Failed to register Pro features from '${loadResult.moduleSpecifier}': ${message}`,
    };
    context.log(failedResult.detail);
    return failedResult;
  }
}
