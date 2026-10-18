/**
 * Installable AI "skills" for MWNN Kanban.
 *
 * The extension ships two skill documents (plan-import and card-authoring) and,
 * when a plan is imported, installs them into whichever AI tools a workspace
 * uses so the guidance travels with the project — on any machine — or, when the
 * user prefers, into each tool's user-level folder under their home. This module is
 * pure (no `vscode`/Node fs): it parses a bundled skill document and renders it
 * into each tool's native format, and plans the set of files to write. The thin
 * filesystem/detection layer lives in the extension host.
 */

/** AI tools we can install skills for. */
export type AiEnvironment = 'copilot' | 'codex' | 'claude-code' | 'cursor';

export const AI_ENVIRONMENTS: readonly AiEnvironment[] = ['copilot', 'codex', 'claude-code', 'cursor'];

/** A parsed skill document: metadata plus the markdown body (no frontmatter). */
export interface SkillSource {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly applyTo: readonly string[];
  readonly body: string;
}

export interface SkillFileWrite {
  /** Workspace-relative path, forward slashes. */
  readonly path: string;
  readonly content: string;
}

export interface SkillInstallPlan {
  readonly writes: readonly SkillFileWrite[];
  /** Workspace-relative paths an agent for each environment should read. */
  readonly referencePathsByEnv: Readonly<Record<AiEnvironment, readonly string[]>>;
}

/** Delimiter used to manage our section inside a shared file (Codex AGENTS.md). */
export const MANAGED_BLOCK_MARKER = 'mwnn-kanban:skills';

