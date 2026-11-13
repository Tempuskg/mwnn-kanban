import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { Card } from './types';
import { resolveSharedWorkerRoot } from './workerStoreLocation';

const execFileAsync = promisify(execFile);
export const VERIFICATION_PROFILE_PATH = '.mwnn/verification.json';
const PROFILE_PATH = VERIFICATION_PROFILE_PATH;
const CHECKER = 'mwnn-outcome-v1';
const CHECK_IDS = ['compile-tests', 'compile', 'focused-tests', 'tests', 'lint', 'diff'] as const;
const BUILT_IN_NPM_SCRIPTS = ['compile-tests', 'compile', 'test', 'lint'] as const;
const LEGACY_PROFILE_FAILURE = 'Missing or invalid verification inputs.';
const PROFILE_FAILURE_PREFIX = `Verification profile ${PROFILE_PATH} `;

/** A project-specific check; `cwd` is relative to the project root. */
export interface VerificationCommand {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

export interface VerificationProfile {
  readonly version: 1;
  /** Explicit mappings; may be empty when `defaultChecks` is set. */
  readonly criteria: readonly {
    readonly text: string;
    readonly checks: readonly string[];
    readonly human?: boolean;
  }[];
  /** Compiled test paths, relative to the project root. Built-in npm checks only. */
  readonly focusedTests?: readonly string[];
  /** Replaces the built-in npm checks; check ids then name these commands. */
  readonly commands?: readonly VerificationCommand[];
  /** Checks for any criterion without an explicit mapping. */
  readonly defaultChecks?: readonly string[];
}

export interface EvidenceCommand {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface EvidenceCommandResult {
  readonly started: boolean;
  readonly cancelled: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}

export interface RevisionSnapshot {
  readonly root: string;
  readonly head: string;
  readonly digest: string;
}

export interface OutcomeReceipt {
  readonly version: 1;
  readonly checker: typeof CHECKER;
  readonly projectId: string;
  readonly cardId: string;
  readonly stage: 'implementation' | 'verification';
  readonly runId: string;
  readonly attemptId: string;
  readonly inputDigest: string;
  readonly inputRevision: RevisionSnapshot;
  readonly checkedRevision: RevisionSnapshot;
  readonly profileDigest: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly checks: readonly {
    readonly id: string;
    readonly command: string;
    readonly args: readonly string[];
    readonly exitCode: number;
    readonly stdoutDigest: string;
    readonly stderrDigest: string;
    readonly tests?: number;
  }[];
}

export type OutcomeEvidenceResult =
  | { readonly valid: true; readonly receipt: OutcomeReceipt; readonly receiptPath: string }
  | { readonly valid: false; readonly reason: string };

export interface OutcomeEvidenceInput {
  readonly boardFolder?: string;
  readonly cwd: string;
  readonly card: Card;
  readonly prompt: string;
  readonly stage: 'implementation' | 'verification';
  readonly signal: AbortSignal;
  readonly reloadCard: () => Promise<Card | undefined>;
}

export interface OutcomeEvidenceSession {
  /** Project-relative path of a profile this session wrote because none existed. */
  readonly createdProfile?: string;
  verify(): Promise<OutcomeEvidenceResult>;
  /** Recheck a live host receipt before a later board advancement. */
  revalidate?(): Promise<boolean>;
}

export type OutcomeEvidenceFactory = (input: OutcomeEvidenceInput) => Promise<OutcomeEvidenceSession>;

export interface OutcomeEvidenceDeps {
  readonly checkTimeoutMs?: number;
  readonly npmCommand?: string;
  snapshot(root: string, boardFolder?: string): Promise<RevisionSnapshot>;
  readText(file: string): Promise<string>;
  /** Create-only write (must fail if the file exists); absent = never create a profile. */
  createText?(file: string, contents: string): Promise<void>;
  /** Entries of a directory, for project detection; absent = nothing detected. */
  listDirectory?(directory: string): Promise<readonly DirectoryEntry[]>;
  run(command: EvidenceCommand, signal: AbortSignal): Promise<EvidenceCommandResult>;
  persist(receipt: OutcomeReceipt): Promise<string>;
  now(): Date;
  id(): string;
}

export function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function criterionTexts(card: Card): string[] {
  return (card.acceptanceCriteria ?? '').split(/\r?\n/)
    .map((line) => /^\s*-\s+\[[ xX]\]\s+(.+?)\s*$/.exec(line)?.[1])
    .filter((text): text is string => text !== undefined);
}

export interface DirectoryEntry {
  readonly name: string;
  readonly directory: boolean;
}

function requirements(card: Card): string {
  return JSON.stringify({ id: card.id, title: card.title, description: card.description ?? '',
    criteria: criterionTexts(card), dependsOn: card.dependsOn ?? [] });
}

/** Stable fingerprint of what a card asks for; Activity and checkboxes are excluded. */
export function requirementsDigest(card: Card): string {
  return digest(requirements(card));
}

/** True for a gate rejection caused only by a missing or invalid profile. */
export function isVerificationProfileFailure(reason: string): boolean {
  return reason.startsWith(LEGACY_PROFILE_FAILURE) || reason.startsWith(PROFILE_FAILURE_PREFIX);
}

function isRelativeInsideRoot(value: string): boolean {
  return value.trim().length > 0 && !path.isAbsolute(value) && !path.win32.isAbsolute(value)
    && !value.split(/[\\/]/).includes('..');
}

function parseCommands(value: unknown): VerificationCommand[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('"commands" must be a nonempty array.');
  }
  const ids = new Set<string>();
  return value.map((item: unknown, index) => {
    const where = `commands[${index}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`${where} must be an object.`);
    }
    const entry = item as Record<string, unknown>;
    const id = entry['id'];
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      throw new Error(`${where}.id must be a name of letters, digits, ".", "_" or "-".`);
    }
    if (ids.has(id)) { throw new Error(`${where}.id "${id}" is a duplicate.`); }
    ids.add(id);
    const command = entry['command'];
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new Error(`${where}.command must be a nonempty string.`);
    }
    const args = entry['args'] ?? [];
    if (!Array.isArray(args) || args.some((arg: unknown) => typeof arg !== 'string')) {
      throw new Error(`${where}.args must be an array of strings.`);
    }
    const cwd = entry['cwd'];
    if (cwd !== undefined && (typeof cwd !== 'string' || !isRelativeInsideRoot(cwd))) {
      throw new Error(`${where}.cwd must be a relative folder inside the project.`);
    }
    return { id, command, args: args as string[], ...(cwd !== undefined ? { cwd } : {}) };
  });
}

function parseCheckList(value: unknown, where: string, known: readonly string[]): void {
  if (!Array.isArray(value)) { throw new Error(`${where} must be an array of check ids.`); }
  for (const id of value as unknown[]) {
    if (typeof id !== 'string' || !known.includes(id)) {
      throw new Error(`${where} names unknown check ${JSON.stringify(id)}; known checks: ${known.join(', ')}.`);
    }
  }
}

export function parseVerificationProfile(text: string): VerificationProfile {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) { throw new Error(`Not valid JSON (${(error as Error).message}).`); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Verification profile must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record['version'] !== 1) {
    throw new Error('Verification profile needs "version": 1.');
  }
  const commands = record['commands'] === undefined ? undefined : parseCommands(record['commands']);
  const known: readonly string[] = commands ? commands.map((command) => command.id) : CHECK_IDS;
  if (record['defaultChecks'] !== undefined) {
    parseCheckList(record['defaultChecks'], '"defaultChecks"', known);
    if ((record['defaultChecks'] as unknown[]).length === 0) {
      throw new Error('"defaultChecks" must name at least one check.');
    }
  }
  if (!Array.isArray(record['criteria'])
    || (record['criteria'].length === 0 && record['defaultChecks'] === undefined)) {
    throw new Error('Verification profile needs nonempty "criteria" or a "defaultChecks" list.');
  }
  const seen = new Set<string>();
  for (const [index, item] of (record['criteria'] as unknown[]).entries()) {
    const where = `criteria[${index}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`${where} must be an object.`);
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry['text'] !== 'string' || entry['text'].trim().length === 0) {
      throw new Error(`${where}.text must be a nonempty string.`);
    }
    if (seen.has(entry['text'])) {
      throw new Error(`${where}.text duplicates an earlier criterion.`);
    }
    parseCheckList(entry['checks'], `${where}.checks`, known);
    if (entry['human'] !== undefined && typeof entry['human'] !== 'boolean') {
      throw new Error(`${where}.human must be true or false.`);
    }
    seen.add(entry['text']);
  }
  if (commands && record['focusedTests'] !== undefined) {
    throw new Error('"focusedTests" applies only to the built-in npm checks; add a command instead.');
  }
  if (record['focusedTests'] !== undefined && (!Array.isArray(record['focusedTests'])
    || record['focusedTests'].length === 0
    || record['focusedTests'].some((file: unknown) => typeof file !== 'string'
      || !/^dist-test\/test\/[a-zA-Z0-9_./-]+\.test\.js$/.test(file)
      || file.split('/').includes('..')))) {
    throw new Error('Focused tests must name compiled tests inside dist-test/test/.');
  }
  return { ...(value as VerificationProfile), ...(commands ? { commands } : {}) };
}

const DOTNET_PROJECT = /\.(?:sln|slnx|csproj)$/i;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'bin', 'obj', 'dist', 'out']);

