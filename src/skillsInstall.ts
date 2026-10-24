import type { FileSystemLike } from './boardStore';
import {
  planSkillInstallation,
  planUserSkillInstallation,
  referencePathsForEnv,
  userCodexAgentsPath,
  userReferencePathsForEnv,
  type AiEnvironment,
  type SkillsInstallLocation,
  type SkillSource,
  type UserSkillFolders,
} from './skills';

/** Reads and writes absolute user-level paths; the extension host backs it with `vscode.workspace.fs`. */
export interface UserFileIo {
  /** The file's text, or `undefined` when it does not exist. */
  read(path: string): Promise<string | undefined>;
  /** Create parent folders as needed and replace the file without leaving it truncated. */
  write(path: string, content: string): Promise<void>;
}

export interface ImportPlanSkillsInstallOptions {
  readonly location: SkillsInstallLocation;
  readonly skills: readonly SkillSource[];
  /** Workspace-relative file system; read for AI environment markers in both modes. */
  readonly workspaceFs: FileSystemLike;
  /** The environment of the chat provider the plan is handed off to. */
  readonly providerEnv: AiEnvironment;
  readonly userFolders: UserSkillFolders;
  readonly userFs: UserFileIo;
  readonly slugs: readonly string[];
}

/**
 * The skill paths the Import Plan handoff prompt points the agent at: absolute
 * user-level paths in `user` mode, workspace-relative paths otherwise.
 */
export function importPlanSkillReferencePaths(
  location: SkillsInstallLocation,
  providerEnv: AiEnvironment,
  slugs: readonly string[],
  userFolders: UserSkillFolders,
): string[] {
  return location === 'user'
    ? userReferencePathsForEnv(providerEnv, slugs, userFolders)
    : referencePathsForEnv(providerEnv, slugs);
}

/**
 * Install the Import Plan skills at the configured scope. Returns the
 * environments that have no location at that scope and were skipped (Cursor in
 * `user` mode).
 */
export async function installImportPlanSkills(options: ImportPlanSkillsInstallOptions): Promise<readonly AiEnvironment[]> {
  if (options.location === 'user') {
    return installUserSkills(options.skills, options.workspaceFs, options.providerEnv, options.userFolders, options.userFs);
  }
  await installWorkspaceSkills(options.skills, options.workspaceFs, options.providerEnv);
  return [];
}

/** Detect which AI tools a workspace uses, from their marker files/folders. */
export async function detectAiEnvironments(fs: Pick<FileSystemLike, 'exists'>): Promise<Set<AiEnvironment>> {
  const found = new Set<AiEnvironment>();
  if (await fs.exists('.github')) {
    found.add('copilot');
  }
  if ((await fs.exists('AGENTS.md')) || (await fs.exists('.codex'))) {
    found.add('codex');
  }
  if ((await fs.exists('.claude')) || (await fs.exists('CLAUDE.md'))) {
    found.add('claude-code');
  }
  if ((await fs.exists('.cursor')) || (await fs.exists('.cursorrules'))) {
    found.add('cursor');
  }
  return found;
}

/**
 * Install the bundled skills into each detected AI environment, plus the
 * detected provider we are about to hand off to. Skips files whose content is
 * unchanged so re-imports don't churn. Returns the paths written this run.
 */
export async function installWorkspaceSkills(
  skills: readonly SkillSource[],
  fs: FileSystemLike,
  providerEnv: AiEnvironment,
): Promise<string[]> {
  const environments = await detectAiEnvironments(fs);
  environments.add(providerEnv);

  const existingAgentsMd = environments.has('codex') && (await fs.exists('AGENTS.md'))
    ? await fs.readFile('AGENTS.md')
    : undefined;

  const plan = planSkillInstallation(skills, [...environments], existingAgentsMd);
  const written: string[] = [];
  for (const write of plan.writes) {
    const separator = write.path.lastIndexOf('/');
    if (separator !== -1) {
      await fs.createDirectory(write.path.slice(0, separator));
    }

    if (await fs.exists(write.path)) {
      const current = await fs.readFile(write.path);
      if (current === write.content) {
        continue;
      }
    }

    await fs.writeFile(write.path, write.content);
    written.push(write.path);
  }
  return written;
}

/**
 * Install the bundled skills into each environment's user-level folder instead
 * of the workspace. Environments are chosen as for the workspace install, but
 * nothing under the workspace is created, changed, or removed. Skips files
 * whose content is unchanged. Returns the environments that have no user-level
 * location and were therefore skipped.
 */
export async function installUserSkills(
  skills: readonly SkillSource[],
  workspaceFs: Pick<FileSystemLike, 'exists'>,
  providerEnv: AiEnvironment,
  folders: UserSkillFolders,
  userFs: UserFileIo,
): Promise<readonly AiEnvironment[]> {
  const environments = await detectAiEnvironments(workspaceFs);
  environments.add(providerEnv);

  const existingCodexAgentsMd = environments.has('codex')
    ? await userFs.read(userCodexAgentsPath(folders))
    : undefined;

  const plan = planUserSkillInstallation(skills, [...environments], folders, existingCodexAgentsMd);
  for (const write of plan.writes) {
    if ((await userFs.read(write.path)) === write.content) {
      continue;
    }
    await userFs.write(write.path, write.content);
  }
  return plan.skippedEnvs;
}

export interface ImportPlanSkillsOutcome {
  /** Environments with no location at the configured scope (Cursor in `user` mode). */
  readonly skippedEnvs: readonly AiEnvironment[];
  /** Set when installation failed; the handoff still continues with the self-contained prompt. */
  readonly warning?: string;
}

/**
 * Best-effort Import Plan skill installation: a load or write failure becomes a
 * warning instead of an error, and never retries at the other scope, so a failed
 * `user` install leaves the workspace untouched. The handoff prompt embeds the
 * essential rules, so the import continues either way.
 */
export async function tryInstallImportPlanSkills(
  options: Omit<ImportPlanSkillsInstallOptions, 'skills'> & { readonly loadSkills: () => Promise<readonly SkillSource[]> },
): Promise<ImportPlanSkillsOutcome> {
  try {
    const { loadSkills, ...rest } = options;
    return { skippedEnvs: await installImportPlanSkills({ ...rest, skills: await loadSkills() }) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const where = options.location === 'user' ? 'your user folder' : 'this workspace';
    return {
      skippedEnvs: [],
      warning: `Could not install the MWNN skills into ${where}: ${message}. Continuing — the prompt is self-contained.`,
    };
  }
}
