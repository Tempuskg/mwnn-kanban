/**
 * Installable AI "skills" for MWNN Kanban.
 *
 * The extension ships two skill documents (plan-import and card-authoring) and,
 * when a plan is imported, installs them into whichever AI tools a workspace
 * uses so the guidance travels with the project — on any machine. This module is
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

  const region = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (region.test(base)) {
    return `${base.replace(region, block).trimEnd()}\n`;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