async function findDotnetTarget(
  cwd: string,
  listDirectory: NonNullable<OutcomeEvidenceDeps['listDirectory']>,
): Promise<string | undefined> {
  const rank = (name: string): number => (/\.csproj$/i.test(name) ? 1 : 0);
  const pick = (names: readonly string[]): string | undefined =>
    [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0];
  const rootEntries = await listDirectory(cwd);
  const atRoot = pick(rootEntries.filter((entry) => !entry.directory && DOTNET_PROJECT.test(entry.name))
    .map((entry) => entry.name));
  if (atRoot) { return atRoot; }
  const nested: string[] = [];
  for (const entry of rootEntries) {
    if (!entry.directory || entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) {
      continue;
    }
    try {
      for (const child of await listDirectory(path.join(cwd, entry.name))) {
        if (!child.directory && DOTNET_PROJECT.test(child.name)) { nested.push(`${entry.name}/${child.name}`); }
      }
    } catch { /* An unreadable folder is not a project. */ }
  }
  return pick(nested);
}

/**
 * A profile for a project that has none: the four built-in npm scripts when
 * all exist, else whichever npm scripts exist, else `dotnet` for a solution or
 * project file, else `git diff --check` alone. Every criterion uses the defaults.
 */
export async function detectVerificationProfile(
  cwd: string,
  deps: Pick<OutcomeEvidenceDeps, 'readText' | 'listDirectory'>,
): Promise<VerificationProfile> {
  const diff: VerificationCommand = { id: 'diff', command: 'git', args: ['diff', '--check', 'HEAD'] };
  const custom = (commands: VerificationCommand[]): VerificationProfile => ({ version: 1,
    commands: [...commands, diff], defaultChecks: [...commands, diff].map((command) => command.id), criteria: [] });
  let scripts: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(await deps.readText(path.join(cwd, 'package.json'))) as { scripts?: unknown };
    if (typeof pkg.scripts === 'object' && pkg.scripts !== null) { scripts = pkg.scripts as Record<string, unknown>; }
  } catch { /* No usable package.json: not an npm project. */ }
  const hasScript = (name: string): boolean => typeof scripts[name] === 'string';
  if (BUILT_IN_NPM_SCRIPTS.every(hasScript)) {
    return { version: 1, defaultChecks: ['compile-tests', 'compile', 'tests', 'lint', 'diff'], criteria: [] };
  }
  const npmScripts = ['compile-tests', 'compile', 'build', 'test', 'lint'].filter(hasScript);
  if (npmScripts.length > 0) {
    return custom(npmScripts.map((name) => ({ id: name, command: 'npm',
      args: name === 'test' ? ['test'] : ['run', name] })));
  }
  const target = deps.listDirectory ? await findDotnetTarget(cwd, deps.listDirectory) : undefined;
  if (target) {
    return custom([
      { id: 'build', command: 'dotnet', args: ['build', target] },
      { id: 'test', command: 'dotnet', args: ['test', target] },
    ]);
  }
  return custom([]);
}

