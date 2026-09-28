/**
 * Discover the model names and thinking levels each agent CLI accepts, and plan
 * how they land in `mwnn-kanban.agentCliModels` / `agentCliThinkingLevels`.
 *
 * This module owns everything the "Populate Agent CLI Models and Thinking
 * Levels" command decides that is not UI: which command asks each CLI for its
 * vocabulary, how that output is parsed, the bundled lists used when a CLI
 * cannot be asked, and how discovered values merge with what the user already
 * configured. The command in `extension.ts` only asks the user and writes.
 *
 * Discovered values stay free-form pass-through strings, spelled exactly as the
 * CLI printed them. Nothing here validates a card's model against these lists;
 * they only pre-fill the settings the card UI suggests from.
 */
import {
  AGENT_CLI_LABELS,
  AGENT_CLI_PROVIDER_IDS,
  AGENT_CLI_THINKING_FLAGS,
  resolveAgentCliTarget,
  runAgentCliProcess,
  type AgentCliPathOverrides,
  type AgentCliProviderId,
  type AgentCliTarget,
  type ExecutableDiscoveryOptions,
} from './agentCliHandoff';
import {
  agentCliModelsFor,
  readAgentCliModelCatalog,
  readAgentCliThinkingLevelSuggestions,
} from './agentCliModels';
import { normalizePreferredModel } from './utils';

/** Where one discovered list came from. */
export type AgentCliDiscoverySource = 'cli' | 'bundled';

export interface AgentCliDiscoveredList {
  readonly values: readonly string[];
  readonly source: AgentCliDiscoverySource;
}

export interface AgentCliDiscovery {
  readonly provider: AgentCliProviderId;
  readonly label: string;
  /** Whether the CLI executable was found at all. */
  readonly installed: boolean;
  readonly models: AgentCliDiscoveredList;
  readonly thinkingLevels: AgentCliDiscoveredList;
  /**
   * Whether this extension passes a thinking level to this CLI. Levels found
   * for a CLI without that support are reported but never written.
   */
  readonly thinkingSupported: boolean;
  /** Why a probe was skipped or fell back, one line each, for the summary. */
  readonly notes: readonly string[];
}

/**
 * Bundled vocabularies, used when a CLI is not installed or cannot list its
 * own. A snapshot, not an allow-list: it only seeds suggestions, and anything
 * the CLI later adds can still be typed on a card. The first entry is the one
 * that becomes a provider's default when nothing is configured yet, so each
 * list leads with the value closest to that CLI's own default behavior.
 */
export const BUNDLED_AGENT_CLI_MODELS: Readonly<Record<AgentCliProviderId, readonly string[]>> =
  Object.freeze({
    copilot: ['auto', 'claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4.5', 'gpt-5.5', 'gpt-5-mini'],
    codex: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.2'],
    // Claude Code's aliases track the newest model of each family, so they do
    // not go stale the way full model names do; `default` is the account's
    // recommended model, which is what an unconfigured run uses.
    'claude-code': ['default', 'sonnet', 'opus', 'fable', 'haiku'],
    cursor: ['auto'],
  });

export const BUNDLED_AGENT_CLI_THINKING_LEVELS: Readonly<Record<AgentCliProviderId, readonly string[]>> =
  Object.freeze({
    copilot: ['medium', 'none', 'minimal', 'low', 'high', 'xhigh', 'max'],
    codex: ['medium', 'low', 'high', 'xhigh'],
    'claude-code': ['medium', 'low', 'high', 'xhigh', 'max'],
    cursor: [],
  });

/* ------------------------------------------------------------------------ *
 * Parsers. Each takes a CLI's raw stdout and returns the names it lists, in
 * the CLI's order, or an empty list when the output is not what it expected -
 * which the caller treats as "fall back", never as an error.
 * ------------------------------------------------------------------------ */

/**
 * Copilot CLI: `copilot help config` documents the `model` setting followed by
 * one `- "name"` line per accepted model.
 */
export function parseCopilotConfigModels(output: string): string[] {
  const lines = stripAnsi(output).split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*`model`\s*:/.test(line));
  if (start < 0) {
    return [];
  }
  const models: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s*-\s*"([^"]+)"\s*$/.exec(line);
    if (!match) {
      break;
    }
    models.push(match[1] ?? '');
  }
  return cleanList(models);
}

