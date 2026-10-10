import type * as vscode from 'vscode';
import type { BoardState, CardBadge } from '../types';

export type { CardBadge } from '../types';

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
  /**
   * Additive and optional: Pro feature-detects it with `typeof === 'function'`.
   * Replaces the full badge set for this board; `[]` clears it.
   */
  readonly setCardBadges?: (badges: readonly CardBadge[]) => void;
}


/** Additive CLI-only seam. One session owns the window lease and dispatch ledger. */
export interface PortfolioLoopProject {
  readonly projectId: string;
  readonly projectName: string;
  readonly root: string;
  readonly boardFolder: string;
}
export interface PortfolioLoopCard {
  readonly cardId: string;
  readonly cardTitle: string;
}
export type PortfolioLoopSelection =
  | { readonly kind: 'card'; readonly card: PortfolioLoopCard }
  | { readonly kind: 'empty'; readonly reason: string };
export interface PortfolioLoopProgress extends PortfolioLoopCard {
  readonly stage: string;
  readonly message: string;
}
export interface PortfolioLoopCardResult {
  readonly outcome: 'completed' | 'human' | 'review' | 'skipped' | 'held' | 'stopped';
  readonly reason?: string;
}
export interface PortfolioLoopSessionV1 {
  selectCard(project: PortfolioLoopProject): Promise<PortfolioLoopSelection>;
  runCard(project: PortfolioLoopProject, cardId: string, report: (progress: PortfolioLoopProgress) => void): Promise<PortfolioLoopCardResult>;
  pause(): void;
  resume(): void;
  stop(): void;
  outcome(): 'finished' | 'stopped' | 'budget' | 'credits';
  /** Releases the window lease after all outstanding work has settled. */
  finish(): string;
}
export interface PortfolioAiLoopCapabilityV1 {
  readonly version: 1;
  availability(): { readonly enabled: boolean; readonly busy: boolean; readonly reason?: string };
  /** Claims the window before the CLI picker; cancellation releases it. */
  start(): Promise<PortfolioLoopSessionV1 | undefined>;
  readonly onDidChange: vscode.Event<void>;
}

export interface ProFeatureCapabilities {
  readonly board?: BoardCapabilityV1;
  readonly portfolioAiLoop?: PortfolioAiLoopCapabilityV1;
}

export interface ProFeatureRegistrationContext {
  readonly extensionContext: vscode.ExtensionContext;
  readonly capabilities?: ProFeatureCapabilities;
  readonly hasProLicense: (
    workspaceFolder?: vscode.WorkspaceFolder,
  ) => Promise<boolean>;
  readonly showUpgradePrompt: (
    workspaceFolder?: vscode.WorkspaceFolder,
  ) => Promise<void>;
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