type ProfileCapture =
  | { readonly kind: 'ready'; readonly text: string; readonly profile: VerificationProfile; readonly created: boolean }
  | { readonly kind: 'failed'; readonly reason: string };

/** Read the profile, creating one only when the file does not exist. Never overwrites. */
async function captureProfile(cwd: string, deps: OutcomeEvidenceDeps): Promise<ProfileCapture> {
  const file = path.join(cwd, PROFILE_PATH);
  let text: string | undefined;
  let created = false;
  try {
    text = await deps.readText(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { kind: 'failed', reason: `${PROFILE_FAILURE_PREFIX}could not be read: ${(error as Error).message}` };
    }
  }
  if (text === undefined) {
    if (!deps.createText) {
      return { kind: 'failed', reason: `${PROFILE_FAILURE_PREFIX}is missing; create it before dispatch.` };
    }
    try {
      const contents = `${JSON.stringify(await detectVerificationProfile(cwd, deps), null, 2)}\n`;
      await deps.createText(file, contents);
      text = contents;
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        return { kind: 'failed', reason: `${PROFILE_FAILURE_PREFIX}is missing and could not be created: ${(error as Error).message}` };
      }
      text = await deps.readText(file);
    }
  }
  try {
    return { kind: 'ready', text, profile: parseVerificationProfile(text), created };
  } catch (error) {
    return { kind: 'failed', reason: `${PROFILE_FAILURE_PREFIX}is invalid: ${(error as Error).message} The file was left unchanged; fix it, then rerun the AI loop.` };
  }
}

