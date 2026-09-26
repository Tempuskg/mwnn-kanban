import { spawn, type ChildProcess } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectCreditExhaustion, redactSecrets, type CreditExhaustionSignal } from './agentCliCredit';
import {
  AGENT_CLI_ESCALATION_LADDER_SETTING,
  AGENT_CLI_MODELS_SETTING,
  AGENT_CLI_STAGE_MODELS_SETTING,
  EMPTY_AGENT_CLI_MODEL_CATALOG,
  EMPTY_AGENT_CLI_STAGE_MODELS,
  EMPTY_AGENT_CLI_STAGE_THINKING_LEVELS,
  EMPTY_AGENT_CLI_THINKING_LEVELS,
  agentCliModelSourceLabel,
  agentCliThinkingLevelSourceLabel,
  describeAgentCliModelSource,
  describeAgentCliThinkingLevelSource,
  resolveAgentCliModel,
  resolveAgentCliThinkingLevel,
  type AgentCliModelCatalog,
  type AgentCliModelSource,
  type AgentCliStageModels,
  type AgentCliStageThinkingLevels,
  type AgentCliThinkingLevelDefaults,
  type AgentCliThinkingLevelSource,
} from './agentCliModels';
import { AGENT_CLI_PROVIDER_IDS, type AgentCliProviderId } from './agentCliProviders';
import type { AgentCliHandoffKind } from './agentCliStages';
import { cardNeedsDefinition } from './cardDefinition';
import { parseVerificationVerdict } from './cardVerification';
import type { BoardState, Card } from './types';
import { cardPreferredModelFor, cardThinkingLevelFor } from './utils';

// The provider identity lives in its own module so the model catalog can depend
// on it without importing the spawn machinery; re-exported here so callers keep
// a single import site.
export { AGENT_CLI_PROVIDER_IDS, isAgentCliProviderId } from './agentCliProviders';
export type { AgentCliProviderId } from './agentCliProviders';
// Stage ids live beside the provider ids, for the same reason: the model
// settings reader keys on them and must not import the spawn machinery.
export { AGENT_CLI_HANDOFF_KINDS, isAgentCliHandoffKind } from './agentCliStages';
export type { AgentCliHandoffKind } from './agentCliStages';

export type AgentCliPathOverrides = Partial<Record<AgentCliProviderId, string>>;
export type AgentCliLauncher = 'standalone' | 'gh-copilot';

export const AGENT_CLI_LABELS: Record<AgentCliProviderId, string> = {
  copilot: 'GitHub Copilot CLI',
  codex: 'OpenAI Codex CLI',
  'claude-code': 'Anthropic Claude Code CLI',
  cursor: 'Cursor Agent CLI',
};

/**
 * How one provider names a model on its own command line. A provider that
 * offers no model selection simply omits `model`, and a card that names one is
 * then run on that CLI's default model instead of failing.
 */
interface AgentCliModelSpec {
  /** The CLI's own model flag, e.g. `--model`. */
  readonly flag: string;
  /**
   * Index in the provider's fixed `args` at which `[flag, model]` is spliced
   * in. Defaults to the end, which is wrong only for a CLI whose fixed argv
   * ends in a positional argument (Codex's stdin `-`).
   */
  readonly insertAt?: number;
}

/**
 * How one provider names a *thinking level* - its reasoning effort - on its own
 * command line, as data rather than as a branch per CLI.
 *
 * Two shapes cover every CLI seen so far, and both produce separate argv
 * entries: a plain flag taking the level as the next argument
 * (`--reasoning-effort high`), and a config-override flag taking one
 * `key=value` argument (`-c model_reasoning_effort=high`), which `valuePrefix`
 * selects. A provider that offers no effort selection at all simply omits
 * `thinking`, and a card that names a level is then run at that CLI's default
 * effort rather than failing.
 */
interface AgentCliThinkingSpec {
  /** The CLI's own flag, e.g. `-c` or `--reasoning-effort`. */
  readonly flag: string;
  /**
   * Prefix joined to the level to form the flag's single value argument, for a
   * CLI that spells effort as a config override rather than a dedicated flag.
   * Omitted for a plain `flag level` pair.
   */
  readonly valuePrefix?: string;
  /**
   * Index in the provider's fixed `args` at which the arguments are spliced in.
   * Defaults to the end, which is wrong only for a CLI whose fixed argv ends in
   * a positional argument (Codex's stdin `-`).
   */
  readonly insertAt?: number;
}

interface AgentCliProviderSpec {
  readonly defaultCommands: readonly string[];
  /** Fixed, single-line argv. The prompt itself always travels over stdin. */
  readonly args: readonly string[];
  readonly model?: AgentCliModelSpec;
  readonly thinking?: AgentCliThinkingSpec;
}

/**
 * Every provider receives the same existing MWNN hand-off prompt, delivered on
 * stdin rather than argv: npm installs these CLIs as .cmd shims on Windows,
 * which must be launched through cmd.exe, and cmd.exe ends its command line at
 * the first newline no matter how an argument is quoted — a multi-line prompt
 * argument is silently cut to its first line. Only this registry knows the
 * small CLI-specific differences; board-loop orchestration remains
 * provider-agnostic.
 *
 * Official non-interactive modes, each reading the piped prompt:
 * - Copilot: piped stdin runs programmatic mode; tools pre-approved and user
 *   questions disabled. No `-p` — Copilot ignores stdin when `-p` is passed.
 * - Codex: `exec -` reads instructions from stdin, with the workspace-write
 *   sandbox needed for card/code edits.
 * - Claude Code: print mode reads the piped prompt; non-interactive
 *   permission bypass.
 * - Cursor: print mode plus `--force` (file edits in headless mode). Do not
 *   put a dummy prompt on argv: Cursor treats that argument as the whole
 *   task and ignores piped stdin. The Windows `cursor-agent.cmd` shim
 *   relaunches through PowerShell and drops stdin, so the launcher unwraps
 *   to that install's `node.exe` + `index.js` when present. If unwrap is
 *   unavailable, the prompt is written to a temp file and a single-line
 *   `-p` pointer names that file (cmd.exe-safe).
 *
 * The model a dispatch runs on — the model the card names for this provider,
 * else the stage's rule from `agentCliStageModels`, else the active provider's
 * workspace default from `agentCliModels` — is turned into its model argument here
 * and nowhere else. The value is never validated against a list of model names
 * — each CLI owns its vocabulary and it changes faster than this extension
 * ships — and it is never interpolated into a command string: it is spliced in
 * as one further spawn argument, so spaces, quotes, and shell metacharacters
 * stay data. A card with no model, a stage with no rule, and a provider with no
 * configured workspace default produce exactly the argv below.
 *
 * The *thinking level* a dispatch runs at is resolved through the same layers
 * and spliced in the same way, from each provider's `thinking` spec. Only Codex
 * currently exposes reasoning effort on its command line, as the
 * `model_reasoning_effort` config override; Copilot, Claude Code, and Cursor
 * publish no such argument, so they carry no spec and a level resolved for them
 * is reported as not applied while the run proceeds on that CLI's own default
 * effort. Adding one later is a single entry here - nothing else changes.
 */
const PROVIDER_SPECS: Record<AgentCliProviderId, AgentCliProviderSpec> = {
  copilot: {
    defaultCommands: ['copilot'],
    args: ['--allow-all-tools', '--no-ask-user', '--silent'],
    model: { flag: '--model' },
  },
  codex: {
    defaultCommands: ['codex'],
    args: ['exec', '--sandbox', 'workspace-write', '-'],
    // After `exec`, and before the trailing `-` that names stdin as the prompt.
    model: { flag: '--model', insertAt: 1 },
    // Codex has no dedicated effort flag; the level is a config override, which
    // it takes as one `key=value` argument after `-c`.
    thinking: { flag: '-c', valuePrefix: 'model_reasoning_effort=', insertAt: 1 },
  },
  'claude-code': {
    defaultCommands: ['claude'],
    args: ['-p', '--permission-mode', 'bypassPermissions', '--output-format', 'text'],
    model: { flag: '--model' },
  },
  cursor: {
    defaultCommands: ['cursor-agent'],
    args: ['-p', '--force', '--output-format', 'text'],
    model: { flag: '--model' },
  },
};