/**
 * The value list of one option in a `--help` screen, e.g. Copilot's
 * `--effort <level> ... (choices: "low", "high")` or Claude Code's
 * `--effort <level> ... (low, medium, high)`. The option's description may wrap
 * over several lines; it ends at the next line that starts another option.
 */
export function parseHelpOptionChoices(output: string, flag: string): string[] {
  const lines = stripAnsi(output).split(/\r?\n/);
  const flagPattern = new RegExp(`(^|[\\s,])${escapeRegExp(flag)}(?=[\\s,<=[]|$)`);
  const start = lines.findIndex((line) => /^\s*-/.test(line) && flagPattern.test(line));
  if (start < 0) {
    return [];
  }
  const block = [lines[start] ?? ''];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*-/.test(line) || line.trim().length === 0) {
      break;
    }
    block.push(line);
  }
  const text = block.map((line) => line.trim()).join(' ');
  const groups = [...text.matchAll(/\(([^()]*)\)/g)].map((match) => match[1] ?? '');
  const list = groups.reverse().find((group) => group.includes(','));
  if (list === undefined) {
    return [];
  }
  const quoted = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? '');
  const values = quoted.length > 0
    ? quoted
    : list.replace(/^\s*choices\s*:/i, '').split(',').map((value) => value.trim());
  return cleanList(values.filter((value) => /^[\w.-]+$/.test(value)));
}

/**
 * Codex CLI: `codex debug models` prints its model catalog as JSON. Hidden
 * models are skipped and the rest ordered by the catalog's own priority. The
 * levels are the union of every listed model's supported efforts, led by the
 * top model's default effort so that becomes the provider default.
 */
export function parseCodexModelCatalog(output: string): { models: string[]; thinkingLevels: string[] } {
  const empty = { models: [], thinkingLevels: [] };
  let parsed: unknown;
  try {
    const json = output.slice(output.indexOf('{'));
    parsed = JSON.parse(json);
  } catch {
    return empty;
  }
  const entries = isRecord(parsed) && Array.isArray(parsed['models']) ? parsed['models'] : [];
  const listed = entries
    .filter(isRecord)
    .filter((entry) => typeof entry['slug'] === 'string' && entry['visibility'] !== 'hide')
    .map((entry, index) => ({
      entry,
      priority: typeof entry['priority'] === 'number' ? entry['priority'] : Number.MAX_SAFE_INTEGER,
      index,
    }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ entry }) => entry);

  const models = cleanList(listed.map((entry) => entry['slug'] as string));
  const levels: string[] = [];
  const top = listed[0];
  if (top && typeof top['default_reasoning_level'] === 'string') {
    levels.push(top['default_reasoning_level']);
  }
  for (const entry of listed) {
    const supported = Array.isArray(entry['supported_reasoning_levels'])
      ? entry['supported_reasoning_levels']
      : [];
    for (const level of supported) {
      if (isRecord(level) && typeof level['effort'] === 'string') {
        levels.push(level['effort']);
      }
    }
  }
  return { models, thinkingLevels: cleanList(levels) };
}

/**
 * Cursor Agent CLI: `cursor-agent models` prints one `<id> - <display name>`
 * line per model, under a heading and sometimes above a tip.
 */
export function parseCursorModels(output: string): string[] {
  const models: string[] = [];
  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9][\w.:/-]*)\s+-\s+\S/.exec(line);
    if (match) {
      models.push(match[1] ?? '');
    }
  }
  return cleanList(models);
}

/* ------------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------------ */

/** Outcome of running one listing command. `ok: false` means "fall back". */
export type AgentCliProbeResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly reason: string };

/** Runs one listing command against a resolved CLI. Injectable for tests. */
export type AgentCliProbeRunner = (
  target: AgentCliTarget,
  args: readonly string[],
  cwd: string,
) => Promise<AgentCliProbeResult>;

interface ProviderProbes {
  readonly models?: { readonly args: readonly string[]; readonly parse: (stdout: string) => string[] };
  readonly thinkingLevels?: {
    readonly args: readonly string[];
    readonly parse: (stdout: string) => string[];
  };
}

