import type * as vscode from 'vscode';

export interface ProFeatureRegistrationContext {
  readonly extensionContext: vscode.ExtensionContext;
  readonly log: (message: string) => void;
  readonly registerDisposable: (disposable: vscode.Disposable) => void;
}

export type ProFeatureRegistrationResult =
  | vscode.Disposable
  | readonly vscode.Disposable[]
  | undefined
  | Promise<vscode.Disposable | readonly vscode.Disposable[] | undefined>;

export type ProFeatureRegistrar = (
  context: ProFeatureRegistrationContext,
) => ProFeatureRegistrationResult;

export interface ProFeatureRegistrarModule {
  readonly registerProFeatures: ProFeatureRegistrar;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isProFeatureRegistrarModule(value: unknown): value is ProFeatureRegistrarModule {
  return isRecord(value) && typeof value.registerProFeatures === 'function';
}