/** Freeze the inputs before the agent runs. Agent text never creates a receipt. */
export function createOutcomeEvidenceFactory(deps: OutcomeEvidenceDeps): OutcomeEvidenceFactory {
  return async (input) => {
    const startedAt = deps.now().toISOString();
    const runId = deps.id();
    const attemptId = deps.id();
    const frozenRequirements = requirements(input.card);
    let initial: { revision: RevisionSnapshot; profileText: string; profile: VerificationProfile;
      instructions: string; packageText: string | null } | undefined;
    let preparationError = 'Verification inputs could not be captured.';
    let createdProfile: string | undefined;
    const readPackage = async (): Promise<string | null> => {
      try { return await deps.readText(path.join(input.cwd, 'package.json')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
        return null;
      }
    };
    const readInstructions = async (): Promise<string> => {
      const contents: string[] = [];
      for (const name of ['AGENTS.md', '.github/copilot-instructions.md', 'CLAUDE.md']) {
        try { contents.push(JSON.stringify([name, await deps.readText(path.join(input.cwd, name))])); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
          contents.push(JSON.stringify([name, null]));
        }
      }
      return JSON.stringify(contents);
    };
    try {
      const capture = await captureProfile(input.cwd, deps);
      if (capture.kind === 'failed') {
        preparationError = capture.reason;
      } else {
        if (capture.created) { createdProfile = PROFILE_PATH; }
        initial = { profileText: capture.text, profile: capture.profile,
          revision: await deps.snapshot(input.cwd, input.boardFolder), instructions: await readInstructions(),
          packageText: await readPackage() };
      }
    } catch (error) {
      preparationError = `Verification inputs could not be captured: ${(error as Error).message}`;
    }
    let used = false;
    let acceptedRevalidate: (() => Promise<boolean>) | undefined;
    return {
      ...(createdProfile !== undefined ? { createdProfile } : {}),
      async revalidate() {
        try { return await acceptedRevalidate?.() ?? false; } catch { return false; }
      },
      async verify() {
        if (used) { return { valid: false, reason: 'Verification session was already consumed.' }; }
        used = true;
        if (!initial) { return { valid: false, reason: preparationError }; }
        const frozen = initial;
        try {
          const currentCard = await input.reloadCard();
          if (!currentCard || requirements(currentCard) !== frozenRequirements) {
            return { valid: false, reason: 'Card requirements changed during the attempt; dispatch again against the new inputs.' };
          }
          const texts = criterionTexts(currentCard);
          // An explicit mapping wins; otherwise the criterion falls back to the defaults.
          const checksFor = (text: string): readonly string[] | undefined => {
            const mapping = frozen.profile.criteria.find((entry) => entry.text === text);
            if (!mapping) { return frozen.profile.defaultChecks; }
            return mapping.human === true ? undefined : mapping.checks;
          };
          if (texts.length === 0 || texts.some((text) => (checksFor(text)?.length ?? 0) === 0)) {
            return { valid: false, reason: 'Acceptance criteria require human verification or lack independent check mappings.' };
          }
          const inputsUnchanged = async (): Promise<boolean> =>
            await deps.readText(path.join(input.cwd, PROFILE_PATH)) === frozen.profileText
            && await readPackage() === frozen.packageText
            && await readInstructions() === frozen.instructions;
          if (!await inputsUnchanged()) {
            return { valid: false, reason: 'Verification profile, scripts or instructions changed after dispatch; new input capture is required.' };
          }
          const npmCommand = deps.npmCommand ?? 'npm';
          const commands: EvidenceCommand[] = [];
          if (frozen.profile.commands) {
            for (const command of frozen.profile.commands) {
              commands.push({ id: command.id, command: command.command === 'npm' ? npmCommand : command.command,
                args: command.args, cwd: path.resolve(input.cwd, command.cwd ?? '.') });
            }
          } else {
            const pkg = (frozen.packageText === null ? {} : JSON.parse(frozen.packageText)) as
              { scripts?: Record<string, unknown> };
            for (const script of BUILT_IN_NPM_SCRIPTS) {
              if (typeof pkg.scripts?.[script] !== 'string') {
                return { valid: false, reason: `Required project script is missing: ${script}. Add it, or declare "commands" in ${PROFILE_PATH}.` };
              }
            }
            commands.push(
              { id: 'compile-tests', command: npmCommand, args: ['run', 'compile-tests'], cwd: input.cwd },
              { id: 'compile', command: npmCommand, args: ['run', 'compile'], cwd: input.cwd },
            );
            if (frozen.profile.focusedTests) {
              commands.push({ id: 'focused-tests', command: 'node',
                args: ['--test', ...frozen.profile.focusedTests], cwd: input.cwd });
            }
            if (texts.some((text) => checksFor(text)?.includes('focused-tests')) && !frozen.profile.focusedTests) {
              return { valid: false, reason: 'A criterion requires focused tests but none are configured.' };
            }
            commands.push(
              { id: 'tests', command: npmCommand, args: ['test'], cwd: input.cwd },
              { id: 'lint', command: npmCommand, args: ['run', 'lint'], cwd: input.cwd },
              { id: 'diff', command: 'git', args: ['diff', '--check', 'HEAD'], cwd: input.cwd },
            );
          }
          const builtIn = frozen.profile.commands === undefined;
          const checkedRevision = await deps.snapshot(input.cwd, input.boardFolder);
          const checks: OutcomeReceipt['checks'][number][] = [];
          for (const command of commands) {
            if (input.signal.aborted) { return { valid: false, reason: 'Independent verification was cancelled.' }; }
            const controller = new AbortController();
            const cancel = (): void => controller.abort();
            input.signal.addEventListener('abort', cancel, { once: true });
            const timer = setTimeout(cancel, deps.checkTimeoutMs ?? 15 * 60 * 1000);
            let result: EvidenceCommandResult;
            try {
              if (input.signal.aborted) { controller.abort(); }
              result = await deps.run(command, controller.signal);
            } finally {
              clearTimeout(timer);
              input.signal.removeEventListener('abort', cancel);
            }
            if (!result.started || result.cancelled || controller.signal.aborted || result.exitCode !== 0 || result.error) {
              return { valid: false, reason: `Independent check ${command.id} failed, timed out or was cancelled.` };
            }
            // Only the built-in node:test runs have a known output format to count.
            const isTest = builtIn && (command.id === 'tests' || command.id === 'focused-tests');
            const count = /(?:#|ℹ)\s*tests\s+(\d+)/u.exec(result.stdout)?.[1];
            const tests = count === undefined ? undefined : Number(count);
            const passed = /(?:#|ℹ)\s*pass\s+(\d+)/u.exec(result.stdout)?.[1];
            if (isTest && (tests === undefined || tests < 1 || passed === undefined || Number(passed) < 1)) {
              return { valid: false, reason: `Independent check ${command.id} did not report a nonzero test count.` };
            }
            checks.push({ id: command.id, command: command.command, args: command.args,
              exitCode: 0, stdoutDigest: digest(result.stdout), stderrDigest: digest(result.stderr),
              ...(tests !== undefined ? { tests } : {}) });
          }
          const finalRevision = await deps.snapshot(input.cwd, input.boardFolder);
          const finalCard = await input.reloadCard();
          if (input.signal.aborted || !finalCard || requirements(finalCard) !== frozenRequirements
            || !await inputsUnchanged() || JSON.stringify(finalRevision) !== JSON.stringify(checkedRevision)) {
            return { valid: false, reason: 'Code or verification inputs changed while checks ran; evidence is stale.' };
          }
          const receipt: OutcomeReceipt = { version: 1, checker: CHECKER,
            projectId: digest(checkedRevision.root), cardId: input.card.id, stage: input.stage,
            runId, attemptId, inputDigest: digest(JSON.stringify([input.prompt, frozenRequirements,
              frozen.instructions, frozen.profileText, frozen.packageText, frozen.revision])),
            inputRevision: frozen.revision, checkedRevision, profileDigest: digest(frozen.profileText),
            startedAt, finishedAt: deps.now().toISOString(), checks };
          const receiptPath = await deps.persist(receipt);
          const acceptanceCard = await input.reloadCard();
          if (input.signal.aborted || !acceptanceCard || requirements(acceptanceCard) !== frozenRequirements
            || !await inputsUnchanged()
            || JSON.stringify(await deps.snapshot(input.cwd, input.boardFolder)) !== JSON.stringify(checkedRevision)) {
            return { valid: false, reason: 'Inputs changed while the receipt was saved; evidence is stale.' };
          }
          acceptedRevalidate = async () => {
            const latestCard = await input.reloadCard();
            return !input.signal.aborted && latestCard !== undefined
              && requirements(latestCard) === frozenRequirements && await inputsUnchanged()
              && JSON.stringify(await deps.snapshot(input.cwd, input.boardFolder)) === JSON.stringify(checkedRevision);
          };
          return { valid: true, receipt, receiptPath };
        } catch {
          return { valid: false, reason: 'Independent verification or receipt persistence failed; completion was not accepted.' };
        }
      },
    };
  };
}

/** Hash actual file bytes, modes and names; HEAD alone misses dirty/untracked work. */
export async function snapshotRevision(cwd: string, boardFolder = '.mwnn'): Promise<RevisionSnapshot> {
  const root = await fs.realpath(cwd);
  const git = async (args: string[]): Promise<string> => (await execFileAsync('git', args,
    { cwd: root, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout;
  const top = await fs.realpath((await git(['rev-parse', '--show-toplevel'])).trim());
  if (root !== top) { throw new Error('Verification requires the repository root.'); }
  const head = (await git(['rev-parse', 'HEAD'])).trim();
  const files = [...new Set((await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']))
    .split('\0').filter(Boolean))].sort();
  const boardCardsPrefix = path.relative(root, path.resolve(root, boardFolder, 'cards')).split(path.sep).join('/') + '/';
  const hash = createHash('sha256');
  for (const file of files) {
    // Board Activity and generated receipts are workflow state, not code inputs.
    if (file.startsWith(boardCardsPrefix)) { continue; }
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { throw new Error('File escaped project root.'); }
    hash.update(JSON.stringify(file));
    try {
      const stat = await fs.lstat(absolute);
      if (!stat.isFile() || await fs.realpath(absolute) !== absolute) {
        throw new Error('Symlink, submodule or unsupported file in verification inputs.');
      }
      hash.update(JSON.stringify([stat.mode & 0o777, digest(await fs.readFile(absolute))]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
      hash.update('deleted');
    }
  }
  return { root, head, digest: hash.digest('hex') };
}

export function defaultOutcomeEvidenceFactory(
  run: OutcomeEvidenceDeps['run'],
): OutcomeEvidenceFactory {
  return async (input) => createOutcomeEvidenceFactory({ snapshot: snapshotRevision,
    readText: (file) => fs.readFile(file, 'utf8'), run, now: () => new Date(), id: randomUUID,
    async createText(file, contents) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, contents, { encoding: 'utf8', flag: 'wx' });
    },
    async listDirectory(directory) {
      return (await fs.readdir(directory, { withFileTypes: true }))
        .map((entry) => ({ name: entry.name, directory: entry.isDirectory() }));
    },
    npmCommand: await resolveNpmCommand(),
    async persist(receipt) {
      const directory = path.join(resolveSharedWorkerRoot({ platform: process.platform,
        homeDirectory: os.homedir(), env: process.env }), 'evidence', receipt.projectId);
      await fs.mkdir(directory, { recursive: true });
      const target = path.join(directory, `${receipt.attemptId}.json`);
      await fs.writeFile(target, `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600 });
      return target;
    },
  })(input);
}

/** Absolute shim paths preserve npm.cmd's %~dp0 lookup on Windows. */
export async function resolveNpmCommand(): Promise<string> {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.resolve(directory.replace(/^"|"$/g, ''), executable);
    try {
      if ((await fs.stat(candidate)).isFile()) { return candidate; }
    } catch { /* Continue through PATH; the eventual launch fails closed. */ }
  }
  return executable;
}
