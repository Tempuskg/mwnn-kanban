import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  AI_ENVIRONMENTS,
  MANAGED_BLOCK_MARKER,
  parseSkillDocument,
  planSkillInstallation,
  referencePathsForEnv,
  renderClaudeSkill,
  renderCopilotInstruction,
  renderCursorRule,
  skillFilePath,
  upsertManagedBlock,
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