/**
 * The model flag each provider accepts, or undefined for a provider that takes
 * no model selection. Exported as data so callers (and tests) can reason about
 * model support without reaching into the spawn logic.
 */
export const AGENT_CLI_MODEL_FLAGS: Readonly<Record<AgentCliProviderId, string | undefined>> =
  Object.freeze(
    Object.fromEntries(
      AGENT_CLI_PROVIDER_IDS.map((provider) => [provider, PROVIDER_SPECS[provider].model?.flag]),
    ) as Record<AgentCliProviderId, string | undefined>,
  );

/**
 * The thinking-level flag each provider accepts, or undefined for a provider
 * that takes no effort selection. Exported as data, like the model flags, so
 * callers and tests can reason about support without reaching into the spawn
 * logic - and so the "unsupported" path stays injectable.
 */
export const AGENT_CLI_THINKING_FLAGS: Readonly<Record<AgentCliProviderId, string | undefined>> =
  Object.freeze(
    Object.fromEntries(
      AGENT_CLI_PROVIDER_IDS.map((provider) => [provider, PROVIDER_SPECS[provider].thinking?.flag]),
    ) as Record<AgentCliProviderId, string | undefined>,
  );

/**
 * The outcome of turning a resolved model into CLI arguments for one provider.
 * `applied: false` is not a failure: the run continues on the provider's own
 * default model, and `reason` explains to the user why the requested model was
 * skipped so it never happens silently.
 */
export interface AgentCliModelSelection {
  /** The resolved value, exactly as it will reach the CLI. */
  readonly requested: string;
  /** Which layer supplied this model: the card, the stage rule, or the workspace. */
  readonly source: AgentCliModelSource;
  /** The stage this selection was resolved for, when one was in hand. */
  readonly stage?: AgentCliHandoffKind;
  readonly applied: boolean;
  /** `[flag, model]` when applied; empty otherwise. Always separate argv entries. */
  readonly args: readonly string[];
  readonly reason?: string;
}

export interface AgentCliModelResolutionOptions {
  /** Workspace model lists; defaults to "nothing configured". */
  readonly catalog?: AgentCliModelCatalog;
  /**
   * The AI-loop stage being dispatched. Omitting it skips the stage layer
   * entirely, which is what a caller with no stage in hand wants.
   */
  readonly stage?: AgentCliHandoffKind;
  /** Per-stage model rules; defaults to "no rules configured". */
  readonly stageModels?: AgentCliStageModels;
  /**
   * A model the AI loop's escalation ladder picked for this retry. Supersedes
   * every configured layer, because it exists to replace a model an attempt
   * already failed on.
   */
  readonly escalatedModel?: string;
  /**
   * Injectable so the "provider takes no model selection" path is exercisable
   * without waiting for a CLI to drop its `--model` support.
   */
  readonly flags?: Readonly<Record<AgentCliProviderId, string | undefined>>;
}

/**
 * Turn the resolved model for one card on one provider at one stage into that
 * provider's CLI arguments. The resolution order itself lives in
 * `agentCliModels`; this only shapes the result for the command line. Returns
 * undefined when no layer names a usable model, which is what keeps an
 * unconfigured dispatch producing byte-identical arguments to the behavior
 * before per-card, per-stage, and workspace models existed.
 */
export function resolveAgentCliModelSelection(
  provider: AgentCliProviderId,
  preferredModel: string | undefined,
  options: AgentCliModelResolutionOptions = {},
): AgentCliModelSelection | undefined {
  const stage = options.stage;
  const resolved = resolveAgentCliModel(
    provider,
    preferredModel,
    options.catalog ?? EMPTY_AGENT_CLI_MODEL_CATALOG,
    stage !== undefined
      ? { stage, stageModels: options.stageModels ?? EMPTY_AGENT_CLI_STAGE_MODELS }
      : undefined,
    options.escalatedModel,
  );
  if (resolved === undefined) {
    return undefined;
  }

  const requested = resolved.model;
  const source = resolved.source;
  // Carried on every selection, not just stage-sourced ones, so a failure
  // message can always say which stage the run belonged to.
  const stageField = stage !== undefined ? { stage } : {};
  const flag = (options.flags ?? AGENT_CLI_MODEL_FLAGS)[provider];
  if (flag === undefined) {
    return {
      requested,
      source,
      ...stageField,
      applied: false,
      args: [],
      reason: `${AGENT_CLI_LABELS[provider]} does not accept a model selection, so ${describeAgentCliModelSource(source)}${describeStageSuffix(source, stage)} "${requested}" was not applied and the run used that CLI's default model.`,
    };
  }
  return { requested, source, ...stageField, applied: true, args: [flag, requested] };
}

/**
 * The outcome of turning a resolved thinking level into CLI arguments for one
 * provider. `applied: false` is not a failure: the run continues at the
 * provider's own default effort, and `reason` explains why the level was
 * skipped so it never happens silently. A level that cannot be applied must
 * never be the reason a dispatch does not happen.
 */
export interface AgentCliThinkingSelection {
  /** The resolved level, exactly as it will reach the CLI. */
  readonly requested: string;
  /** Which layer supplied this level: card, stage rule, workspace, escalation. */
  readonly source: AgentCliThinkingLevelSource;
  /** The stage this selection was resolved for, when one was in hand. */
  readonly stage?: AgentCliHandoffKind;
  readonly applied: boolean;
  /** The provider's own argv entries when applied; empty otherwise. */
  readonly args: readonly string[];
  readonly reason?: string;
}

export interface AgentCliThinkingResolutionOptions {
  /** Per-provider workspace defaults; defaults to "nothing configured". */
  readonly thinkingLevels?: AgentCliThinkingLevelDefaults;
  /**
   * The AI-loop stage being dispatched. Omitting it skips the stage layer
   * entirely, which is what a caller with no stage in hand wants.
   */
  readonly stage?: AgentCliHandoffKind;
  /** Per-stage level rules; defaults to "no rules configured". */
  readonly stageThinkingLevels?: AgentCliStageThinkingLevels;
  /**
   * A level the AI loop's escalation ladder picked for this retry. Supersedes
   * every configured layer, for the same reason an escalated model does.
   */
  readonly escalatedThinkingLevel?: string;
  /**
   * Injectable so the "provider takes no effort selection" path is exercisable
   * for any provider, including one that currently has a spec.
   */
  readonly flags?: Readonly<Record<AgentCliProviderId, string | undefined>>;
}

/**
 * Turn the resolved thinking level for one card on one provider at one stage
 * into that provider's CLI arguments. The resolution order lives in
 * `agentCliModels`; this only shapes the result for the command line. Returns
 * undefined when no layer names a level, which is what keeps an unconfigured
 * dispatch producing byte-identical arguments to the behavior before the effort
 * axis existed.
 */