/**
 * The listing commands per CLI. A CLI with no way to list one axis simply has
 * no probe for it and uses the bundled list. Probes with identical arguments
 * run once and share their output.
 */
const PROVIDER_PROBES: Readonly<Record<AgentCliProviderId, ProviderProbes>> = {
  copilot: {
    // Led by `auto` (Copilot picks), which is what an unconfigured run does,
    // so populating an empty setting does not change which model runs.
    models: { args: ['help', 'config'], parse: (stdout) => leadWith('auto', parseCopilotConfigModels(stdout)) },
    thinkingLevels: { args: ['--help'], parse: (stdout) => parseHelpOptionChoices(stdout, '--effort') },
  },
  codex: {
    models: { args: ['debug', 'models'], parse: (stdout) => parseCodexModelCatalog(stdout).models },
    thinkingLevels: {
      args: ['debug', 'models'],
      parse: (stdout) => parseCodexModelCatalog(stdout).thinkingLevels,
    },
  },
  'claude-code': {
    thinkingLevels: { args: ['--help'], parse: (stdout) => parseHelpOptionChoices(stdout, '--effort') },
  },
  cursor: {
    models: { args: ['models'], parse: parseCursorModels },
  },
};

export const AGENT_CLI_DISCOVERY_TIMEOUT_MS = 20_000;

export interface AgentCliDiscoveryOptions {
  readonly cwd: string;
  readonly configuredPaths?: AgentCliPathOverrides;
  readonly executableOptions?: ExecutableDiscoveryOptions;
  readonly resolveTarget?: typeof resolveAgentCliTarget;
  readonly runProbe?: AgentCliProbeRunner;
  readonly thinkingFlags?: Readonly<Record<AgentCliProviderId, string | undefined>>;
  readonly timeoutMs?: number;
}

/**
 * Discover every provider concurrently. One provider failing - not installed,
 * a non-zero exit, a timeout, unparseable output - only moves that provider to
 * its bundled lists; it never rejects the whole discovery.
 */
export async function discoverAgentCliVocabularies(
  options: AgentCliDiscoveryOptions,
): Promise<AgentCliDiscovery[]> {
  return Promise.all(AGENT_CLI_PROVIDER_IDS.map((provider) => discoverProvider(provider, options)));
}

async function discoverProvider(
  provider: AgentCliProviderId,
  options: AgentCliDiscoveryOptions,
): Promise<AgentCliDiscovery> {
  const resolveTarget = options.resolveTarget ?? resolveAgentCliTarget;
  const runProbe = options.runProbe ?? ((target, args, cwd) =>
    runAgentCliProbe(target, args, cwd, options.timeoutMs ?? AGENT_CLI_DISCOVERY_TIMEOUT_MS));
  const thinkingSupported = (options.thinkingFlags ?? AGENT_CLI_THINKING_FLAGS)[provider] !== undefined;
  const notes: string[] = [];

  let target: AgentCliTarget | undefined;
  try {
    const resolution = await resolveTarget(
      provider,
      options.configuredPaths ?? {},
      { cwd: options.cwd, ...options.executableOptions },
    );
    if (resolution.available) {
      target = resolution.target;
    } else {
      notes.push('not installed; using the bundled lists');
    }
  } catch (error: unknown) {
    notes.push(`could not be located (${errorMessage(error)}); using the bundled lists`);
  }

  const outputs = new Map<string, Promise<AgentCliProbeResult>>();
  const probe = async (
    axis: 'models' | 'thinking levels',
    spec: ProviderProbes['models'],
    bundled: readonly string[],
  ): Promise<AgentCliDiscoveredList> => {
    if (!target || !spec) {
      return { values: cleanList(bundled), source: 'bundled' };
    }
    const key = spec.args.join('\u0000');
    let pending = outputs.get(key);
    if (!pending) {
      pending = runProbe(target, spec.args, options.cwd).catch((error: unknown) => ({
        ok: false as const,
        reason: errorMessage(error),
      }));
      outputs.set(key, pending);
    }
    const result = await pending;
    if (!result.ok) {
      notes.push(`listing ${axis} failed (${result.reason}); using the bundled list`);
      return { values: cleanList(bundled), source: 'bundled' };
    }
    const values = spec.parse(result.stdout);
    if (values.length === 0) {
      notes.push(`listed no ${axis} this extension could read; using the bundled list`);
      return { values: cleanList(bundled), source: 'bundled' };
    }
    return { values, source: 'cli' };
  };

  const probes = PROVIDER_PROBES[provider];
  const [models, thinkingLevels] = await Promise.all([
    probe('models', probes.models, BUNDLED_AGENT_CLI_MODELS[provider]),
    probe('thinking levels', probes.thinkingLevels, BUNDLED_AGENT_CLI_THINKING_LEVELS[provider]),
  ]);
  return {
    provider,
    label: AGENT_CLI_LABELS[provider],
    installed: target !== undefined,
    models,
    thinkingLevels,
    thinkingSupported,
    notes,
  };
}

