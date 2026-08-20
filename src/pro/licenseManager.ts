import type * as vscode from 'vscode';

const DEFAULT_POLAR_API_BASE_URL = 'https://api.polar.sh';
const POLAR_VALIDATE_PATH = '/v1/customer-portal/license-keys/validate';
const SECRETS_KEY = 'mwnn-kanban-pro.licenseKey';
const CACHE_STATE_KEY = 'mwnn-kanban-pro.licenseCache';
const TRIAL_STATE_KEY = 'mwnn-kanban-pro.trialStartedAt';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;
// A stalled connection to Polar (dead network, silent firewall drop) must not
// hang every Pro command forever; fail the validation and fall through to the
// trial/cached path instead.
const LICENSE_VALIDATE_TIMEOUT_MS = 8_000;

interface LicenseCache {
  readonly valid: boolean;
  readonly expiresAt: number;
  readonly benefitId?: string;
}

export interface LicenseSecretStorage {
  readonly get: (key: string) => PromiseLike<string | undefined>;
  readonly store: (key: string, value: string) => PromiseLike<void>;
  readonly delete: (key: string) => PromiseLike<void>;
}

export interface LicenseGlobalState {
  readonly get: <T>(key: string) => T | undefined;
  readonly update: (key: string, value: unknown) => PromiseLike<void>;
}

export interface LicenseStorageContext {
  readonly secrets: LicenseSecretStorage;
  readonly globalState: LicenseGlobalState;
}

export interface ProLicenseConfiguration {
  readonly get: <T>(section: string, defaultValue: T) => T;
}

export interface ProLicenseManagerDeps {
  readonly context: LicenseStorageContext;
  readonly fetch?: typeof globalThis.fetch;
  readonly getConfiguration?: (
    workspaceFolder?: vscode.WorkspaceFolder,
  ) => ProLicenseConfiguration;
  readonly now?: () => number;
  readonly showInputBox?: (
    options: vscode.InputBoxOptions,
  ) => PromiseLike<string | undefined>;
  readonly showInformationMessage?: (message: string) => unknown;
  readonly showErrorMessage?: (message: string) => unknown;
}

export interface ProLicenseManager {
  readonly hasProLicense: (
    workspaceFolder?: vscode.WorkspaceFolder,
  ) => Promise<boolean>;
  readonly promptEnterKey: (
    workspaceFolder?: vscode.WorkspaceFolder,
  ) => Promise<boolean>;
  readonly clearKey: () => Promise<void>;
  readonly showLicenseStatus: (
    workspaceFolder?: vscode.WorkspaceFolder,
  ) => Promise<void>;
}

const EMPTY_CONFIGURATION: ProLicenseConfiguration = {
  get<T>(section: string, defaultValue: T): T {
    void section;
    return defaultValue;
  },
};

function isLicenseCache(value: unknown): value is LicenseCache {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.valid === 'boolean'
    && typeof record.expiresAt === 'number'
    && Number.isFinite(record.expiresAt)
    && (record.benefitId === undefined || typeof record.benefitId === 'string');
}

function isPolarLegacyValidResponse(value: unknown): value is { readonly valid: boolean } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as Record<string, unknown>).valid === 'boolean';
}

function isPolarValidatedLicenseKey(
  value: unknown,
): value is {
  readonly status: 'granted' | 'revoked' | 'disabled';
  readonly benefit_id?: unknown;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const status = (value as Record<string, unknown>).status;
  return status === 'granted' || status === 'revoked' || status === 'disabled';
}

