import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  AI_ENVIRONMENTS,
  MANAGED_BLOCK_MARKER,
  parseSkillDocument,
  planSkillInstallation,
  planUserSkillInstallation,
  referencePathsForEnv,
  renderClaudeSkill,
  renderCopilotInstruction,
  renderCopilotSkill,
  renderCursorRule,
  skillFilePath,
  upsertManagedBlock,
  upsertManagedBlockPreserving,
  userCodexAgentsPath,
  userReferencePathsForEnv,
  userSkillFilePath,
  type SkillSource,
} from '../../src/skills';

const SAMPLE = [
  '---',
  'name: "MWNN Plan Import"',
  'description: "Turn a plan into cards."',
  'applyTo:',
  '  - ".mwnn/cards/**/*.md"',
  '  - ".mwnn/columns.json"',
  '---',
  '',
  '# MWNN Plan Import',
  '',
  'Body line one.',
  'Body line two.',
  '',
].join('\n');

function parseSample(): SkillSource {
  return parseSkillDocument('mwnn-plan-import', SAMPLE);
}

suite('skill document parsing', () => {
  test('extracts name, description, applyTo, and the trimmed body', () => {
    const skill = parseSample();
    assert.equal(skill.slug, 'mwnn-plan-import');
    assert.equal(skill.name, 'MWNN Plan Import');
    assert.equal(skill.description, 'Turn a plan into cards.');
    assert.deepEqual(skill.applyTo, ['.mwnn/cards/**/*.md', '.mwnn/columns.json']);
    assert.equal(skill.body, '# MWNN Plan Import\n\nBody line one.\nBody line two.');
  });

  test('falls back to the slug and empty metadata when frontmatter is absent', () => {
    const skill = parseSkillDocument('bare', 'Just a body.');
    assert.equal(skill.name, 'bare');
    assert.equal(skill.description, '');
    assert.deepEqual(skill.applyTo, []);
    assert.equal(skill.body, 'Just a body.');
  });
});