/** Parse a bundled skill markdown document into metadata + body. */
export function parseSkillDocument(slug: string, raw: string): SkillSource {
  const normalized = raw.replace(/\r\n?/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const frontmatter = match ? (match[1] ?? '') : '';
  const body = (match ? (match[2] ?? '') : normalized).trim();

  return {
    slug,
    name: frontScalar(frontmatter, 'name') ?? slug,
    description: frontScalar(frontmatter, 'description') ?? '',
    applyTo: frontList(frontmatter, 'applyTo'),
    body,
  };
}

/** Where a skill file lives for a given environment (except Codex, which shares AGENTS.md). */
export function skillFilePath(env: AiEnvironment, slug: string): string {
  switch (env) {
    case 'copilot':
      return `.github/instructions/${slug}.instructions.md`;
    case 'claude-code':
      return `.claude/skills/${slug}/SKILL.md`;
    case 'cursor':
      return `.cursor/rules/${slug}.mdc`;
    case 'codex':
      return 'AGENTS.md';
  }
}

/** The paths an agent working in `env` should read to find the installed skills. */
export function referencePathsForEnv(env: AiEnvironment, slugs: readonly string[]): string[] {
  if (env === 'codex') {
    return ['AGENTS.md'];
  }
  return slugs.map((slug) => skillFilePath(env, slug));
}

/** GitHub Copilot `.github/instructions/<slug>.instructions.md`. */
export function renderCopilotInstruction(skill: SkillSource): string {
  const lines = ['---', `name: ${quote(skill.name)}`, `description: ${quote(skill.description)}`];
  if (skill.applyTo.length > 0) {
    lines.push('applyTo:');
    for (const glob of skill.applyTo) {
      lines.push(`  - ${quote(glob)}`);
    }
  }
  lines.push('---', '', skill.body, '');
  return lines.join('\n');
}

/** Claude Code `.claude/skills/<slug>/SKILL.md`. */
export function renderClaudeSkill(skill: SkillSource): string {
  return ['---', `name: ${skill.slug}`, `description: ${quote(skill.description)}`, '---', '', skill.body, ''].join('\n');
}

/** Cursor `.cursor/rules/<slug>.mdc`. */
export function renderCursorRule(skill: SkillSource): string {
  return [
    '---',
    `description: ${quote(skill.description)}`,
    `globs: ${skill.applyTo.join(', ')}`,
    'alwaysApply: false',
    '---',
    '',
    skill.body,
    '',
  ].join('\n');
}

/** The body of our managed section for Codex AGENTS.md (both skills inlined). */
export function renderAgentsSection(skills: readonly SkillSource[]): string {
  const parts = [
    '## MWNN Kanban skills',
    '',
    'Guidance for importing plans into, and authoring cards for, the MWNN Kanban board.',
  ];
  for (const skill of skills) {
    parts.push('', `### ${skill.name}`, '', skill.body);
  }
  return parts.join('\n');
}

/**
 * Insert or refresh a delimited managed block inside `existing`, leaving the
 * rest of the file untouched. Creates a minimal file when `existing` is empty.
 * Idempotent: running it again with the same `inner` yields the same output.
 */
export function upsertManagedBlock(existing: string, inner: string, marker: string = MANAGED_BLOCK_MARKER): string {
  const start = `<!-- ${marker}:start -->`;
  const end = `<!-- ${marker}:end -->`;
  const block = `${start}\n${inner}\n${end}`;
  const base = existing.replace(/\r\n?/g, '\n');

  const region = findManagedRegion(base, start, end);
  if (region) {
    const replaced = `${base.slice(0, region.from)}${block}${base.slice(region.to)}`;
    return `${replaced.trimEnd()}\n`;
  }

  const trimmed = base.trimEnd();
  if (trimmed.length === 0) {
    return `# AGENTS\n\n${block}\n`;
  }
  return `${trimmed}\n\n${block}\n`;
}

/**
 * Plan every file write needed to install `skills` for the given `envs`.
 * Dedicated per-tool files are rendered outright; Codex shares AGENTS.md via a
 * managed block folded into `existingAgentsMd` (its current content, if any).
 */
export function planSkillInstallation(
  skills: readonly SkillSource[],
  envs: readonly AiEnvironment[],
  existingAgentsMd: string | undefined,
): SkillInstallPlan {
  const writes: SkillFileWrite[] = [];
  const referencePathsByEnv: Record<AiEnvironment, string[]> = {
    copilot: [],
    codex: [],
    'claude-code': [],
    cursor: [],
  };

  for (const env of dedupe(envs)) {
    if (env === 'codex') {
      writes.push({ path: 'AGENTS.md', content: upsertManagedBlock(existingAgentsMd ?? '', renderAgentsSection(skills)) });
      referencePathsByEnv.codex.push('AGENTS.md');
      continue;
    }

    for (const skill of skills) {
      const path = skillFilePath(env, skill.slug);
      writes.push({ path, content: renderEnvFile(env, skill) });
      referencePathsByEnv[env].push(path);
    }
  }

  return { writes, referencePathsByEnv };
}

/** Where `Import Plan` installs the skills: into the workspace, or the user's home folder. */
export type SkillsInstallLocation = 'workspace' | 'user';

/** The contributed default for `mwnn-kanban.skillsInstallLocation`. */
export const DEFAULT_SKILLS_INSTALL_LOCATION: SkillsInstallLocation = 'user';

/**
 * Resolves the raw `mwnn-kanban.skillsInstallLocation` value. Only an explicit
 * `workspace` opts in to workspace installation; a missing or invalid value falls
 * back to the user-level default.
 */
export function resolveSkillsInstallLocation(value: unknown): SkillsInstallLocation {
  return value === 'workspace' ? 'workspace' : DEFAULT_SKILLS_INSTALL_LOCATION;
}

/** Absolute user-level folders, resolved by the extension host. */
export interface UserSkillFolders {
  /** The user's home folder. */
  readonly home: string;
  /** `CODEX_HOME`, when set; otherwise Codex uses `<home>/.codex`. */
  readonly codexHome?: string;
}

export interface UserSkillInstallPlan {
  /** Absolute paths, joined with the separator the supplied folders use. */
  readonly writes: readonly SkillFileWrite[];
  /** Absolute paths an agent for each environment should read. */
  readonly referencePathsByEnv: Readonly<Record<AiEnvironment, readonly string[]>>;
  /** Environments with no file-based user-level location (Cursor), so nothing was planned. */
  readonly skippedEnvs: readonly AiEnvironment[];
}

/** The Codex user-level `AGENTS.md`: `$CODEX_HOME/AGENTS.md`, else `~/.codex/AGENTS.md`. */
export function userCodexAgentsPath(folders: UserSkillFolders): string {
  const codexHome = folders.codexHome?.trim();
  return codexHome ? joinPath(codexHome, 'AGENTS.md') : joinPath(folders.home, '.codex', 'AGENTS.md');
}

/**
 * Where a skill lives at user level for `env`, or `undefined` when the tool has
 * no file-based user location (Cursor keeps user rules in its settings UI).
 */
export function userSkillFilePath(env: AiEnvironment, slug: string, folders: UserSkillFolders): string | undefined {
  switch (env) {
    case 'copilot':
    case 'claude-code':
      return userSkillMdPath(env, slug, folders);
    case 'codex':
      return userCodexAgentsPath(folders);
    case 'cursor':
      return undefined;
  }
}

/** The absolute user-level paths an agent working in `env` should read (none for Cursor). */
export function userReferencePathsForEnv(
  env: AiEnvironment,
  slugs: readonly string[],
  folders: UserSkillFolders,
): string[] {
  if (env === 'cursor') {
    return [];
  }
  if (env === 'codex') {
    return [userCodexAgentsPath(folders)];
  }
  return slugs.map((slug) => userSkillMdPath(env, slug, folders));
}

/** GitHub Copilot user-level `~/.copilot/skills/<slug>/SKILL.md`. */
export function renderCopilotSkill(skill: SkillSource): string {
  return renderClaudeSkill(skill);
}

/**
 * Like `upsertManagedBlock`, but for a file the user owns: every byte outside
 * the managed block is kept exactly as it was (line endings and trailing
 * whitespace included), and the block follows the file's line endings.
 * Idempotent: running it again with the same `inner` yields the same output.
 */
export function upsertManagedBlockPreserving(
  existing: string,
  inner: string,
  marker: string = MANAGED_BLOCK_MARKER,
): string {
  if (existing.trim().length === 0) {
    return upsertManagedBlock('', inner, marker);
  }

  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const start = `<!-- ${marker}:start -->`;
  const end = `<!-- ${marker}:end -->`;
  const block = [start, inner, end].join('\n').replace(/\r\n?/g, '\n').split('\n').join(eol);

  const region = findManagedRegion(existing, start, end);
  if (region) {
    return `${existing.slice(0, region.from)}${block}${existing.slice(region.to)}`;
  }

  const separator = existing.endsWith('\n') ? eol : `${eol}${eol}`;
  return `${existing}${separator}${block}${eol}`;
}

/**
 * Plan every user-level file write needed to install `skills` for `envs`.
 * Mirrors `planSkillInstallation`, but targets the user's home folder: Codex
 * gets a managed block folded into `existingCodexAgentsMd`, and Cursor is
 * reported as skipped because it has no file-based user rules.
 */
export function planUserSkillInstallation(
  skills: readonly SkillSource[],
  envs: readonly AiEnvironment[],
  folders: UserSkillFolders,
  existingCodexAgentsMd: string | undefined,
): UserSkillInstallPlan {
  const writes: SkillFileWrite[] = [];
  const skippedEnvs: AiEnvironment[] = [];
  const referencePathsByEnv: Record<AiEnvironment, string[]> = {
    copilot: [],
    codex: [],
    'claude-code': [],
    cursor: [],
  };

  for (const env of dedupe(envs)) {
    if (env === 'cursor') {
      skippedEnvs.push(env);
      continue;
    }

    if (env === 'codex') {
      const path = userCodexAgentsPath(folders);
      writes.push({ path, content: upsertManagedBlockPreserving(existingCodexAgentsMd ?? '', renderAgentsSection(skills)) });
      referencePathsByEnv.codex.push(path);
      continue;
    }

    for (const skill of skills) {
      const path = userSkillMdPath(env, skill.slug, folders);
      writes.push({ path, content: env === 'copilot' ? renderCopilotSkill(skill) : renderClaudeSkill(skill) });
      referencePathsByEnv[env].push(path);
    }
  }

  return { writes, referencePathsByEnv, skippedEnvs };
}

/** Home-relative folder holding each SKILL.md-format tool's user-level skills. */
const USER_SKILL_ROOTS = { copilot: '.copilot', 'claude-code': '.claude' } as const;

function userSkillMdPath(env: keyof typeof USER_SKILL_ROOTS, slug: string, folders: UserSkillFolders): string {
  return joinPath(folders.home, USER_SKILL_ROOTS[env], 'skills', slug, 'SKILL.md');
}

/** Join path segments onto `base` with the separator `base` already uses (`\` on Windows homes). */
function joinPath(base: string, ...segments: string[]): string {
  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  return [base.replace(/[\\/]+$/, ''), ...segments].join(separator);
}

function renderEnvFile(env: Exclude<AiEnvironment, 'codex'>, skill: SkillSource): string {
  switch (env) {
    case 'copilot':
      return renderCopilotInstruction(skill);
    case 'claude-code':
      return renderClaudeSkill(skill);
    case 'cursor':
      return renderCursorRule(skill);
  }
}

function dedupe(envs: readonly AiEnvironment[]): AiEnvironment[] {
  return [...new Set(envs)];
}

function frontScalar(frontmatter: string, key: string): string | undefined {
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match && match[1] === key) {
      const value = (match[2] ?? '').trim();
      return value.length > 0 ? unquote(value) : undefined;
    }
  }
  return undefined;
}

function frontList(frontmatter: string, key: string): string[] {
  const lines = frontmatter.split('\n');
  const values: string[] = [];
  let collecting = false;
  for (const line of lines) {
    if (!collecting) {
      if (line.match(new RegExp(`^${escapeRegExp(key)}:\\s*$`))) {
        collecting = true;
      }
      continue;
    }
    const item = line.match(/^\s+-\s*(.+)$/);
    if (item) {
      values.push(unquote((item[1] ?? '').trim()));
    } else if (line.trim().length > 0) {
      break;
    }
  }
  return values;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

/**
 * Locate the managed block: the first end marker, paired with the nearest start
 * marker before it. A start marker left without its end (a hand-edited file) is
 * then plain text, so a block appended after it never swallows the user content
 * in between on the next upsert.
 */
function findManagedRegion(text: string, start: string, end: string): { from: number; to: number } | undefined {
  for (let endAt = text.indexOf(end); endAt !== -1; endAt = text.indexOf(end, endAt + end.length)) {
    const startAt = text.lastIndexOf(start, endAt);
    if (startAt !== -1) {
      return { from: startAt, to: endAt + end.length };
    }
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
