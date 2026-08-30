import type * as vscode from 'vscode';
import {
  createProLicenseManager,
  type ProLicenseConfiguration,
  type ProLicenseManager,
} from './licenseManager';

// The landing page carries the checkout links, so every in-editor purchase
// surface points here rather than at the source repository.
export const PRO_PURCHASE_URL = 'https://mwnnkanban.dev/#purchase';
export const PRO_UPGRADE_PROMPT_LABEL = 'Get Pro';
export const PRO_ACTIVATE_PROMPT_LABEL = 'Enter License Key';
export const ENTER_PRO_LICENSE_KEY_COMMAND = 'mwnn-kanban.enterProLicenseKey';
export const CLEAR_PRO_LICENSE_KEY_COMMAND = 'mwnn-kanban.clearProLicenseKey';
export const SHOW_PRO_LICENSE_STATUS_COMMAND = 'mwnn-kanban.showProLicenseStatus';
export const UPGRADE_TO_PRO_COMMAND = 'mwnn-kanban.upgradeToPro';
// Menu `when` clauses read this; a valid key or live trial grants access.
export const PRO_LICENSE_CONTEXT_KEY = 'mwnn-kanban.hasProLicense';

type CommandCallback = (...args: unknown[]) => unknown;

export interface ProUpgradeDeps {
  readonly registerCommand: (
    command: string,
    callback: CommandCallback,
  ) => vscode.Disposable;
  readonly executeCommand: (
    command: string,
    ...args: unknown[]
  ) => PromiseLike<unknown>;
  readonly getImplicitWorkspaceFolder: () => vscode.WorkspaceFolder | undefined;
  readonly getConfiguration: (
    workspaceFolder?: vscode.WorkspaceFolder,
  ) => ProLicenseConfiguration;
  readonly showInputBox: (
    options: vscode.InputBoxOptions,
  ) => PromiseLike<string | undefined>;
  readonly showInformationMessage: (
    message: string,
    ...items: string[]
  ) => PromiseLike<string | undefined>;
  readonly showWarningMessage: (
    message: string,
    options: vscode.MessageOptions,
    ...items: string[]
  ) => PromiseLike<string | undefined>;
  readonly showErrorMessage: (
    message: string,
  ) => PromiseLike<string | undefined>;
  readonly openExternal: (target: vscode.Uri) => PromiseLike<boolean>;
  readonly parseUri: (value: string) => vscode.Uri;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}

interface ShowUpgradePromptDeps {
  readonly showInformationMessage: (
    message: string,
    ...items: string[]
  ) => PromiseLike<string | undefined>;
  readonly openExternal: (target: vscode.Uri) => PromiseLike<boolean>;
  readonly parseUri: (value: string) => vscode.Uri;
  readonly upgradeUrl: string;
}

interface OpenProPurchasePageDeps {
  readonly openExternal: (target: vscode.Uri) => PromiseLike<boolean>;
  readonly parseUri: (value: string) => vscode.Uri;
  readonly purchaseUrl: string;
}

let activeLicenseManager: ProLicenseManager | undefined;
let activeUpgradeDeps: ProUpgradeDeps | undefined;
/** The last value published to {@link PRO_LICENSE_CONTEXT_KEY}. */
let publishedProLicense = false;

type ProLicenseListener = (licensed: boolean) => void;
const proLicenseListeners = new Set<ProLicenseListener>();

/**
 * The licence state currently published to the `mwnn-kanban.hasProLicense`
 * context key, readable synchronously. UI that has to decide what to render
 * right now (the sidebar's Portfolio button) reads this so it can never
 * disagree with the palette and menu `when` clauses.
 */
export function isProLicenseActive(): boolean {
  return publishedProLicense;
}

/**
 * Subscribe to changes of the published licence state. Fires only when the
 * value actually changes, so entering or clearing a key updates live UI without
 * a reload.
 */
export function onDidChangeProLicense(listener: ProLicenseListener): vscode.Disposable {
  proLicenseListeners.add(listener);
  return {
    dispose(): void {
      proLicenseListeners.delete(listener);
    },
  };
}

