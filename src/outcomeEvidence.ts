import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { Card } from './types';
import { resolveSharedWorkerRoot } from './workerStoreLocation';

const execFileAsync = promisify(execFile);
const PROFILE_PATH = '.mwnn/verification.json';
const CHECKER = 'mwnn-outcome-v1';
const CHECK_IDS = ['compile-tests', 'compile', 'focused-tests', 'tests', 'lint', 'diff'] as const;
type CheckId = typeof CHECK_IDS[number];

export interface VerificationProfile {
  readonly version: 1;
  readonly criteria: readonly {
    readonly text: string;
    readonly checks: readonly CheckId[];
    readonly human?: boolean;
  }[];
  /** Compiled test paths, relative to the project root. */
  readonly focusedTests?: readonly string[];
}

export interface EvidenceCommand {
  readonly id: CheckId;
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
    readonly id: CheckId;
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

function requirements(card: Card): string {
  return JSON.stringify({ id: card.id, title: card.title, description: card.description ?? '',
    criteria: criterionTexts(card), dependsOn: card.dependsOn ?? [] });
}

export function parseVerificationProfile(text: string): VerificationProfile {
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Verification profile must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record['version'] !== 1 || !Array.isArray(record['criteria']) || record['criteria'].length === 0) {
    throw new Error('Verification profile needs version 1 and nonempty criteria.');
  }
  const seen = new Set<string>();
  for (const item of record['criteria'] as unknown[]) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('Invalid criterion mapping.');
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry['text'] !== 'string' || entry['text'].trim().length === 0
      || seen.has(entry['text']) || !Array.isArray(entry['checks'])
      || entry['checks'].some((id: unknown) => !CHECK_IDS.includes(id as CheckId))
      || (entry['human'] !== undefined && typeof entry['human'] !== 'boolean')) {
      throw new Error('Invalid or duplicate criterion mapping.');
    }
    seen.add(entry['text']);
  }
  if (record['focusedTests'] !== undefined && (!Array.isArray(record['focusedTests'])
    || record['focusedTests'].length === 0
    || record['focusedTests'].some((file: unknown) => typeof file !== 'string'
      || !/^dist-test\/test\/[a-zA-Z0-9_./-]+\.test\.js$/.test(file)
      || file.split('/').includes('..')))) {
    throw new Error('Focused tests must name compiled tests inside dist-test/test/.');
  }
  return value as VerificationProfile;
}

/** Freeze the inputs before the agent runs. Agent text never creates a receipt. */
export function createOutcomeEvidenceFactory(deps: OutcomeEvidenceDeps): OutcomeEvidenceFactory {
  return async (input) => {
    const startedAt = deps.now().toISOString();
    const runId = deps.id();
    const attemptId = deps.id();
    const frozenRequirements = requirements(input.card);
    let initial: { revision: RevisionSnapshot; profileText: string; profile: VerificationProfile;
      instructions: string; packageText: string } | undefined;
    let preparationError = 'Verification inputs could not be captured.';
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
      const profileText = await deps.readText(path.join(input.cwd, PROFILE_PATH));
      initial = { profileText, profile: parseVerificationProfile(profileText),
        revision: await deps.snapshot(input.cwd, input.boardFolder), instructions: await readInstructions(),
        packageText: await deps.readText(path.join(input.cwd, 'package.json')) };
    } catch {
      preparationError = `Missing or invalid verification inputs. Configure ${PROFILE_PATH}, with a check mapping for every acceptance criterion, before dispatch.`;
    }
    let used = false;
    let acceptedRevalidate: (() => Promise<boolean>) | undefined;
    return {
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
          if (texts.length === 0 || texts.some((text) => {
            const mapping = frozen.profile.criteria.find((entry) => entry.text === text);
            return !mapping || mapping.human === true || mapping.checks.length === 0;
          })) {
            return { valid: false, reason: 'Acceptance criteria require human verification or lack independent check mappings.' };
          }
          const inputsUnchanged = async (): Promise<boolean> =>
            await deps.readText(path.join(input.cwd, PROFILE_PATH)) === frozen.profileText
            && await deps.readText(path.join(input.cwd, 'package.json')) === frozen.packageText
            && await readInstructions() === frozen.instructions;
          if (!await inputsUnchanged()) {
            return { valid: false, reason: 'Verification profile, scripts or instructions changed after dispatch; new input capture is required.' };
          }
          const pkg = JSON.parse(frozen.packageText) as { scripts?: Record<string, unknown> };
          for (const script of ['compile-tests', 'compile', 'test', 'lint']) {
            if (typeof pkg.scripts?.[script] !== 'string') {
              return { valid: false, reason: `Required project script is missing: ${script}. Human verification is required.` };
            }
          }
          const npmCommand = deps.npmCommand ?? 'npm';
          const commands: EvidenceCommand[] = [
            { id: 'compile-tests', command: npmCommand, args: ['run', 'compile-tests'], cwd: input.cwd },
            { id: 'compile', command: npmCommand, args: ['run', 'compile'], cwd: input.cwd },
          ];
          if (frozen.profile.focusedTests) {
            commands.push({ id: 'focused-tests', command: 'node',
              args: ['--test', ...frozen.profile.focusedTests], cwd: input.cwd });
          }
          if (texts.some((text) => frozen.profile.criteria.find((entry) => entry.text === text)
            ?.checks.includes('focused-tests')) && !frozen.profile.focusedTests) {
            return { valid: false, reason: 'A criterion requires focused tests but none are configured.' };
          }
          commands.push(
            { id: 'tests', command: npmCommand, args: ['test'], cwd: input.cwd },
            { id: 'lint', command: npmCommand, args: ['run', 'lint'], cwd: input.cwd },
            { id: 'diff', command: 'git', args: ['diff', '--check', 'HEAD'], cwd: input.cwd },
          );
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
            const isTest = command.id === 'tests' || command.id === 'focused-tests';
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