export function resolveAgentCliThinkingSelection(
  provider: AgentCliProviderId,
  cardThinkingLevel: string | undefined,
  options: AgentCliThinkingResolutionOptions = {},
): AgentCliThinkingSelection | undefined {
  const stage = options.stage;
  const resolved = resolveAgentCliThinkingLevel(
    provider,
    cardThinkingLevel,
    options.thinkingLevels ?? EMPTY_AGENT_CLI_THINKING_LEVELS,
    stage !== undefined
      ? {
          stage,
          stageThinkingLevels:
            options.stageThinkingLevels ?? EMPTY_AGENT_CLI_STAGE_THINKING_LEVELS,
        }
      : undefined,
    options.escalatedThinkingLevel,
  );
  if (resolved === undefined) {
    return undefined;
  }

  const requested = resolved.level;
  const source = resolved.source;
  // Carried on every selection, not just stage-sourced ones, so a message can
  // always say which stage the run belonged to.
  const stageField = stage !== undefined ? { stage } : {};
  const flag = (options.flags ?? AGENT_CLI_THINKING_FLAGS)[provider];
  if (flag === undefined) {
    return {
      requested,
      source,
      ...stageField,
      applied: false,
      reason: `${AGENT_CLI_LABELS[provider]} does not accept a thinking level, so ${describeAgentCliThinkingLevelSource(source)}${describeStageSuffix(source, stage)} "${requested}" was not applied and the run used that CLI's default thinking level.`,
      args: [],
    };
  }
  const spec = PROVIDER_SPECS[provider].thinking;
  // One value argument either way, so a level containing a space or a shell
  // metacharacter can never become a second argument or a command.
  const value = spec?.valuePrefix !== undefined ? `${spec.valuePrefix}${requested}` : requested;
  return { requested, source, ...stageField, applied: true, args: [flag, value] };
}

/**
 * ` for the definition stage`, but only for a stage-sourced model: naming the
 * stage is what points the user at the right key in the settings object, and it
 * would be noise on a card or workspace model that applies to every stage.
 */
function describeStageSuffix(
  source: AgentCliModelSource,
  stage: AgentCliHandoffKind | undefined,
): string {
  // An escalation model is chosen for one retry of one stage, so naming the
  // stage points at the attempt that triggered it, exactly as it points a
  // stage rule at the key to edit.
  return (source === 'stage-rule' || source === 'escalation') && stage !== undefined
    ? ` for the ${stage} stage`
    : '';
}

/**
 * The provider's fixed argv with the resolved model and thinking-level
 * arguments spliced in. Every resolved value stays exactly one argument, so a
 * name or level containing spaces, quotes, or shell metacharacters can never
 * become a second argument or a command.
 *
 * Both axes can target the same index (Codex splices both after `exec`), so the
 * insertions are applied from the highest index down and, at a tie, the model
 * lands before the level. That makes the argv a pure function of the two
 * selections rather than of the order this function happens to handle them in.
 */
function providerArgs(
  provider: AgentCliProviderId,
  selection: AgentCliModelSelection | undefined,
  thinkingSelection?: AgentCliThinkingSelection,
): string[] {
  const spec = PROVIDER_SPECS[provider];
  const args = [...spec.args];
  const clamp = (index: number | undefined): number =>
    Math.min(Math.max(index ?? args.length, 0), args.length);

  const insertions: { readonly index: number; readonly order: number; readonly args: readonly string[] }[] = [];
  if (selection?.applied && selection.args.length > 0) {
    insertions.push({ index: clamp(spec.model?.insertAt), order: 0, args: selection.args });
  }
  if (thinkingSelection?.applied && thinkingSelection.args.length > 0) {
    insertions.push({ index: clamp(spec.thinking?.insertAt), order: 1, args: thinkingSelection.args });
  }

  // Descending index so an earlier splice never shifts a later one's target;
  // descending `order` at a tie so the model ends up first once both are in.
  insertions.sort((left, right) => right.index - left.index || right.order - left.order);
  for (const insertion of insertions) {
    args.splice(insertion.index, 0, ...insertion.args);
  }
  return args;
}

export interface AgentCliTarget {
  readonly provider: AgentCliProviderId;
  readonly label: string;
  /** Resolved executable or script path. Kept separate from arguments. */
  readonly executable: string;
  /** Whether the executable is the agent itself or GitHub CLI's Copilot passthrough. */
  readonly launcher: AgentCliLauncher;
}

export interface AgentCliResolutionFailure {
  readonly available: false;
  readonly provider: AgentCliProviderId;
  readonly attemptedCommand: string;
  readonly reason: string;
}

export type AgentCliResolution =
  | { readonly available: true; readonly target: AgentCliTarget }
  | AgentCliResolutionFailure;

export interface ExecutableDiscoveryOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly canExecute?: (candidate: string, platform: NodeJS.Platform) => Promise<boolean>;
  readonly probeGhCopilot?: (executable: string, cwd: string) => Promise<GhCopilotProbeResult>;
}

export interface GhCopilotProbeResult {
  readonly supported: boolean;
  readonly reason?: string;
}

/**
 * Resolve a selected provider before a card is moved or dispatched. A
 * configured value is an executable path/name only (never a shell command), so
 * paths containing spaces remain one safe spawn argument.
 */
export async function resolveAgentCliTarget(
  provider: AgentCliProviderId,
  configuredPaths: AgentCliPathOverrides = {},
  options: ExecutableDiscoveryOptions = {},
): Promise<AgentCliResolution> {
  const configured = normalizeConfiguredPath(configuredPaths[provider]);
  if (provider === 'copilot') {
    return resolveCopilotCliTarget(configured, options);
  }

  const commands = configured ? [configured] : PROVIDER_SPECS[provider].defaultCommands;
  for (const command of commands) {
    const executable = await findExecutable(command, options);
    if (executable) {
      return {
        available: true,
        target: {
          provider,
          label: AGENT_CLI_LABELS[provider],
          executable,
          launcher: 'standalone',
        },
      };
    }
  }

  const attemptedCommand = commands[0] ?? provider;
  const setting = `mwnn-kanban.agentCliPaths["${provider}"]`;
  const source = configured ? `configured path "${attemptedCommand}"` : `command "${attemptedCommand}" on PATH`;
  return {
    available: false,
    provider,
    attemptedCommand,
    reason: `${AGENT_CLI_LABELS[provider]} is selected, but its ${source} was not found or is not executable. Install the CLI or set ${setting} to its full executable path; paths containing spaces are supported.`,
  };
}

async function resolveCopilotCliTarget(
  configured: string | undefined,
  options: ExecutableDiscoveryOptions,
): Promise<AgentCliResolution> {
  if (configured) {
    const executable = await findExecutable(configured, options);
    if (!executable) {
      return copilotResolutionFailure(
        configured,
        `its configured path "${configured}" was not found or is not executable`,
      );
    }
    if (isGitHubCliExecutable(executable, options.platform ?? process.platform)) {
      return resolveGhCopilotTarget(executable, configured, true, options);
    }
    return {
      available: true,
      target: {
        provider: 'copilot',
        label: AGENT_CLI_LABELS.copilot,
        executable,
        launcher: 'standalone',
      },
    };
  }

  const standalone = await findExecutable('copilot', options);
  if (standalone) {
    return {
      available: true,
      target: {
        provider: 'copilot',
        label: AGENT_CLI_LABELS.copilot,
        executable: standalone,
        launcher: 'standalone',
      },
    };
  }

  const gh = await findExecutable('gh', options);
  if (!gh) {
    return copilotResolutionFailure(
      'copilot, gh',
      'neither standalone command "copilot" nor GitHub CLI command "gh" was found on PATH',
    );
  }
  return resolveGhCopilotTarget(gh, 'gh', false, options);
}