suite('per-tool skill rendering', () => {
  test('Copilot instruction keeps name/description/applyTo frontmatter and body', () => {
    const content = renderCopilotInstruction(parseSample());
    assert.match(content, /^---\n/);
    assert.match(content, /name: "MWNN Plan Import"/);
    assert.match(content, /description: "Turn a plan into cards\."/);
    assert.match(content, /applyTo:\n {2}- "\.mwnn\/cards\/\*\*\/\*\.md"\n {2}- "\.mwnn\/columns\.json"/);
    assert.match(content, /# MWNN Plan Import/);
  });

  test('Claude SKILL.md uses the slug as name and drops applyTo', () => {
    const content = renderClaudeSkill(parseSample());
    assert.match(content, /name: mwnn-plan-import/);
    assert.match(content, /description: "Turn a plan into cards\."/);
    assert.doesNotMatch(content, /applyTo/);
    assert.match(content, /Body line one\./);
  });

  test('Cursor rule emits description, comma-joined globs, and alwaysApply', () => {
    const content = renderCursorRule(parseSample());
    assert.match(content, /description: "Turn a plan into cards\."/);
    assert.match(content, /globs: \.mwnn\/cards\/\*\*\/\*\.md, \.mwnn\/columns\.json/);
    assert.match(content, /alwaysApply: false/);
    assert.match(content, /Body line two\./);
  });
});

suite('managed block upsert', () => {
  const inner = 'GENERATED BODY';

  test('creates a minimal file when there is no existing content', () => {
    const result = upsertManagedBlock('', inner);
    assert.match(result, new RegExp(`<!-- ${MANAGED_BLOCK_MARKER}:start -->\\nGENERATED BODY\\n<!-- ${MANAGED_BLOCK_MARKER}:end -->`));
    assert.match(result, /# AGENTS/);
  });

  test('appends the block below existing content without disturbing it', () => {
    const result = upsertManagedBlock('# My Agents\n\nKeep me.\n', inner);
    assert.match(result, /# My Agents\n\nKeep me\./);
    assert.match(result, /<!-- mwnn-kanban:skills:start -->\nGENERATED BODY\n<!-- mwnn-kanban:skills:end -->/);
  });

  test('replaces only the managed block on a re-run and is idempotent', () => {
    const first = upsertManagedBlock('# My Agents\n\nKeep me.\n', 'OLD');
    const second = upsertManagedBlock(first, inner);
    assert.match(second, /# My Agents\n\nKeep me\./);
    assert.match(second, /GENERATED BODY/);
    assert.doesNotMatch(second, /OLD/);
    // Applying the same content again changes nothing.
    assert.equal(upsertManagedBlock(second, inner), second);
  });
});

suite('install planning', () => {
  const skills = [parseSample(), parseSkillDocument('mwnn-card-authoring', '---\nname: "MWNN Card Authoring"\ndescription: "Card contract."\n---\n\nCard body.')];

  test('includes every supported provider environment', () => {
    assert.deepEqual([...AI_ENVIRONMENTS], ['copilot', 'codex', 'claude-code', 'cursor']);
  });

  test('skillFilePath maps each environment to its native location', () => {
    assert.equal(skillFilePath('copilot', 'x'), '.github/instructions/x.instructions.md');
    assert.equal(skillFilePath('claude-code', 'x'), '.claude/skills/x/SKILL.md');
    assert.equal(skillFilePath('cursor', 'x'), '.cursor/rules/x.mdc');
    assert.equal(skillFilePath('codex', 'x'), 'AGENTS.md');
  });

  test('referencePathsForEnv lists per-skill files, or AGENTS.md for Codex', () => {
    assert.deepEqual(referencePathsForEnv('copilot', ['a', 'b']), [
      '.github/instructions/a.instructions.md',
      '.github/instructions/b.instructions.md',
    ]);
    assert.deepEqual(referencePathsForEnv('codex', ['a', 'b']), ['AGENTS.md']);
  });

  test('plans dedicated files per tool and a single AGENTS.md managed block', () => {
    const plan = planSkillInstallation(skills, ['copilot', 'claude-code', 'cursor', 'codex', 'copilot'], '# Existing\n');
    const paths = plan.writes.map((write) => write.path);

    // Two skills each for the dedicated tools, one shared AGENTS.md for Codex, no duplicate copilot pass.
    assert.deepEqual(paths, [
      '.github/instructions/mwnn-plan-import.instructions.md',
      '.github/instructions/mwnn-card-authoring.instructions.md',
      '.claude/skills/mwnn-plan-import/SKILL.md',
      '.claude/skills/mwnn-card-authoring/SKILL.md',
      '.cursor/rules/mwnn-plan-import.mdc',
      '.cursor/rules/mwnn-card-authoring.mdc',
      'AGENTS.md',
    ]);

    const agents = plan.writes.find((write) => write.path === 'AGENTS.md');
    assert.ok(agents);
    assert.match(agents.content, /# Existing/);
    assert.match(agents.content, /## MWNN Kanban skills/);
    assert.match(agents.content, /### MWNN Plan Import/);
    assert.match(agents.content, /### MWNN Card Authoring/);

    assert.deepEqual(plan.referencePathsByEnv.codex, ['AGENTS.md']);
    assert.deepEqual(plan.referencePathsByEnv['claude-code'], [
      '.claude/skills/mwnn-plan-import/SKILL.md',
      '.claude/skills/mwnn-card-authoring/SKILL.md',
    ]);
  });
});

suite('user-level install planning', () => {
  const skills = [parseSample(), parseSkillDocument('mwnn-card-authoring', '---\nname: "MWNN Card Authoring"\ndescription: "Card contract."\n---\n\nCard body.')];
  const posix = { home: '/home/ada' };
  const windows = { home: 'C:\\Users\\ada' };

  test('maps Claude Code and Copilot to SKILL.md under the home folder', () => {
    assert.equal(userSkillFilePath('claude-code', 'x', posix), '/home/ada/.claude/skills/x/SKILL.md');
    assert.equal(userSkillFilePath('copilot', 'x', posix), '/home/ada/.copilot/skills/x/SKILL.md');
    assert.equal(userSkillFilePath('claude-code', 'x', windows), 'C:\\Users\\ada\\.claude\\skills\\x\\SKILL.md');
    assert.equal(userSkillFilePath('cursor', 'x', posix), undefined);
  });

  test('builds the Codex AGENTS.md path from CODEX_HOME, else ~/.codex', () => {
    assert.equal(userCodexAgentsPath(posix), '/home/ada/.codex/AGENTS.md');
    assert.equal(userCodexAgentsPath({ home: '/home/ada', codexHome: '/opt/codex/' }), '/opt/codex/AGENTS.md');
    assert.equal(userCodexAgentsPath({ home: '/home/ada', codexHome: '  ' }), '/home/ada/.codex/AGENTS.md');
    assert.equal(userSkillFilePath('codex', 'x', windows), 'C:\\Users\\ada\\.codex\\AGENTS.md');
  });

  test('plans Claude and Copilot SKILL.md files plus the Codex block, and skips Cursor', () => {
    const plan = planUserSkillInstallation(skills, ['claude-code', 'copilot', 'cursor', 'codex', 'claude-code'], posix, undefined);
    assert.deepEqual(
      plan.writes.map((write) => write.path),
      [
        '/home/ada/.claude/skills/mwnn-plan-import/SKILL.md',
        '/home/ada/.claude/skills/mwnn-card-authoring/SKILL.md',
        '/home/ada/.copilot/skills/mwnn-plan-import/SKILL.md',
        '/home/ada/.copilot/skills/mwnn-card-authoring/SKILL.md',
        '/home/ada/.codex/AGENTS.md',
      ],
    );
    assert.deepEqual(plan.skippedEnvs, ['cursor']);
    assert.deepEqual(plan.referencePathsByEnv.cursor, []);
    assert.deepEqual(plan.referencePathsByEnv.codex, ['/home/ada/.codex/AGENTS.md']);
    assert.deepEqual(plan.referencePathsByEnv['claude-code'], [
      '/home/ada/.claude/skills/mwnn-plan-import/SKILL.md',
      '/home/ada/.claude/skills/mwnn-card-authoring/SKILL.md',
    ]);
    assert.deepEqual(plan.referencePathsByEnv.copilot, [
      '/home/ada/.copilot/skills/mwnn-plan-import/SKILL.md',
      '/home/ada/.copilot/skills/mwnn-card-authoring/SKILL.md',
    ]);
    assert.ok(plan.writes.every((write) => !write.path.includes('.cursor')));
  });

  test('renders Claude with renderClaudeSkill and Copilot in SKILL.md format', () => {
    const plan = planUserSkillInstallation(skills, ['claude-code', 'copilot'], posix, undefined);
    const [sample] = skills;
    assert.ok(sample);
    assert.equal(plan.writes[0]?.content, renderClaudeSkill(sample));
    const copilot = plan.writes[2]?.content ?? '';
    assert.equal(copilot, renderCopilotSkill(sample));
    assert.match(copilot, /^---\nname: mwnn-plan-import\ndescription: "Turn a plan into cards\."\n---\n\n# MWNN Plan Import/);
    assert.doesNotMatch(copilot, /applyTo/);
  });

  test('reference paths match the planned paths for each environment', () => {
    const plan = planUserSkillInstallation(skills, ['copilot', 'codex', 'claude-code'], windows, undefined);
    for (const env of ['copilot', 'codex', 'claude-code'] as const) {
      assert.deepEqual(userReferencePathsForEnv(env, ['mwnn-plan-import', 'mwnn-card-authoring'], windows), plan.referencePathsByEnv[env]);
    }
    assert.deepEqual(userReferencePathsForEnv('cursor', ['a'], windows), []);
  });

  test('upserts the Codex block preserving outside content byte for byte, idempotently', () => {
    const existing = '# Mine\r\n\r\nKeep   me.  \r\n';
    const plan = planUserSkillInstallation(skills, ['codex'], posix, existing);
    const first = plan.writes[0]?.content ?? '';
    assert.ok(first.startsWith(existing));
    assert.match(first, /<!-- mwnn-kanban:skills:start -->\r\n## MWNN Kanban skills\r\n/);
    const second = planUserSkillInstallation(skills, ['codex'], posix, first).writes[0]?.content;
    assert.equal(second, first);
  });

  test('preserving upsert replaces only the block and creates a minimal file when empty', () => {
    assert.equal(upsertManagedBlockPreserving('', 'BODY'), upsertManagedBlock('', 'BODY'));
    const before = 'top\n<!-- mwnn-kanban:skills:start -->\nOLD\n<!-- mwnn-kanban:skills:end -->\nbottom';
    assert.equal(
      upsertManagedBlockPreserving(before, 'NEW'),
      'top\n<!-- mwnn-kanban:skills:start -->\nNEW\n<!-- mwnn-kanban:skills:end -->\nbottom',
    );
    assert.equal(
      upsertManagedBlockPreserving('no newline', 'B'),
      'no newline\n\n<!-- mwnn-kanban:skills:start -->\nB\n<!-- mwnn-kanban:skills:end -->\n',
    );
  });

  test('a start marker left without its end never lets a later upsert eat user content', () => {
    const stale = 'top\n<!-- mwnn-kanban:skills:start -->\nUSER NOTES\n';
    for (const upsert of [upsertManagedBlockPreserving, upsertManagedBlock]) {
      const first = upsert(stale, 'ONE');
      const second = upsert(first, 'TWO');
      assert.match(second, /<!-- mwnn-kanban:skills:start -->\nUSER NOTES\n/);
      assert.match(second, /<!-- mwnn-kanban:skills:start -->\nTWO\n<!-- mwnn-kanban:skills:end -->\n$/);
      assert.doesNotMatch(second, /ONE/);
      assert.equal(upsert(second, 'TWO'), second);
    }
  });
});
