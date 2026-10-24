import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, suite, test } from 'node:test';
import type { FileSystemLike } from '../../src/boardStore';
import {
  parseSkillDocument,
  resolveSkillsInstallLocation,
  type AiEnvironment,
  type SkillSource,
  type UserSkillFolders,
} from '../../src/skills';
import { buildPlanImportPrompt } from '../../src/aiCards';
import {
  importPlanSkillReferencePaths,
  installImportPlanSkills,
  tryInstallImportPlanSkills,
  type UserFileIo,
} from '../../src/skillsInstall';

const SLUGS = ['mwnn-plan-import', 'mwnn-card-authoring'] as const;

/** The real bundled documents, so the test installs exactly what Import Plan ships. */
async function loadBundled(): Promise<SkillSource[]> {
  const skills: SkillSource[] = [];
  for (const slug of SLUGS) {
    skills.push(parseSkillDocument(slug, await fs.readFile(path.join('media', 'skills', `${slug}.md`), 'utf8')));
  }
  return skills;
}

/** A workspace-relative `FileSystemLike` over a real temp folder, like `createWorkspaceFileSystem`. */
function nodeWorkspaceFs(root: string): FileSystemLike {
  const resolve = (relative: string): string => path.join(root, ...relative.split('/').filter((s) => s.length > 0));
  return {
    exists: async (relative) => fs.stat(resolve(relative)).then(() => true, () => false),
    readFile: (relative) => fs.readFile(resolve(relative), 'utf8'),
    writeFile: (relative, content) => fs.writeFile(resolve(relative), content),
    deleteFile: (relative) => fs.rm(resolve(relative), { force: true }),
    readDirectory: (relative) => fs.readdir(resolve(relative)),
    createDirectory: async (relative) => {
      await fs.mkdir(resolve(relative), { recursive: true });
    },
  };
}

/** Records every user-level write and refuses any path outside the temp user root. */
function nodeUserFs(userRoot: string, written: string[]): UserFileIo {
  const guard = (filePath: string): void => {
    assert.ok(path.resolve(filePath).startsWith(path.resolve(userRoot) + path.sep), `user write escaped temp root: ${filePath}`);
  };
  return {
    read: async (filePath) => {
      guard(filePath);
      return fs.readFile(filePath, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return undefined;
        }
        throw error;
      });
    },
    write: async (filePath, content) => {
      guard(filePath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
      written.push(filePath);
    },
  };
}

/** Every file under `root` (forward-slash relative path → content). */
async function snapshot(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        files.set(path.relative(root, full).split(path.sep).join('/'), await fs.readFile(full, 'utf8'));
      }
    }
  };
  await walk(root);
  return files;
}