export function createProLicenseManager(deps: ProLicenseManagerDeps): ProLicenseManager {
  const fetcher = deps.fetch ?? globalThis.fetch;
  const getConfiguration = deps.getConfiguration ?? (() => EMPTY_CONFIGURATION);
  const now = deps.now ?? Date.now;
  const showInputBox = deps.showInputBox ?? (async () => undefined);
  const showInformationMessage = deps.showInformationMessage ?? (() => undefined);
  const showErrorMessage = deps.showErrorMessage ?? (() => undefined);

  function getOrganizationId(workspaceFolder?: vscode.WorkspaceFolder): string {
    return getConfiguration(workspaceFolder)
      .get<string>('polar.organizationId', '')
      .trim();
  }

  function getBenefitId(workspaceFolder?: vscode.WorkspaceFolder): string {
    return getConfiguration(workspaceFolder)
      .get<string>('polar.benefitId', '')
      .trim();
  }

  function getPolarApiBaseUrl(workspaceFolder?: vscode.WorkspaceFolder): string {
    const configured = getConfiguration(workspaceFolder)
      .get<string>('polar.apiBaseUrl', DEFAULT_POLAR_API_BASE_URL)
      .trim();
    return configured ? configured.replace(/\/+$/, '') : DEFAULT_POLAR_API_BASE_URL;
  }

  function getValidateUrl(workspaceFolder?: vscode.WorkspaceFolder): string {
    return `${getPolarApiBaseUrl(workspaceFolder)}${POLAR_VALIDATE_PATH}`;
  }

  async function storeCache(valid: boolean, benefitId: string): Promise<void> {
    const cache: LicenseCache = {
      valid,
      expiresAt: now() + CACHE_TTL_MS,
      ...(benefitId ? { benefitId } : {}),
    };
    await deps.context.globalState.update(CACHE_STATE_KEY, cache);
  }

  async function validateLicenseKey(
    key: string,
    workspaceFolder?: vscode.WorkspaceFolder,
  ): Promise<boolean> {
    const organizationId = getOrganizationId(workspaceFolder);
    const benefitId = getBenefitId(workspaceFolder);
    if (!organizationId) {
      return false;
    }

    try {
      const response = await fetcher(getValidateUrl(workspaceFolder), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          organization_id: organizationId,
          ...(benefitId ? { benefit_id: benefitId } : {}),
        }),
        signal: AbortSignal.timeout(LICENSE_VALIDATE_TIMEOUT_MS),
      });

      if (!response.ok) {
        return false;
      }

      const data: unknown = await response.json();
      if (isPolarLegacyValidResponse(data)) {
        return benefitId ? false : data.valid;
      }

      return isPolarValidatedLicenseKey(data)
        && data.status === 'granted'
        && (!benefitId || data.benefit_id === benefitId);
    } catch {
      return false;
    }
  }

  function readFreshCachedValidity(
    workspaceFolder?: vscode.WorkspaceFolder,
  ): boolean | undefined {
    const cached: unknown = deps.context.globalState.get(CACHE_STATE_KEY);
    if (!isLicenseCache(cached) || cached.expiresAt <= now()) {
      return undefined;
    }

    if ((cached.benefitId ?? '') !== getBenefitId(workspaceFolder)) {
      return undefined;
    }

    return cached.valid;
  }

  async function hasActiveTrial(startIfMissing: boolean): Promise<boolean> {
    const checkedAt = now();
    const storedStartedAt: unknown = deps.context.globalState.get(TRIAL_STATE_KEY);
    let startedAt = typeof storedStartedAt === 'number'
      && Number.isFinite(storedStartedAt)
      ? storedStartedAt
      : undefined;

    if (startedAt === undefined) {
      if (!startIfMissing) {
        return false;
      }

      startedAt = checkedAt;
      await deps.context.globalState.update(TRIAL_STATE_KEY, startedAt);
    }

    return checkedAt < startedAt + TRIAL_DURATION_MS;
  }

  async function hasProLicense(
    workspaceFolder?: vscode.WorkspaceFolder,
  ): Promise<boolean> {
    const key = await deps.context.secrets.get(SECRETS_KEY);
    if (!key) {
      return hasActiveTrial(true);
    }

    const cached = readFreshCachedValidity(workspaceFolder);
    if (cached !== undefined) {
      return cached || await hasActiveTrial(false);
    }

    const valid = await validateLicenseKey(key, workspaceFolder);
    await storeCache(valid, getBenefitId(workspaceFolder));
    return valid || await hasActiveTrial(false);
  }

  async function promptEnterKey(
    workspaceFolder?: vscode.WorkspaceFolder,
  ): Promise<boolean> {
    const key = await showInputBox({
      title: 'MWNN Kanban Pro - Enter License Key',
      placeHolder: 'XXXX-XXXX-XXXX-XXXX',
      ignoreFocusOut: true,
      password: true,
    });
    if (!key) {
      return false;
    }

    await deps.context.secrets.store(SECRETS_KEY, key);
    const valid = await validateLicenseKey(key, workspaceFolder);
    await storeCache(valid, getBenefitId(workspaceFolder));

    if (valid) {
      void Promise.resolve(showInformationMessage('MWNN Kanban Pro license activated.'));
    } else if (!getOrganizationId(workspaceFolder)) {
      void Promise.resolve(showErrorMessage(
        'MWNN Kanban Pro licensing is not configured. Set mwnn-kanban-pro.polar.organizationId first.',
      ));
    } else {
      void Promise.resolve(showErrorMessage(
        'License key not recognized. Check your Polar account or sandbox settings.',
      ));
    }

    return valid;
  }

  async function clearKey(): Promise<void> {
    await deps.context.secrets.delete(SECRETS_KEY);
    await deps.context.globalState.update(CACHE_STATE_KEY, undefined);
  }

  async function showLicenseStatus(
    workspaceFolder?: vscode.WorkspaceFolder,
  ): Promise<void> {
    const valid = await hasProLicense(workspaceFolder);
    if (valid) {
      await Promise.resolve(showInformationMessage('MWNN Kanban Pro is active.'));
      return;
    }

    if (!getOrganizationId(workspaceFolder)) {
      await Promise.resolve(showInformationMessage(
        'MWNN Kanban Pro is not configured. Set mwnn-kanban-pro.polar.organizationId to enable license validation.',
      ));
      return;
    }

    await Promise.resolve(showInformationMessage(
      'MWNN Kanban Pro is not activated. Use "Enter Pro License Key" to activate.',
    ));
  }

  return {
    hasProLicense,
    promptEnterKey,
    clearKey,
    showLicenseStatus,
  };
}