async function resolveGhCopilotTarget(
  executable: string,
  attemptedCommand: string,
  configured: boolean,
  options: ExecutableDiscoveryOptions,
): Promise<AgentCliResolution> {
  const cwd = options.cwd ?? process.cwd();
  const probe = options.probeGhCopilot ?? defaultProbeGhCopilot;
  let support: GhCopilotProbeResult;
  try {
    support = await probe(executable, cwd);
  } catch (error: unknown) {
    support = {
      supported: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (support.supported) {
    return {
      available: true,
      target: {
        provider: 'copilot',
        label: AGENT_CLI_LABELS.copilot,
        executable,
        launcher: 'gh-copilot',
      },
    };
  }

  const source = configured
    ? `the configured GitHub CLI path "${attemptedCommand}"`
    : `GitHub CLI at "${executable}"`;
  const detail = support.reason?.trim()
    ? ` ${support.reason.trim()}`
    : '';
  return copilotResolutionFailure(
    attemptedCommand,
    `${source} does not provide the modern built-in \`gh copilot\` passthrough.${detail}`,
  );
}

function copilotResolutionFailure(
  attemptedCommand: string,
  problem: string,
): AgentCliResolutionFailure {
  const normalizedProblem = problem.trim().replace(/\.+$/, '');
  return {
    available: false,
    provider: 'copilot',
    attemptedCommand,
    reason: `${AGENT_CLI_LABELS.copilot} is selected, but ${normalizedProblem}. Install the standalone Copilot CLI or update GitHub CLI to a version with the modern \`gh copilot\` passthrough, then rerun; the retired \`github/gh-copilot\` suggestion/explanation extension is not supported. The mwnn-kanban.agentCliPaths["copilot"] setting can point to either executable; paths containing spaces are supported.`,
  };
}

function isGitHubCliExecutable(executable: string, platform: NodeJS.Platform): boolean {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const basename = pathApi.basename(executable).toLowerCase();
  return basename.replace(/\.(?:com|exe|bat|cmd)$/i, '') === 'gh';
}

/**
 * Probe GitHub CLI's own help instead of invoking the nested Copilot binary.
 * The modern built-in command describes itself as the GitHub Copilot CLI;
 * the retired `github/gh-copilot` extension exposes suggest/explain help and
 * therefore cannot satisfy this capability check.
 */
async function defaultProbeGhCopilot(
  executable: string,
  cwd: string,
): Promise<GhCopilotProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const result = await runAgentCliProcess(
      {
        provider: 'copilot',
        label: 'GitHub CLI Copilot capability check',
        command: executable,
        args: ['copilot', '--help'],
        stdin: '',
        cwd,
      },
      controller.signal,
    );
    if (result.cancelled) {
      return { supported: false, reason: 'The capability check timed out.' };
    }
    if (!result.started) {
      return {
        supported: false,
        reason: `The capability check could not start: ${result.error?.trim() || 'the operating system rejected the process start'}.`,
      };
    }
    if (result.exitCode !== 0 || result.error) {
      const output = conciseProcessOutput(result.stderr || result.stdout);
      return {
        supported: false,
        reason: `The capability check failed${output ? `: ${output}` : ''}.`,
      };
    }
    const help = `${result.stdout}\n${result.stderr}`;
    if (!/\bRuns? the GitHub Copilot CLI\b/i.test(help)) {
      return {
        supported: false,
        reason: 'Its Copilot help is not the modern agentic passthrough; update GitHub CLI.',
      };
    }
    return { supported: true };
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveAllAgentCliTargets(
  configuredPaths: AgentCliPathOverrides = {},
  options: ExecutableDiscoveryOptions = {},
): Promise<readonly AgentCliResolution[]> {
  return Promise.all(
    AGENT_CLI_PROVIDER_IDS.map((provider) => resolveAgentCliTarget(provider, configuredPaths, options)),
  );
}

function normalizeConfiguredPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function findExecutable(
  command: string,
  options: ExecutableDiscoveryOptions,
): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const canExecute = options.canExecute ?? defaultCanExecute;

  const candidates = executableCandidates(command, cwd, env, platform);
  for (const candidate of candidates) {
    if (await canExecute(candidate, platform)) {
      return candidate;
    }
  }
  return undefined;
}

function executableCandidates(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const hasPath = pathApi.isAbsolute(command) || command.includes('/') || command.includes('\\');
  const bases = hasPath
    ? [pathApi.isAbsolute(command) ? command : pathApi.resolve(cwd, command)]
    : pathEntries(env, platform, cwd).map((entry) => pathApi.join(entry, command));
  const extensions = platform === 'win32' ? windowsExecutableExtensions(command, env) : [''];
  const candidates: string[] = [];
  for (const base of bases) {
    for (const extension of extensions) {
      const candidate = `${base}${extension}`;
      if (!candidates.some((existing) => existing.toLowerCase() === candidate.toLowerCase())) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function pathEntries(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  cwd: string,
): string[] {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  const rawPath = pathKey ? env[pathKey] : undefined;
  return (rawPath ?? '')
    .split(pathApi.delimiter)
    .map((entry) => normalizeConfiguredPath(entry))
    .filter((entry): entry is string => entry !== undefined)
    .map((entry) => (pathApi.isAbsolute(entry) ? entry : pathApi.resolve(cwd, entry)))
    .filter((entry, index, entries) =>
      entries.findIndex((candidate) =>
        platform === 'win32'
          ? candidate.toLowerCase() === entry.toLowerCase()
          : candidate === entry,
      ) === index);
}

function windowsExecutableExtensions(command: string, env: NodeJS.ProcessEnv): string[] {
  if (path.win32.extname(command)) {
    return [''];
  }
  const pathExtKey = Object.keys(env).find((key) => key.toLowerCase() === 'pathext');
  const pathExt = pathExtKey ? env[pathExtKey] : undefined;
  const configured = (pathExt ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim())
    .filter((extension) => extension.length > 0)
    .map((extension) => extension.startsWith('.') ? extension : `.${extension}`);
  // Windows command lookup follows PATHEXT. npm also writes extensionless
  // POSIX shims beside its runnable .cmd files; accepting the bare file would
  // discover it successfully and then fail at CreateProcess time.
  return configured;
}

async function defaultCanExecute(candidate: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) {
      return false;
    }
    await fs.access(candidate, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface AgentCliInvocation {
  readonly provider: AgentCliProviderId;
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  /** Hand-off prompt, written to the process's stdin; argv stays single-line. */
  readonly stdin: string;
  readonly cwd: string;
  /** Present only when some layer named a model; describes how it was handled. */
  readonly modelSelection?: AgentCliModelSelection;
  /** Present only when some layer named a thinking level; likewise. */
  readonly thinkingSelection?: AgentCliThinkingSelection;
}

export function buildAgentCliInvocation(
  target: AgentCliTarget,
  prompt: string,
  cwd: string,
  modelSelection?: AgentCliModelSelection,
  thinkingSelection?: AgentCliThinkingSelection,
): AgentCliInvocation {
  const args = providerArgs(target.provider, modelSelection, thinkingSelection);
  const invocation: AgentCliInvocation = {
    provider: target.provider,
    label: target.label,
    command: target.executable,
    args: target.launcher === 'gh-copilot' ? ['copilot', '--', ...args] : args,
    stdin: prompt,
    cwd,
  };
  return {
    ...invocation,
    ...(modelSelection ? { modelSelection } : {}),
    ...(thinkingSelection ? { thinkingSelection } : {}),
  };
}

export interface PreparedAgentCliInvocation {
  readonly invocation: AgentCliInvocation;
  readonly cleanup?: () => Promise<void>;
}

export interface PrepareAgentCliInvocationOptions {
  readonly platform?: NodeJS.Platform;
  /** Already-resolved model selection; omitted when no layer named one. */
  readonly modelSelection?: AgentCliModelSelection;
  /** Already-resolved thinking level; omitted when no layer named one. */
  readonly thinkingSelection?: AgentCliThinkingSelection;
}

/**
 * Cursor's Windows `.cmd` shim relaunches through PowerShell and does not
 * forward piped stdin to `node.exe`. Unwrap to the versioned Node entrypoint
 * when that layout is present; otherwise point `-p` at a temp prompt file.
 */
export async function prepareAgentCliInvocation(
  target: AgentCliTarget,
  prompt: string,
  cwd: string,
  options: PrepareAgentCliInvocationOptions = {},
): Promise<PreparedAgentCliInvocation> {
  const invocation = buildAgentCliInvocation(
    target,
    prompt,
    cwd,
    options.modelSelection,
    options.thinkingSelection,
  );
  if (target.provider !== 'cursor') {
    return { invocation };
  }

  const cursorArgs = providerArgs('cursor', options.modelSelection, options.thinkingSelection);
  const platform = options.platform ?? process.platform;
  const unwrapped = await resolveCursorWindowsLaunch(target.executable, platform);
  if (unwrapped) {
    return {
      invocation: {
        ...invocation,
        command: unwrapped.command,
        args: [unwrapped.script, ...cursorArgs],
      },
    };
  }

  if (platform === 'win32' && /\.(?:cmd|bat|ps1)$/i.test(target.executable)) {
    const pointer = await writeCursorPromptPointer(prompt);
    return {
      invocation: {
        ...invocation,
        // The pointer is Cursor's positional prompt and must stay last.
        args: [...cursorArgs, pointer.pointer],
      },
      cleanup: pointer.cleanup,
    };
  }

  return { invocation };
}

const CURSOR_VERSION_DIR = /^\d{4}\.\d{1,2}\.\d{1,2}(?:-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/i;

export async function resolveCursorWindowsLaunch(
  executable: string,
  platform: NodeJS.Platform = process.platform,
): Promise<{ readonly command: string; readonly script: string } | undefined> {
  if (platform !== 'win32') {
    return undefined;
  }
  const pathApi = path.win32;
  const versionsRoot = pathApi.join(pathApi.dirname(executable), 'versions');
  let names: string[];
  try {
    names = await fs.readdir(versionsRoot);
  } catch {
    return undefined;
  }

  const ranked = names
    .filter((name) => CURSOR_VERSION_DIR.test(name))
    .sort((left, right) => {
      const rank = cursorVersionRank(right) - cursorVersionRank(left);
      return rank !== 0 ? rank : right.localeCompare(left);
    });
  for (const name of ranked) {
    const command = pathApi.join(versionsRoot, name, 'node.exe');
    const script = pathApi.join(versionsRoot, name, 'index.js');
    if (await isRegularFile(command) && await isRegularFile(script)) {
      return { command, script };
    }
  }
  return undefined;
}

function cursorVersionRank(name: string): number {
  const datePart = name.split('-')[0];
  const parts = datePart?.split('.') ?? [];
  if (parts.length !== 3) {
    return 0;
  }
  const year = parts[0] ?? '';
  const month = (parts[1] ?? '').padStart(2, '0');
  const day = (parts[2] ?? '').padStart(2, '0');
  const rank = Number(`${year}${month}${day}`);
  return Number.isFinite(rank) ? rank : 0;
}

async function isRegularFile(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function writeCursorPromptPointer(prompt: string): Promise<{
  readonly pointer: string;
  readonly cleanup: () => Promise<void>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-cursor-handoff-'));
  const file = path.join(dir, 'handoff.txt');
  try {
    await fs.writeFile(file, prompt, { encoding: 'utf8', mode: 0o600 });
  } catch (error: unknown) {
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    pointer: `Read the UTF-8 file at ${file} first and carry out those complete hand-off instructions. That file is the full prompt.`,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

export interface AgentCliProcessResult {
  readonly started: boolean;
  readonly cancelled: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}

/**
 * Live view of one CLI process for user-facing feedback surfaces (output
 * channel, progress text, board UI). Purely observational: callbacks must not
 * influence the run, and omitting the observer changes nothing.
 */
export interface AgentCliProcessObserver {
  readonly onStart?: (invocation: AgentCliInvocation) => void;
  readonly onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
  readonly onExit?: (result: AgentCliProcessResult) => void;
}

export type AgentCliProcessRunner = (
  invocation: AgentCliInvocation,
  signal: AbortSignal,
  observer?: AgentCliProcessObserver,
) => Promise<AgentCliProcessResult>;

const MAX_CAPTURED_OUTPUT = 64 * 1024;

/**
 * Launch a provider without a shell, except for Windows .cmd/.bat shims. The
 * prompt is piped to the child's stdin so it survives cmd.exe verbatim.
 */
export async function runAgentCliProcess(
  invocation: AgentCliInvocation,
  signal: AbortSignal,
  observer: AgentCliProcessObserver = {},
): Promise<AgentCliProcessResult> {
  if (signal.aborted) {
    return emptyProcessResult(false, true);
  }

  return new Promise((resolve) => {
    let settled = false;
    let started = false;
    let stdout = '';
    let stderr = '';
    let child: ChildProcess | undefined;
    let forceCancellationTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: AgentCliProcessResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (forceCancellationTimer !== undefined) {
        clearTimeout(forceCancellationTimer);
      }
      signal.removeEventListener('abort', cancel);
      observer.onExit?.(result);
      resolve(result);
    };

    const cancel = (): void => {
      if (!child) {
        finish(emptyProcessResult(started, true));
        return;
      }
      terminateProcess(child);
      forceCancellationTimer = setTimeout(() => {
        if (child && !settled) {
          child.kill('SIGKILL');
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref();
          finish({
            started,
            cancelled: true,
            exitCode: child.exitCode,
            signal: child.signalCode,
            stdout,
            stderr,
          });
        }
      }, 1_000);
    };

    observer.onStart?.(invocation);
    try {
      const launch = process.platform === 'win32'
        ? windowsLaunchCommand(invocation.command, invocation.args)
        : {
            command: invocation.command,
            args: [...invocation.args],
            windowsVerbatimArguments: false,
          };
      child = spawn(launch.command, launch.args, {
        cwd: invocation.cwd,
        windowsHide: true,
        detached: process.platform !== 'win32',
        shell: false,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      finish({ ...emptyProcessResult(false, false), error: message });
      return;
    }

    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
    }

    child.once('spawn', () => {
      started = true;
    });
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout = captureTail(stdout, chunk);
      observer.onOutput?.(chunk.toString(), 'stdout');
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = captureTail(stderr, chunk);
      observer.onOutput?.(chunk.toString(), 'stderr');
    });
    child.once('error', (error: Error) => {
      if (signal.aborted) {
        finish({
          started,
          cancelled: true,
          exitCode: null,
          signal: null,
          stdout,
          stderr,
        });
        return;
      }
      finish({
        started,
        cancelled: false,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        error: error.message,
      });
    });
    child.once('exit', (exitCode, exitSignal) => {
      finish({
        started,
        cancelled: signal.aborted,
        exitCode,
        signal: exitSignal,
        stdout,
        stderr,
      });
    });
    child.stdin?.on('error', () => {
      // A CLI that exits before draining its stdin raises EPIPE here; the
      // exit handler reports the real outcome.
    });
    child.stdin?.end(invocation.stdin);
  });
}

function emptyProcessResult(started: boolean, cancelled: boolean): AgentCliProcessResult {
  return {
    started,
    cancelled,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
  };
}

function captureTail(current: string, chunk: Buffer | string): string {
  const combined = `${current}${chunk.toString()}`;
  return combined.length <= MAX_CAPTURED_OUTPUT
    ? combined
    : combined.slice(combined.length - MAX_CAPTURED_OUTPUT);
}

function windowsLaunchCommand(
  command: string,
  args: readonly string[],
): {
  readonly command: string;
  readonly args: string[];
  readonly windowsVerbatimArguments: boolean;
} {
  if (!/\.(?:cmd|bat)$/i.test(command)) {
    return { command, args: [...args], windowsVerbatimArguments: false };
  }

  // cmd.exe ends its command line at the first newline regardless of quoting;
  // everything after it would be silently dropped. Multi-line text (the
  // hand-off prompt) must travel over stdin instead of argv.
  const unsafe = [command, ...args].find((part) => /[\r\n]/.test(part));
  if (unsafe !== undefined) {
    throw new Error(
      'A cmd.exe shim argument contains a newline, which cmd.exe would silently truncate; pass multi-line text via stdin instead.',
    );
  }

  const commandLine = [command, ...args].map(quoteWindowsCommandArgument).join(' ');
  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    // With /s, cmd.exe expects one outer quote pair around a command whose
    // executable path is itself quoted. Verbatim arguments prevent Node from
    // translating those inner quotes to literal backslash-quote sequences.
    args: ['/d', '/s', '/v:off', '/c', `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

/**
 * Quote one argument for cmd.exe. Percent expansion is neutralized as well as
 * cmd metacharacters; paths and flags remain data even when an npm .cmd shim
 * is the discovered executable. Newlines cannot be quoted for cmd.exe at all —
 * windowsLaunchCommand rejects them before this runs.
 */
function quoteWindowsCommandArgument(value: string): string {
  const escaped = value
    .replace(/%/g, '%%')
    .replace(/"/g, '\\"')
    .replace(/([&|<>^])/g, '^$1');
  return `"${escaped}"`;
}

function terminateProcess(child: ChildProcess): void {
  const pid = child.pid;
  if (process.platform === 'win32' && pid !== undefined) {
    const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.once('error', () => {
      child.kill();
    });
    killer.once('exit', () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    });
    return;
  }

  if (pid !== undefined) {
    try {
      process.kill(-pid, 'SIGTERM');
      return;
    } catch {
      // Fall back to the direct child when process groups are unavailable.
    }
  }
  child.kill('SIGTERM');
}

export interface AgentCliHandoffStore {
  reload(): Promise<BoardState>;
  appendActivity(cardId: string, entry: string): Promise<unknown>;
}

export interface AgentCliCardHandoff {
  readonly kind: AgentCliHandoffKind;
  readonly target: AgentCliTarget;
  readonly cardId: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly store: AgentCliHandoffStore;
  readonly signal: AbortSignal;
  /**
   * Workspace model lists, already validated. Omitted means "nothing
   * configured", so the card's own model is the only one that can apply.
   */
  readonly modelCatalog?: AgentCliModelCatalog;
  /**
   * Per-stage model rules, already validated. Resolved against this handoff's
   * own `kind`, so each stage of one loop run can run on its own model.
   */
  readonly stageModels?: AgentCliStageModels;
  /**
   * A model the AI loop's escalation ladder picked for this retry, replacing
   * the one the previous attempt failed on. Supersedes every configured layer
   * for this dispatch only; nothing is written back to the card or settings.
   */
  readonly escalatedModel?: string;
  /**
   * Per-provider workspace default thinking levels, already validated. Omitted
   * means "nothing configured", so the card's own level is the only one that
   * can apply.
   */
  readonly thinkingLevels?: AgentCliThinkingLevelDefaults;
  /**
   * Per-stage thinking-level rules, already validated. Resolved against this
   * handoff's own `kind`, so each stage of one loop run can think as hard as
   * that stage warrants.
   */
  readonly stageThinkingLevels?: AgentCliStageThinkingLevels;
  /**
   * A thinking level the AI loop's escalation ladder picked for this retry.
   * Supersedes every configured layer for this dispatch only. The shipped
   * ladder configures model names only, so nothing supplies this yet; the
   * parameter exists so the escalation layer of the resolution order is real
   * rather than notional the day the ladder format grows one.
   */
  readonly escalatedThinkingLevel?: string;
}

/**
 * Why one hand-off did not complete, as a value rather than as prose.
 *
 * The `reason` string is written for the user and is free to change; policy
 * that has to tell these cases apart - the loop's model escalation, which
 * retries only an inconclusive attempt and never an authentication, network,
 * or model-name failure - keys on this instead of matching that prose.
 *
 * - `card-missing`: the card was deleted around the dispatch.
 * - `model-rejected`: the CLI refused the model name it was given.
 * - `credit-exhausted`: the CLI's credits or usage allowance are spent.
 * - `process-failed`: the CLI failed to start, errored, or exited nonzero -
 *   authentication and network failures both land here.
 * - `missing-evidence`: the CLI exited cleanly but the card file does not carry
 *   this stage's required completion evidence.
 */
export type AgentCliHandoffFailure =
  | 'card-missing'
  | 'model-rejected'
  | 'credit-exhausted'
  | 'process-failed'
  | 'missing-evidence';

export interface AgentCliCardHandoffResult {
  readonly completed: boolean;
  readonly cancelled: boolean;
  /** Activity length after the loop's start entry and before the agent ran. */
  readonly activityBaseline: number;
  readonly reason?: string;
  /** Set exactly when the hand-off failed for a classified reason. */
  readonly failure?: AgentCliHandoffFailure;
  readonly terminalStatus?: TerminalCardStatus;
  /**
   * Set when the CLI failed because its credits or usage/session allowance are
   * spent. Only this failure is eligible for the loop's CLI fallback; every
   * other failure keeps the existing single-CLI behavior.
   */
  readonly creditExhaustion?: CreditExhaustionSignal;
  /**
   * How the resolved model — the model the card names for this provider, else
   * this stage's rule, else the provider's workspace default — was handled for this
   * dispatch. Absent when none named one. Callers surface `applied: false` so a
   * model that could not be honored is never dropped silently.
   */
  readonly modelSelection?: AgentCliModelSelection;
  /**
   * How the resolved thinking level was handled for this dispatch. Absent when
   * no layer named one. Callers surface `applied: false` so a level that could
   * not be honored is never dropped silently - it is reported, and the run
   * proceeds at the CLI's own default effort.
   */
  readonly thinkingSelection?: AgentCliThinkingSelection;
}

export interface AgentCliCardHandoffOptions {
  readonly runProcess?: AgentCliProcessRunner;
  readonly now?: () => Date;
  /** Forwarded to the process runner so callers can surface live CLI output. */
  readonly observer?: AgentCliProcessObserver;
  readonly platform?: NodeJS.Platform;
}

/**
 * Run one synchronous CLI hand-off and accept it only when both the process and
 * card-file evidence are valid. The board loop receives the same success/fail
 * contract for every provider.
 */
export async function runAgentCliCardHandoff(
  handoff: AgentCliCardHandoff,
  options: AgentCliCardHandoffOptions = {},
): Promise<AgentCliCardHandoffResult> {
  const runProcess = options.runProcess ?? runAgentCliProcess;
  const now = options.now ?? (() => new Date());
  const before = findCard(await handoff.store.reload(), handoff.cardId);
  if (!before) {
    return {
      completed: false,
      cancelled: false,
      activityBaseline: 0,
      failure: 'card-missing',
      reason: `Card ${handoff.cardId} no longer exists, so ${handoff.target.label} was not started.`,
    };
  }
  if (handoff.signal.aborted) {
    return { completed: false, cancelled: true, activityBaseline: (before.activity ?? '').length };
  }

  // Resolved per dispatch from the card as it is on disk right now, against the
  // provider running *this* attempt, and for *this* handoff's stage. A model
  // edited mid-run is picked up by the next stage, each stage of one loop run
  // picks up its own rule, and a provider the credit fallback swapped in
  // resolves against its own flags and its own workspace default rather than
  // inheriting the exhausted CLI's.
  const modelSelection = resolveAgentCliModelSelection(
    handoff.target.provider,
    cardPreferredModelFor(before, handoff.target.provider),
    {
      stage: handoff.kind,
      ...(handoff.modelCatalog !== undefined ? { catalog: handoff.modelCatalog } : {}),
      ...(handoff.stageModels !== undefined ? { stageModels: handoff.stageModels } : {}),
      ...(handoff.escalatedModel !== undefined ? { escalatedModel: handoff.escalatedModel } : {}),
    },
  );
  // The effort axis resolves per dispatch from the same card snapshot, against
  // the same provider and stage, so a level and a model can never be read from
  // different states of the board.
  const thinkingSelection = resolveAgentCliThinkingSelection(
    handoff.target.provider,
    cardThinkingLevelFor(before, handoff.target.provider),
    {
      stage: handoff.kind,
      ...(handoff.thinkingLevels !== undefined ? { thinkingLevels: handoff.thinkingLevels } : {}),
      ...(handoff.stageThinkingLevels !== undefined
        ? { stageThinkingLevels: handoff.stageThinkingLevels }
        : {}),
      ...(handoff.escalatedThinkingLevel !== undefined
        ? { escalatedThinkingLevel: handoff.escalatedThinkingLevel }
        : {}),
    },
  );
  const withModel = (result: AgentCliCardHandoffResult): AgentCliCardHandoffResult => ({
    ...result,
    ...(modelSelection ? { modelSelection } : {}),
    ...(thinkingSelection ? { thinkingSelection } : {}),
  });

  await handoff.store.appendActivity(
    handoff.cardId,
    formatAgentCliStartEntry(
      handoff.target.label,
      handoff.kind,
      now(),
      modelSelection,
      thinkingSelection,
    ),
  );
  const afterStart = findCard(await handoff.store.reload(), handoff.cardId);
  const activityBaseline = (afterStart?.activity ?? before.activity ?? '').length;
  const prepared = await prepareAgentCliInvocation(handoff.target, handoff.prompt, handoff.cwd, {
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
    ...(modelSelection !== undefined ? { modelSelection } : {}),
    ...(thinkingSelection !== undefined ? { thinkingSelection } : {}),
  });
  let processResult: AgentCliProcessResult;
  try {
    processResult = await runProcess(prepared.invocation, handoff.signal, options.observer);
  } finally {
    await prepared.cleanup?.();
  }

  if (processResult.cancelled || handoff.signal.aborted) {
    await appendIfCardExists(
      handoff.store,
      handoff.cardId,
      formatAgentCliCancellationEntry(handoff.target.label, handoff.kind, now()),
    );
    return withModel({ completed: false, cancelled: true, activityBaseline });
  }

  // A CLI that refuses the card's model has a working allowance; treating that
  // as exhaustion would burn a fallback provider on a card-authoring mistake,
  // so the rejection is classified first and never reported as exhaustion.
  const modelRejection = detectModelRejection(processResult, modelSelection);
  const creditExhaustion = modelRejection ? undefined : detectCreditExhaustion(processResult);
  const processFailure = modelRejection
    ? describeModelRejection(handoff.target, modelRejection)
    : creditExhaustion
      ? describeCreditExhaustion(handoff.target, creditExhaustion)
      : describeProcessFailure(handoff.target, processResult, modelSelection);
  if (processFailure) {
    await appendIfCardExists(
      handoff.store,
      handoff.cardId,
      formatAgentCliFailureEntry(handoff.target.label, handoff.kind, processFailure, now()),
    );
    return withModel(
      creditExhaustion
        ? {
            completed: false,
            cancelled: false,
            activityBaseline,
            failure: 'credit-exhausted',
            reason: processFailure,
            creditExhaustion,
          }
        : {
            completed: false,
            cancelled: false,
            activityBaseline,
            // A refused model name is its own failure: the CLI is healthy and
            // the fix is to edit whichever layer supplied that name, so it must
            // never be mistaken for an inconclusive attempt.
            failure: modelRejection ? 'model-rejected' : 'process-failed',
            reason: processFailure,
          },
    );
  }

  const after = findCard(await handoff.store.reload(), handoff.cardId);
  if (!after) {
    return withModel({
      completed: false,
      cancelled: false,
      activityBaseline,
      failure: 'card-missing',
      reason: `${handoff.target.label} exited successfully, but card ${handoff.cardId} no longer exists.`,
    });
  }

  const evidence = validateCompletionEvidence(handoff.kind, after, activityBaseline);
  if (!evidence.valid) {
    const reason = `${handoff.target.label} exited successfully, but ${evidence.reason}`;
    await handoff.store.appendActivity(
      handoff.cardId,
      formatAgentCliFailureEntry(handoff.target.label, handoff.kind, reason, now()),
    );
    return withModel({
      completed: false,
      cancelled: false,
      activityBaseline,
      failure: 'missing-evidence',
      reason,
    });
  }

  const baseResult = { completed: true, cancelled: false, activityBaseline } as const;
  return withModel(
    evidence.terminalStatus ? { ...baseResult, terminalStatus: evidence.terminalStatus } : baseResult,
  );
}

/**
 * A failure that names the model the card asked for. Only a run that actually
 * passed a model can produce one, and only the CLI's own "I don't know that
 * model" vocabulary matches, so an unrelated failure keeps its normal message.
 */
export interface AgentCliModelRejection {
  readonly model: string;
  /** Where the refused model came from, so the fix can name the right place. */
  readonly source: AgentCliModelSource;
  /** The stage the refused run belonged to, when the dispatch had one. */
  readonly stage?: AgentCliHandoffKind;
  /** The matched CLI output line, trimmed and stripped of anything secret. */
  readonly detail: string;
}

const MODEL_REJECTION_PATTERNS: readonly RegExp[] = [
  /\b(?:unknown|invalid|unsupported|unrecognized|unrecognised|unavailable)\b[^.\n]{0,20}\bmodels?\b/i,
  /\bmodels?\b[^.\n]{0,40}\b(?:not found|not recognized|not recognised|not supported|not available|does not exist|doesn't exist|is invalid|is unknown)\b/i,
  /\b(?:model_not_found|invalid_model|unknown_model|unsupported_model)\b/i,
  /\bno such model\b/i,
];

const MAX_MODEL_REJECTION_DETAIL = 300;

/**
 * Classify a finished CLI process as "this model name was refused". Returns
 * undefined unless a model was actually applied and the run failed, so the
 * normal failure path is untouched for every other card.
 */
export function detectModelRejection(
  result: AgentCliProcessResult,
  selection: AgentCliModelSelection | undefined,
): AgentCliModelRejection | undefined {
  if (!selection?.applied || !result.started || result.cancelled) {
    return undefined;
  }
  if (result.exitCode === 0 && !result.error) {
    return undefined;
  }

  const lines = `${result.stderr}\n${result.stdout}\n${result.error ?? ''}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    if (MODEL_REJECTION_PATTERNS.some((pattern) => pattern.test(line))) {
      return {
        model: selection.requested,
        source: selection.source,
        ...(selection.stage !== undefined ? { stage: selection.stage } : {}),
        detail: redactSecrets(line).slice(0, MAX_MODEL_REJECTION_DETAIL),
      };
    }
  }
  return undefined;
}

/**
 * The offending value and the CLI that refused it are both named, because the
 * fix is to edit whichever layer supplied the model rather than to re-check the
 * CLI installation or its allowance. A stage rule is treated exactly like a
 * card model here - same classification, same "not advanced" outcome, never
 * credit exhaustion - and differs only in naming the setting key to fix.
 */
function describeModelRejection(target: AgentCliTarget, rejection: AgentCliModelRejection): string {
  const fix = describeModelRejectionFix(target, rejection);
  return `${target.label} rejected ${describeAgentCliModelSource(rejection.source)}${describeStageSuffix(rejection.source, rejection.stage)} "${rejection.model}": ${rejection.detail}. The card was not advanced; ${fix}.`;
}

function describeModelRejectionFix(
  target: AgentCliTarget,
  rejection: AgentCliModelRejection,
): string {
  switch (rejection.source) {
    case 'card':
      return `set a model name ${target.label} accepts on the card, or clear the card's preferred model to use that CLI's default`;
    case 'stage-rule': {
      const stage = rejection.stage ?? 'affected';
      return `set a model name ${target.label} accepts for "${stage}" in ${AGENT_CLI_STAGE_MODELS_SETTING}, or remove that stage's entry to fall back to ${AGENT_CLI_MODELS_SETTING} and the CLI's default`;
    }
    case 'escalation':
      return `set a model name ${target.label} accepts in ${AGENT_CLI_ESCALATION_LADDER_SETTING} for that CLI, or remove that entry so the loop stops escalating to it`;
    default:
      return `set a model name ${target.label} accepts as its first entry in ${AGENT_CLI_MODELS_SETTING}, or remove that entry to use the CLI's default`;
  }
}

/**
 * A spent allowance is reported as its own failure: the CLI itself is fine, so
 * the advice is to restore credits or let the loop continue on another CLI
 * rather than to re-check the installation.
 */
function describeCreditExhaustion(
  target: AgentCliTarget,
  exhaustion: CreditExhaustionSignal,
): string {
  return `${target.label} ran out of credits or hit its usage limit: ${exhaustion.detail}. The card was not advanced; restore the CLI's allowance or configure an AI loop CLI fallback, then rerun the loop.`;
}

function describeProcessFailure(
  target: AgentCliTarget,
  result: AgentCliProcessResult,
  modelSelection?: AgentCliModelSelection,
): string | undefined {
  // Any failure of a run that carried a model is worth attributing: the model
  // is the newest variable in the dispatch and the likeliest suspect.
  const modelNote = modelSelection?.applied
    ? ` The run used ${describeAgentCliModelSource(modelSelection.source)}${describeStageSuffix(modelSelection.source, modelSelection.stage)} "${modelSelection.requested}".`
    : '';
  if (!result.started) {
    const detail = result.error?.trim() || 'the operating system rejected the process start';
    return `Could not start ${target.label} at "${target.executable}": ${detail}. Verify the configured executable path and CLI installation, then rerun the loop.`;
  }
  if (result.error) {
    return `${target.label} failed while running: ${result.error}. The card was not advanced; fix the CLI and rerun the loop.${modelNote}`;
  }
  if (result.exitCode !== 0) {
    const status = result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.exitCode === null ? 'unknown' : result.exitCode}`;
    const output = conciseProcessOutput(result.stderr || result.stdout);
    return `${target.label} ended with ${status}${output ? `: ${output}` : ''}. The card was not advanced; verify CLI authentication/configuration and rerun the loop.${modelNote}`;
  }
  return undefined;
}

function conciseProcessOutput(output: string): string {
  return output
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-3)
    .join(' ')
    .slice(0, 500);
}

type CompletionEvidence =
  | { readonly valid: true; readonly terminalStatus?: TerminalCardStatus }
  | { readonly valid: false; readonly reason: string };

function validateCompletionEvidence(
  kind: AgentCliHandoffKind,
  card: Card,
  activityBaseline: number,
): CompletionEvidence {
  if (kind === 'definition') {
    return cardNeedsDefinition(card)
      ? {
          valid: false,
          reason: 'the card still has no complete Description and Acceptance criteria. The card was not advanced; rerun the definition handoff after fixing the CLI.',
        }
      : { valid: true };
  }
  if (kind === 'triage') {
    return card.assignee
      ? { valid: true }
      : {
          valid: false,
          reason: 'the card file still has no valid assignee decision. The card was left unassigned; fix the CLI and rerun the loop.',
        };
  }
  if (kind === 'verification') {
    return parseVerificationVerdict(card.activity ?? '', activityBaseline)
      ? { valid: true }
      : {
          valid: false,
          reason: 'no valid `VERIFY: PASS`, `VERIFY: FAIL: <reason>`, or `VERIFY: HUMAN: <reason>` line was appended to the card Activity. The verification result was not accepted; fix the agent instructions or CLI and rerun the verification handoff.',
        };
  }

  const terminal = parseTerminalCardStatus(card.activity ?? '', activityBaseline);
  if (!terminal.valid) {
    return {
      valid: false,
      reason: `${terminal.reason} The card was not advanced; rerun the implementation handoff after fixing the agent instructions or CLI.`,
    };
  }
  return { valid: true, terminalStatus: terminal.status };
}

export type TerminalCardStatus =
  | { readonly kind: 'done' }
  | { readonly kind: 'blocked'; readonly reason: string };

export type TerminalCardStatusParseResult =
  | { readonly valid: true; readonly status: TerminalCardStatus }
  | { readonly valid: false; readonly reason: string };

/**
 * Read only status lines appended after this hand-off started. Old markers can
 * never complete a new run, and BLOCKED is valid only with a concrete reason.
 */
export function parseTerminalCardStatus(
  activity: string,
  activityBaseline: number,
): TerminalCardStatusParseResult {
  if (activityBaseline < 0 || activityBaseline > activity.length) {
    return { valid: false, reason: 'the card Activity was replaced instead of appended and has no trustworthy terminal status.' };
  }
  const appended = activity.slice(activityBaseline);
  const statusLines = appended
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^STATUS:/i.test(line));
  const statusLine = statusLines.at(-1);
  if (!statusLine) {
    return { valid: false, reason: 'no terminal `STATUS: DONE` or `STATUS: BLOCKED: <reason>` line was appended to the card Activity.' };
  }
  if (/^STATUS:\s*DONE(?:\s+(?:—|-).*)?$/i.test(statusLine)) {
    return { valid: true, status: { kind: 'done' } };
  }
  const blocked = /^STATUS:\s*BLOCKED:\s*(.+)$/i.exec(statusLine);
  if (blocked?.[1]?.trim()) {
    return { valid: true, status: { kind: 'blocked', reason: blocked[1].trim() } };
  }
  return {
    valid: false,
    reason: `the appended terminal status "${statusLine}" is invalid; use exactly \`STATUS: DONE\` or \`STATUS: BLOCKED: <reason>\`.`,
  };
}

function findCard(state: BoardState, cardId: string): Card | undefined {
  for (const column of state.columns) {
    const card = column.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      return card;
    }
  }
  return undefined;
}

async function appendIfCardExists(
  store: AgentCliHandoffStore,
  cardId: string,
  entry: string,
): Promise<void> {
  if (findCard(await store.reload(), cardId)) {
    await store.appendActivity(cardId, entry);
  }
}

export function formatAgentCliStartEntry(
  providerLabel: string,
  kind: AgentCliHandoffKind,
  timestamp: Date = new Date(),
  modelSelection?: AgentCliModelSelection,
  thinkingSelection?: AgentCliThinkingSelection,
): string {
  return [
    `### ${timestamp.toISOString()} - ${providerLabel} ${kind} handoff started`,
    `Started ${providerLabel} in the active workspace and waiting for card-file completion evidence.`,
    // Which model a dispatch actually ran on belongs in the durable record, so
    // a card that silently fell back to the provider default is explainable
    // later without re-reading the run's notifications.
    ...(modelSelection
      ? [
          modelSelection.applied
            ? `${agentCliModelSourceLabel(modelSelection.source)}${describeStageSuffix(modelSelection.source, modelSelection.stage)}: ${modelSelection.requested}.`
            : `${agentCliModelSourceLabel(modelSelection.source)}${describeStageSuffix(modelSelection.source, modelSelection.stage)} "${modelSelection.requested}" was not applied: ${modelSelection.reason ?? `${providerLabel} does not accept a model selection.`}`,
        ]
      : []),
    // The effort a dispatch actually ran at belongs in the same durable record
    // and for the same reason: a card that fell back to the CLI's own default
    // should be explainable later without the run's notifications.
    ...(thinkingSelection
      ? [
          thinkingSelection.applied
            ? `${agentCliThinkingLevelSourceLabel(thinkingSelection.source)}${describeStageSuffix(thinkingSelection.source, thinkingSelection.stage)}: ${thinkingSelection.requested}.`
            : `${agentCliThinkingLevelSourceLabel(thinkingSelection.source)}${describeStageSuffix(thinkingSelection.source, thinkingSelection.stage)} "${thinkingSelection.requested}" was not applied: ${thinkingSelection.reason ?? `${providerLabel} does not accept a thinking level.`}`,
        ]
      : []),
  ].join('\n');
}

export function formatAgentCliFailureEntry(
  providerLabel: string,
  kind: AgentCliHandoffKind,
  reason: string,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - ${providerLabel} ${kind} handoff failed`,
    reason,
  ].join('\n');
}

export function formatAgentCliCancellationEntry(
  providerLabel: string,
  kind: AgentCliHandoffKind,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - ${providerLabel} ${kind} handoff cancelled`,
    'The active CLI process was stopped. The card was not advanced and remains assigned for a recoverable retry.',
  ].join('\n');
}