export async function openProPurchasePage(
  deps: Partial<OpenProPurchasePageDeps> = {},
): Promise<void> {
  const openExternal = deps.openExternal ?? activeUpgradeDeps?.openExternal;
  const parseUri = deps.parseUri ?? activeUpgradeDeps?.parseUri;
  if (!openExternal || !parseUri) {
    return;
  }

  await openExternal(parseUri(deps.purchaseUrl ?? PRO_PURCHASE_URL));
}

async function publishProLicenseContext(licensed: boolean): Promise<void> {
  await activeUpgradeDeps?.executeCommand(
    'setContext',
    PRO_LICENSE_CONTEXT_KEY,
    licensed,
  );

  if (publishedProLicense === licensed) {
    return;
  }
  publishedProLicense = licensed;
  for (const listener of [...proLicenseListeners]) {
    listener(licensed);
  }
}

export function initializeProLicenseCommands(
  context: vscode.ExtensionContext,
  deps: ProUpgradeDeps,
): readonly vscode.Disposable[] {
  activeUpgradeDeps = deps;
  activeLicenseManager = createProLicenseManager({
    context,
    getConfiguration: deps.getConfiguration,
    showInputBox: deps.showInputBox,
    showInformationMessage: deps.showInformationMessage,
    showErrorMessage: deps.showErrorMessage,
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    ...(deps.now !== undefined ? { now: deps.now } : {}),
  });

  // Seed the context key so purchase menus are correct on the first palette open.
  void hasProLicense(deps.getImplicitWorkspaceFolder());

  return [
    deps.registerCommand(UPGRADE_TO_PRO_COMMAND, async () => {
      await openProPurchasePage();
    }),
    deps.registerCommand(ENTER_PRO_LICENSE_KEY_COMMAND, async () => {
      const workspaceFolder = deps.getImplicitWorkspaceFolder();
      await activeLicenseManager?.promptEnterKey(workspaceFolder);
      await hasProLicense(workspaceFolder);
    }),
    deps.registerCommand(CLEAR_PRO_LICENSE_KEY_COMMAND, async () => {
      const confirmation = await deps.showWarningMessage(
        'Clear your MWNN Kanban Pro license key?',
        { modal: true },
        'Clear',
      );
      if (confirmation === 'Clear') {
        await activeLicenseManager?.clearKey();
        await hasProLicense(deps.getImplicitWorkspaceFolder());
        await deps.showInformationMessage('MWNN Kanban Pro license key cleared.');
      }
    }),
    deps.registerCommand(SHOW_PRO_LICENSE_STATUS_COMMAND, async () => {
      const workspaceFolder = deps.getImplicitWorkspaceFolder();
      await activeLicenseManager?.showLicenseStatus(workspaceFolder);
      await hasProLicense(workspaceFolder);
    }),
  ];
}

export async function hasProLicense(
  workspaceFolder?: vscode.WorkspaceFolder,
): Promise<boolean> {
  const licensed = await (
    activeLicenseManager?.hasProLicense(workspaceFolder) ?? Promise.resolve(false)
  );
  await publishProLicenseContext(licensed);
  return licensed;
}

export async function showUpgradePrompt(
  workspaceFolder?: vscode.WorkspaceFolder,
  deps: Partial<ShowUpgradePromptDeps> = {},
): Promise<void> {
  const showInformationMessage = deps.showInformationMessage
    ?? activeUpgradeDeps?.showInformationMessage;
  const openExternal = deps.openExternal ?? activeUpgradeDeps?.openExternal;
  const parseUri = deps.parseUri ?? activeUpgradeDeps?.parseUri;
  if (!showInformationMessage) {
    return;
  }

  const selection = await showInformationMessage(
    'MWNN Kanban Pro is not activated yet. Enter your license key to unlock paid features, or get Pro.',
    PRO_ACTIVATE_PROMPT_LABEL,
    PRO_UPGRADE_PROMPT_LABEL,
  );

  if (selection === PRO_ACTIVATE_PROMPT_LABEL) {
    if (activeLicenseManager) {
      await activeLicenseManager.promptEnterKey(workspaceFolder);
      await hasProLicense(workspaceFolder);
      return;
    }

    await activeUpgradeDeps?.executeCommand(ENTER_PRO_LICENSE_KEY_COMMAND);
    return;
  }

  if (selection === PRO_UPGRADE_PROMPT_LABEL && openExternal && parseUri) {
    await openExternal(parseUri(deps.upgradeUrl ?? PRO_PURCHASE_URL));
  }
}
