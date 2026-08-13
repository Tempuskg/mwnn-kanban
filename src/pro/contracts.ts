import type * as vscode from 'vscode';
import type { BoardState } from '../types';

export const BOARD_CAPABILITY_VERSION = 1 as const;

export interface BoardChangeEvent {
  readonly previous: BoardState;
  readonly current: BoardState;
  /** What triggered the notification, not what changed. Classify via previous/current. */
  readonly reason: 'mutation' | 'reload';
  readonly workspaceRoot: string;
  readonly boardFolder: string;
  readonly at: number;
}

/**
 * Board capability versioning policy: add members without bumping the version
 * and feature-detect them at runtime. Removing a member or changing its
 * semantics requires a new capability version.
 */
export interface BoardCapabilityV1 {
  readonly version: typeof BOARD_CAPABILITY_VERSION;
  readonly workspaceRoot: string | undefined;
  readonly boardFolder: string;
  readonly getBoard: () => Promise<BoardState | undefined>;
  readonly onDidChangeBoard: vscode.Event<BoardChangeEvent>;
  readonly readBoardAt: (rootFsPath: string, boardFolder?: string) => Promise<BoardState | undefined>;
  readonly revealCard: (cardId: string) => Promise<boolean>;
  readonly cardFilePath: (cardId: string) => string;
}

export interface ProFeatureCapabilities {
  readonly board?: BoardCapabilityV1;
}

export interface ProFeatureRegistrationContext {
  readonly extensionContext: vscode.ExtensionContext;
  readonly capabilities?: ProFeatureCapabilities;
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