/**
 * Run one listing command with a timeout. The whole stdout is collected
 * through the observer, because a catalog (Codex's is hundreds of KB) is larger
 * than the tail the process result keeps.
 */
async function runAgentCliProbe(
  target: AgentCliTarget,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<AgentCliProbeResult> {
  const chunks: string[] = [];
  const result = await runAgentCliProcess(
    {
      provider: target.provider,
      label: target.label,
      command: target.executable,
      args: target.launcher === 'gh-copilot' ? ['copilot', '--', ...args] : [...args],
      stdin: '',
      cwd,
    },
    AbortSignal.timeout(timeoutMs),
    {
      onOutput: (chunk, stream) => {
        if (stream === 'stdout') {
          chunks.push(chunk);
        }
      },
    },
  );
  if (result.cancelled) {
    return { ok: false, reason: `timed out after ${Math.round(timeoutMs / 1000)}s` };
  }
  if (result.error !== undefined) {
    return { ok: false, reason: result.error };
  }
  if (result.exitCode !== 0) {
    return { ok: false, reason: `exited with code ${String(result.exitCode)}` };
  }
  return { ok: true, stdout: chunks.join('') };
}

/* ------------------------------------------------------------------------ *
 * Planning the settings write
 * ------------------------------------------------------------------------ */

/**
 * `merge` keeps the user's list as it is - first entry (the default) and order
 * included - and appends discovered names it lacks. `replace` writes the
 * discovered list alone.
 */
export type AgentCliPopulateMode = 'merge' | 'replace';

export interface AgentCliProviderPlan {
  readonly provider: AgentCliProviderId;
  readonly models: { readonly before: readonly string[]; readonly after: readonly string[] };
  /** Absent when the extension passes no thinking level to this CLI. */
  readonly thinkingLevels?: { readonly before: readonly string[]; readonly after: readonly string[] };
}

export interface AgentCliPopulatePlan {
  /** The new `agentCliModels` object for the chosen scope. */
  readonly models: Record<string, unknown>;
  /** The new `agentCliThinkingLevels` object for the chosen scope. */
  readonly thinkingLevels: Record<string, unknown>;
  readonly providers: readonly AgentCliProviderPlan[];
  /** Whether writing would change either setting at all. */
  readonly changed: boolean;
}

/** Combine an existing list with a discovered one, both already cleaned. */
export function combineAgentCliLists(
  existing: readonly string[],
  discovered: readonly string[],
  mode: AgentCliPopulateMode,
): string[] {
  return mode === 'replace' ? cleanList(discovered) : cleanList([...existing, ...discovered]);
}

/**
 * Plan both settings from the values currently stored in the scope being
 * written (not the effective values, so a user-level list is never copied into
 * the workspace). Keys this plan does not own - providers it has nothing for,
 * or thinking levels for a CLI without effort support - are carried over
 * unchanged, and no provider is ever written an empty list.
 */
export function planAgentCliPopulate(
  existingModels: unknown,
  existingThinkingLevels: unknown,
  discoveries: readonly AgentCliDiscovery[],
  mode: AgentCliPopulateMode,
): AgentCliPopulatePlan {
  const models: Record<string, unknown> = isRecord(existingModels) ? { ...existingModels } : {};
  const thinkingLevels: Record<string, unknown> = isRecord(existingThinkingLevels)
    ? { ...existingThinkingLevels }
    : {};
  const modelCatalog = readAgentCliModelCatalog(existingModels);
  const levelLists = readAgentCliThinkingLevelSuggestions(existingThinkingLevels);
  const providers: AgentCliProviderPlan[] = [];
  let changed = false;

  for (const discovery of discoveries) {
    const { provider } = discovery;
    const modelsBefore = agentCliModelsFor(modelCatalog, provider);
    const modelsAfter = combineAgentCliLists(modelsBefore, discovery.models.values, mode);
    const finalModels = modelsAfter.length > 0 ? modelsAfter : [...modelsBefore];
    if (modelsAfter.length > 0 && !sameList(models[provider], modelsAfter)) {
      models[provider] = modelsAfter;
      changed = true;
    }

    let plannedLevels: AgentCliProviderPlan['thinkingLevels'];
    if (discovery.thinkingSupported) {
      const levelsBefore = levelLists[provider] ?? [];
      const levelsAfter = combineAgentCliLists(levelsBefore, discovery.thinkingLevels.values, mode);
      if (levelsAfter.length > 0 && !sameList(thinkingLevels[provider], levelsAfter)) {
        thinkingLevels[provider] = levelsAfter;
        changed = true;
      }
      plannedLevels = {
        before: levelsBefore,
        after: levelsAfter.length > 0 ? levelsAfter : [...levelsBefore],
      };
    }

    providers.push({
      provider,
      models: { before: modelsBefore, after: finalModels },
      ...(plannedLevels ? { thinkingLevels: plannedLevels } : {}),
    });
  }

  return { models, thinkingLevels, providers, changed };
}

/** One summary line per provider for the confirmation dialog. */
export function describeAgentCliDiscovery(
  discovery: AgentCliDiscovery,
  plan: AgentCliProviderPlan | undefined,
): string {
  const source = (list: AgentCliDiscoveredList): string =>
    list.source === 'cli' ? 'from the CLI' : 'bundled';
  const levels = discovery.thinkingLevels.values.length;
  let line = `${discovery.label}${discovery.installed ? '' : ' (not installed)'}: `
    + `${discovery.models.values.length} models ${source(discovery.models)}`;
  if (discovery.thinkingSupported) {
    line += `, ${levels} thinking levels ${source(discovery.thinkingLevels)}`;
  } else if (levels > 0) {
    line += `; ${levels} thinking levels ${source(discovery.thinkingLevels)}, not written`
      + ' (this extension passes no effort argument to this CLI)';
  } else {
    line += '; no thinking levels';
  }
  if (plan) {
    const added = plan.models.after.filter((model) => !plan.models.before.includes(model)).length;
    line += `. Models: ${plan.models.before.length} → ${plan.models.after.length} (+${added})`;
    const first = plan.models.after[0];
    if (first !== undefined) {
      line += `, default "${first}"`;
    }
    if (plan.thinkingLevels) {
      const level = plan.thinkingLevels.after[0];
      line += `. Thinking: ${plan.thinkingLevels.before.length} → ${plan.thinkingLevels.after.length}`;
      if (level !== undefined) {
        line += `, default "${level}"`;
      }
    }
  }
  if (discovery.notes.length > 0) {
    line += ` — ${discovery.notes.join('; ')}`;
  }
  return line;
}

/* ------------------------------------------------------------------------ */

/**
 * Trim, drop blank or unusable names, and drop duplicates keeping the first,
 * with the same normalization the settings readers apply.
 */
function cleanList(values: readonly string[]): string[] {
  const cleaned: string[] = [];
  for (const value of values) {
    const usable = normalizePreferredModel(value);
    if (usable !== undefined && !cleaned.includes(usable)) {
      cleaned.push(usable);
    }
  }
  return cleaned;
}

/** Put `first` at the front of a non-empty list; an empty list stays empty. */
function leadWith(first: string, values: readonly string[]): string[] {
  return values.length === 0 ? [] : cleanList([first, ...values]);
}

function sameList(current: unknown, next: readonly string[]): boolean {
  return (
    Array.isArray(current) &&
    current.length === next.length &&
    current.every((value, index) => value === next[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