suite('Import Plan skill installation scope isolation', () => {
  let tempRoot: string;
  let workspace: string;
  let home: string;
  let codexHome: string;
  let folders: UserSkillFolders;
  let skills: SkillSource[];

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-skills-scope-'));
    workspace = path.join(tempRoot, 'workspace');
    home = path.join(tempRoot, 'home');
    codexHome = path.join(tempRoot, 'codex-home');
    await fs.mkdir(home, { recursive: true });
    folders = { home, codexHome };
    skills = await loadBundled();

    // A workspace that every AI environment's markers detect, with existing instruction files.
    await fs.mkdir(path.join(workspace, '.github'), { recursive: true });
    await fs.writeFile(path.join(workspace, '.github', 'copilot-instructions.md'), '# Repo copilot rules\n');
    await fs.writeFile(path.join(workspace, 'AGENTS.md'), '# Repo agents\n\nKeep this.\n');
    await fs.mkdir(path.join(workspace, '.claude'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'CLAUDE.md'), '# Repo claude\n');
    await fs.mkdir(path.join(workspace, '.cursor'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  async function run(location: unknown, providerEnv: AiEnvironment, written: string[]) {
    const resolved = resolveSkillsInstallLocation(location);
    const skipped = await installImportPlanSkills({
      location: resolved,
      skills,
      workspaceFs: nodeWorkspaceFs(workspace),
      providerEnv,
      userFolders: folders,
      userFs: nodeUserFs(tempRoot, written),
      slugs: SLUGS,
    });
    return { resolved, skipped, references: importPlanSkillReferencePaths(resolved, providerEnv, SLUGS, folders) };
  }

  for (const providerEnv of ['claude-code', 'copilot', 'codex'] as const) {
    test(`default mode installs both documents only in temp user targets (handoff to ${providerEnv})`, async () => {
      const before = await snapshot(workspace);
      const written: string[] = [];

      const { resolved, skipped, references } = await run(undefined, providerEnv, written);

      assert.equal(resolved, 'user');
      assert.deepEqual(await snapshot(workspace), before, 'workspace instruction files must be unchanged');
      assert.deepEqual(skipped, ['cursor']);

      const expected = [
        path.join(home, '.copilot', 'skills', 'mwnn-plan-import', 'SKILL.md'),
        path.join(home, '.copilot', 'skills', 'mwnn-card-authoring', 'SKILL.md'),
        path.join(codexHome, 'AGENTS.md'),
        path.join(home, '.claude', 'skills', 'mwnn-plan-import', 'SKILL.md'),
        path.join(home, '.claude', 'skills', 'mwnn-card-authoring', 'SKILL.md'),
      ];
      assert.deepEqual([...written].sort(), [...expected].sort());

      for (const slug of SLUGS) {
        for (const tool of ['.copilot', '.claude']) {
          const content = await fs.readFile(path.join(home, tool, 'skills', slug, 'SKILL.md'), 'utf8');
          assert.match(content, new RegExp(`^---\\nname: ${slug}\\n`));
        }
      }
      const codexAgents = await fs.readFile(path.join(codexHome, 'AGENTS.md'), 'utf8');
      for (const skill of skills) {
        assert.ok(codexAgents.includes(`### ${skill.name}`), `Codex AGENTS.md is missing ${skill.name}`);
      }

      // Handoff references are absolute user paths for the chosen provider, and each exists.
      assert.ok(references.length > 0);
      for (const reference of references) {
        assert.ok(path.isAbsolute(reference), reference);
        assert.ok(reference.startsWith(tempRoot), reference);
        await fs.access(reference);
      }
      if (providerEnv === 'codex') {
        assert.deepEqual(references, [path.join(codexHome, 'AGENTS.md')]);
      }
    });
  }

  test('default mode adds the handoff provider even when the workspace has no AI markers', async () => {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.mkdir(workspace, { recursive: true });
    const written: string[] = [];

    const { skipped, references } = await run(undefined, 'claude-code', written);

    assert.deepEqual(await snapshot(workspace), new Map());
    assert.deepEqual(skipped, []);
    const expected = SLUGS.map((slug) => path.join(home, '.claude', 'skills', slug, 'SKILL.md'));
    assert.deepEqual(written, expected);
    assert.deepEqual(references, expected);
  });

  test('a repeated default import rewrites nothing', async () => {
    await run(undefined, 'codex', []);
    const again: string[] = [];
    await run(undefined, 'codex', again);
    assert.deepEqual(again, []);
  });

  test('default mode keeps unrelated user Codex instructions and other user files byte for byte', async () => {
    const unrelated = '# My Codex rules\n\nAlways run tests.\n';
    await fs.mkdir(codexHome, { recursive: true });
    await fs.writeFile(path.join(codexHome, 'AGENTS.md'), unrelated);
    const otherSkill = path.join(home, '.claude', 'skills', 'my-own-skill', 'SKILL.md');
    await fs.mkdir(path.dirname(otherSkill), { recursive: true });
    await fs.writeFile(otherSkill, '---\nname: my-own-skill\n---\nMine.\n');

    await run(undefined, 'codex', []);

    const agents = await fs.readFile(path.join(codexHome, 'AGENTS.md'), 'utf8');
    assert.ok(agents.startsWith(unrelated), 'unrelated Codex instructions are kept');
    for (const skill of skills) {
      assert.ok(agents.includes(`### ${skill.name}`));
    }
    assert.equal(await fs.readFile(otherSkill, 'utf8'), '---\nname: my-own-skill\n---\nMine.\n');

    const again: string[] = [];
    await run(undefined, 'codex', again);
    assert.deepEqual(again, [], 'a repeat over preserved content rewrites nothing');
    assert.equal(await fs.readFile(path.join(codexHome, 'AGENTS.md'), 'utf8'), agents);
  });

  test('default mode without CODEX_HOME writes the Codex block under ~/.codex', async () => {
    folders = { home };
    const written: string[] = [];

    const { skipped, references } = await run(undefined, 'codex', written);

    const agentsPath = path.join(home, '.codex', 'AGENTS.md');
    assert.ok(written.includes(agentsPath), 'Codex block goes to ~/.codex/AGENTS.md');
    await assert.rejects(fs.access(codexHome));
    assert.deepEqual(skipped, ['cursor']);
    assert.deepEqual(references, [agentsPath]);
  });

  for (const providerEnv of ['claude-code', 'copilot', 'codex'] as const) {
    test(`explicit workspace mode writes workspace targets and leaves the user folder empty (handoff to ${providerEnv})`, async () => {
      const written: string[] = [];

      const { resolved, skipped, references } = await run('workspace', providerEnv, written);

      assert.equal(resolved, 'workspace');
      assert.deepEqual(skipped, []);
      assert.deepEqual(written, [], 'no user-level writes in workspace mode');
      assert.deepEqual(await snapshot(home), new Map());
      await assert.rejects(fs.access(codexHome));

      const after = await snapshot(workspace);
      for (const slug of SLUGS) {
        assert.ok(after.has(`.github/instructions/${slug}.instructions.md`), `copilot ${slug}`);
        assert.ok(after.has(`.claude/skills/${slug}/SKILL.md`), `claude ${slug}`);
        assert.ok(after.has(`.cursor/rules/${slug}.mdc`), `cursor ${slug}`);
      }
      const agents = after.get('AGENTS.md') ?? '';
      assert.ok(agents.startsWith('# Repo agents\n\nKeep this.\n'), 'existing AGENTS.md content is kept');
      for (const skill of skills) {
        assert.ok(agents.includes(`### ${skill.name}`));
      }
      assert.equal(after.get('.github/copilot-instructions.md'), '# Repo copilot rules\n');

      // Handoff references are workspace-relative and point at files that now exist.
      assert.ok(references.length > 0);
      for (const reference of references) {
        assert.ok(!path.isAbsolute(reference), reference);
        assert.ok(after.has(reference), `missing referenced workspace file ${reference}`);
      }
    });
  }
  for (const providerEnv of ['claude-code', 'copilot', 'codex'] as const) {
    test(`a failed default user install warns and still yields a self-contained handoff without workspace writes (handoff to ${providerEnv})`, async () => {
      const before = await snapshot(workspace);
      const attempted: string[] = [];
      const failingUserFs: UserFileIo = {
        read: async () => undefined,
        write: async (filePath) => {
          attempted.push(filePath);
          throw new Error('EACCES: permission denied');
        },
      };

      const location = resolveSkillsInstallLocation(undefined);
      const outcome = await tryInstallImportPlanSkills({
        location,
        loadSkills: async () => skills,
        workspaceFs: nodeWorkspaceFs(workspace),
        providerEnv,
        userFolders: folders,
        userFs: failingUserFs,
        slugs: SLUGS,
      });

      assert.equal(location, 'user');
      assert.ok(attempted.length > 0, 'the user target write was attempted');
      assert.ok(outcome.warning?.includes('your user folder'), outcome.warning);
      assert.ok(outcome.warning?.includes('EACCES: permission denied'), outcome.warning);
      assert.ok(outcome.warning?.includes('the prompt is self-contained'), outcome.warning);

      // No silent fallback: the workspace is byte-for-byte unchanged and the user folders stay empty.
      assert.deepEqual(await snapshot(workspace), before);
      assert.deepEqual(await snapshot(home), new Map());
      await assert.rejects(fs.access(codexHome));

      // The handoff still carries the essential card contract and decomposition rules inline.
      const prompt = buildPlanImportPrompt(
        { kind: 'file', path: 'docs/plan.md' },
        { columnId: 'col-backlog', columnTitle: 'Backlog', existingCount: 0 },
        '.mwnn',
        importPlanSkillReferencePaths(location, providerEnv, SLUGS, folders),
      );
      assert.ok(prompt.includes('docs/plan.md'));
      assert.ok(prompt.includes('Write each card as a markdown file at .mwnn/cards/<id>.md'));
      assert.ok(prompt.includes('column: col-backlog'));
      assert.ok(prompt.includes('## Acceptance criteria'));
      assert.ok(prompt.includes('Decompose with judgment'));
      assert.ok(prompt.includes('STATUS: DONE'));
      assert.ok(!prompt.includes(workspace), 'the prompt never points at a workspace fallback install');
    });
  }
});
