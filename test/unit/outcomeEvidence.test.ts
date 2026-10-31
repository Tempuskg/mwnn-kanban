import { runIndependentEvidenceCommand } from '../../src/agentCliHandoff';
import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createOutcomeEvidenceFactory, digest, parseVerificationProfile, snapshotRevision, resolveNpmCommand,
  type EvidenceCommandResult, type OutcomeEvidenceDeps, type OutcomeReceipt,
  type RevisionSnapshot } from '../../src/outcomeEvidence';
import type { Card } from '../../src/types';

const exec = promisify(execFile);
const card = (): Card => ({ id: 'card-test', title: 'Implement feature', createdAt: 1,
  description: 'Deliver the feature.', acceptanceCriteria: '- [ ] Feature behaves correctly' });
const profile = () => JSON.stringify({ version: 1,
  criteria: [{ text: 'Feature behaves correctly', checks: ['tests'] }] });
const success = (): EvidenceCommandResult => ({ started: true, cancelled: false,
  exitCode: 0, stdout: '# tests 2\n# pass 2\n# fail 0\n# cancelled 0', stderr: '' });

function fixture(overrides: Partial<OutcomeEvidenceDeps> = {}) {
  let current: Card | undefined = card();
  let code = 'after-agent';
  let mapping = profile();
  let instructions = 'stable instructions';
  let ids = 0;
  const commands: string[] = [];
  const receipts: OutcomeReceipt[] = [];
  const controller = new AbortController();
  const revision = (): RevisionSnapshot => ({ root: '/project', head: 'head', digest: digest(code) });
  const factory = createOutcomeEvidenceFactory({ snapshot: async () => revision(),
    readText: async (file) => {
      if (file.endsWith('verification.json')) { return mapping; }
      if (file.endsWith('package.json')) { return JSON.stringify({ scripts: {
        'compile-tests': 'tsc', compile: 'webpack', test: 'node --test', lint: 'eslint',
      } }); }
      return instructions;
    },
    run: async (command) => { commands.push(command.id); return success(); },
    persist: async (receipt) => { receipts.push(receipt); return '/host/receipt.json'; },
    now: () => new Date('2026-10-26T17:00:00Z'), id: () => `id-${++ids}`, ...overrides });
  return { commands, receipts, controller,
    setCard: (value: Card | undefined) => { current = value; },
    setCode: (value: string) => { code = value; },
    setProfile: (value: string) => { mapping = value; },
    setInstructions: (value: string) => { instructions = value; },
    begin: () => factory({ cwd: '/project', card: card(), prompt: 'exact prompt',
      stage: 'implementation', signal: controller.signal, reloadCard: async () => current }) };
}

suite('independent outcome evidence', () => {
  test('binds a host receipt to exact inputs and the checked dirty code', async () => {
    const f = fixture();
    const session = await f.begin();
    f.setCode('implemented');
    const result = await session.verify();
    assert.equal(result.valid, true);
    assert.deepEqual(f.commands, ['compile-tests', 'compile', 'tests', 'lint', 'diff']);
    if (result.valid) {
      assert.equal(result.receipt.inputRevision.digest, digest('after-agent'));
      assert.equal(result.receipt.checkedRevision.digest, digest('implemented'));
      assert.equal(result.receipt.cardId, 'card-test');
      assert.equal(result.receipt.runId, 'id-1');
      assert.equal(result.receipt.attemptId, 'id-2');
      assert.equal(result.receipt.checks[2]?.tests, 2);
      assert.equal(result.receiptPath, '/host/receipt.json');
    }
    assert.equal((await session.verify()).valid, false);
    assert.equal(f.receipts.length, 1);
  });

  test('checkbox and Activity updates do not rewrite the acceptance requirements', async () => {
    const f = fixture();
    const session = await f.begin();
    f.setCard({ ...card(), acceptanceCriteria: '- [x] Feature behaves correctly', activity: 'STATUS: DONE' });
    assert.equal((await session.verify()).valid, true);
  });

  test('rejects changed requirements and a deleted card before running checks', async () => {
    for (const value of [undefined, { ...card(), title: 'Different task' },
      { ...card(), acceptanceCriteria: '- [ ] Different behavior' }]) {
      const f = fixture();
      const session = await f.begin();
      f.setCard(value);
      assert.equal((await session.verify()).valid, false);
      assert.equal(f.commands.length, 0);
    }
  });

  test('refuses missing inputs instead of trusting DONE/PASS', async () => {
    const f = fixture({ readText: async () => { throw new Error('missing'); } });
    const session = await f.begin();
    assert.equal((await session.verify()).valid, false);
    assert.equal(f.commands.length, 0);
  });

  test('rejects unmapped, manual and empty criteria', async () => {
    for (const criteria of [[{ text: 'Other criterion', checks: ['tests'] }],
      [{ text: 'Feature behaves correctly', checks: ['tests'], human: true }],
      [{ text: 'Feature behaves correctly', checks: [] }]]) {
      const f = fixture();
      f.setProfile(JSON.stringify({ version: 1, criteria }));
      assert.equal((await (await f.begin()).verify()).valid, false);
      assert.equal(f.commands.length, 0);
    }
  });

  test('rejects changed profiles or instructions after the agent runs', async () => {
    for (const change of ['profile', 'instructions']) {
      const f = fixture();
      const session = await f.begin();
      if (change === 'profile') { f.setProfile(`${profile()}\n`); }
      else { f.setInstructions('changed'); }
      assert.equal((await session.verify()).valid, false);
      assert.equal(f.commands.length, 0);
    }
  });

  test('failed, cancelled, unknown, empty and errored checks never produce receipts', async () => {
    for (const result of [ { ...success(), exitCode: 1 }, { ...success(), exitCode: null },
      { ...success(), cancelled: true }, { ...success(), started: false },
      { ...success(), error: 'failure' }, { ...success(), stdout: '# tests 0\n# pass 0' },
      { ...success(), stdout: 'STATUS: DONE\nVERIFY: PASS' } ]) {
      const f = fixture({ run: async () => result });
      assert.equal((await (await f.begin()).verify()).valid, false);
      assert.equal(f.receipts.length, 0);
    }
  });

  test('cancellation before checks never starts a process', async () => {
    const f = fixture();
    const session = await f.begin();
    f.controller.abort();
    assert.equal((await session.verify()).valid, false);
    assert.equal(f.commands.length, 0);
  });

  test('cancellation reaches an in-flight independent check', async () => {
    const f = fixture({ run: async (_command, signal) => {
      f.controller.abort();
      assert.equal(signal.aborted, true);
      return success();
    } });
    assert.equal((await (await f.begin()).verify()).valid, false);
    assert.equal(f.receipts.length, 0);
  });

  test('a code edit while checks run invalidates the result', async () => {
    const f = fixture({ run: async () => { f.setCode('edited-during-checks'); return success(); } });
    assert.equal((await (await f.begin()).verify()).valid, false);
    assert.equal(f.receipts.length, 0);
  });

  test('a requirement edit while checks run invalidates the result', async () => {
    const f = fixture({ run: async () => { f.setCard({ ...card(), description: 'Changed' }); return success(); } });
    assert.equal((await (await f.begin()).verify()).valid, false);
    assert.equal(f.receipts.length, 0);
  });

  test('receipt write failure cannot accept completion', async () => {
    const f = fixture({ persist: async () => { throw new Error('private token must not be logged'); } });
    const result = await (await f.begin()).verify();
    assert.equal(result.valid, false);
    assert.doesNotMatch(JSON.stringify(result), /private token/);
  });

  test('runs configured focused tests after compiling and before the full suite', async () => {
    const f = fixture();
    f.setProfile(JSON.stringify({ version: 1, focusedTests: ['dist-test/test/unit/feature.test.js'],
      criteria: [{ text: 'Feature behaves correctly', checks: ['focused-tests'] }] }));
    assert.equal((await (await f.begin()).verify()).valid, true);
    assert.deepEqual(f.commands, ['compile-tests', 'compile', 'focused-tests', 'tests', 'lint', 'diff']);
  });

  test('requires focused tests when the mapping names them', async () => {
    const f = fixture();
    f.setProfile(JSON.stringify({ version: 1,
      criteria: [{ text: 'Feature behaves correctly', checks: ['focused-tests'] }] }));
    assert.equal((await (await f.begin()).verify()).valid, false);
  });

  test('receipts hash output without retaining secrets or prompt text', async () => {
    const f = fixture({ run: async () => ({ ...success(), stderr: 'secret-value' }) });
    const result = await (await f.begin()).verify();
    assert.equal(result.valid, true);
    assert.doesNotMatch(JSON.stringify(f.receipts), /secret-value|exact prompt/);
  });
});

suite('verification profile validation', () => {
  test('rejects malformed, duplicate, unknown and escaping mappings', () => {
    for (const value of ['null', '{}', '{', JSON.stringify({ version: 2, criteria: [] }),
      JSON.stringify({ version: 1, criteria: [{ text: 'Task', checks: ['unknown'] }] }),
      JSON.stringify({ version: 1, criteria: [{ text: 'Task', checks: [] }, { text: 'Task', checks: [] }] }),
      JSON.stringify({ version: 1, criteria: [{ text: 'Task', checks: [] }],
        focusedTests: ['dist-test/test/../../outside.test.js'] })]) {
      assert.throws(() => parseVerificationProfile(value));
    }
  });
});

suite('repository revision fingerprints', () => {
  test('tracks dirty, staged, deleted, untracked files and commits while excluding Activity', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-revision-'));
    const git = (args: string[]) => exec('git', args, { cwd: root, windowsHide: true });
    try {
      await git(['init']);
      await fs.writeFile(path.join(root, 'source.ts'), 'original');
      await fs.writeFile(path.join(root, '.gitignore'), 'generated/\n');
      await git(['add', '.']);
      await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'initial']);
      const initial = await snapshotRevision(root);
      await fs.writeFile(path.join(root, 'source.ts'), 'dirty');
      const dirty = await snapshotRevision(root);
      assert.notEqual(initial.digest, dirty.digest);
      await git(['add', 'source.ts']);
      assert.equal((await snapshotRevision(root)).digest, dirty.digest);
      await fs.writeFile(path.join(root, 'untracked.ts'), 'new');
      const untracked = await snapshotRevision(root);
      assert.notEqual(dirty.digest, untracked.digest);
      await fs.mkdir(path.join(root, '.mwnn', 'cards'), { recursive: true });
      await fs.writeFile(path.join(root, '.mwnn', 'cards', 'card-test.md'), 'STATUS: DONE');
      assert.equal((await snapshotRevision(root)).digest, untracked.digest);
      await fs.mkdir(path.join(root, '.tasks', 'cards'), { recursive: true });
      await fs.writeFile(path.join(root, '.tasks', 'cards', 'card-test.md'), 'before');
      const customBoard = await snapshotRevision(root, '.tasks');
      await fs.writeFile(path.join(root, '.tasks', 'cards', 'card-test.md'), 'after Activity append');
      assert.equal((await snapshotRevision(root, '.tasks')).digest, customBoard.digest);
      await fs.rm(path.join(root, '.tasks'), { recursive: true });      await fs.mkdir(path.join(root, 'generated'));
      await fs.writeFile(path.join(root, 'generated', 'ignored.js'), 'build output');
      assert.equal((await snapshotRevision(root)).digest, untracked.digest);
      await fs.unlink(path.join(root, 'source.ts'));
      assert.notEqual((await snapshotRevision(root)).digest, untracked.digest);
      await fs.writeFile(path.join(root, 'source.ts'), 'dirty');
      await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'changed']);
      assert.notEqual((await snapshotRevision(root)).head, initial.head);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});

suite('host verification boundaries', () => {
  test('times out an independent check and refuses its eventual zero exit', async () => {
    const f = fixture({ checkTimeoutMs: 5, run: async (_command, signal) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      return success();
    } });
    assert.equal((await (await f.begin()).verify()).valid, false);
    assert.equal(f.receipts.length, 0);
  });

  test('rejects code changed during receipt persistence', async () => {
    const f = fixture({ persist: async () => { f.setCode('changed-after-checks'); return '/host/receipt.json'; } });
    assert.equal((await (await f.begin()).verify()).valid, false);
  });

  test('project identity separates the same card id across repositories', async () => {
    const first = fixture();
    const second = fixture({ snapshot: async () => ({ root: '/other-project', head: 'head', digest: 'other' }) });
    const a = await (await first.begin()).verify();
    const b = await (await second.begin()).verify();
    assert.equal(a.valid && b.valid, true);
    if (a.valid && b.valid) { assert.notEqual(a.receipt.projectId, b.receipt.projectId); }
  });

  test('runs real npm checks against a disposable repository and writes a host receipt', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-checks-'));
    const root = path.join(base, 'project');
    await fs.mkdir(root);
    const git = (args: string[]) => exec('git', args, { cwd: root, windowsHide: true });
    try {
      await git(['init']);
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'mwnn-check-fixture', version: '1.0.0',
        scripts: { 'compile-tests': 'node -e "process.exit(0)"', compile: 'node -e "process.exit(0)"',
          test: 'node --test test.test.cjs', lint: 'node -e "process.exit(0)"' } }));
      await fs.writeFile(path.join(root, 'test.test.cjs'), "const { test } = require('node:test');\ntest('behavior', () => {});\n");
      await fs.mkdir(path.join(root, '.mwnn'));
      await fs.writeFile(path.join(root, '.mwnn', 'verification.json'), profile());
      await git(['add', '.']);
      await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture']);
      let sequence = 0;
      const factory = createOutcomeEvidenceFactory({ snapshot: snapshotRevision, npmCommand: await resolveNpmCommand(),
        readText: (file) => fs.readFile(file, 'utf8'), now: () => new Date(), id: () => `real-${++sequence}`,
        run: runIndependentEvidenceCommand,
        persist: async (receipt) => {
          const target = path.join(base, 'receipt.json');
          await fs.writeFile(target, JSON.stringify(receipt));
          return target;
        },
      });
      const session = await factory({ cwd: root, card: card(), prompt: 'test prompt', stage: 'implementation',
        signal: new AbortController().signal, reloadCard: async () => card() });
      const result = await session.verify();
      assert.equal(result.valid, true, JSON.stringify(result));
      const saved = JSON.parse(await fs.readFile(path.join(base, 'receipt.json'), 'utf8')) as OutcomeReceipt;
      assert.equal(saved.checks.length, 5);
      assert.equal(saved.checks[2]?.tests, 1);
      assert.equal(saved.checkedRevision.digest, (await snapshotRevision(root)).digest);
      await fs.mkdir(path.join(root, 'nested'));
      await assert.rejects(snapshotRevision(path.join(root, 'nested')));
    } finally { await fs.rm(base, { recursive: true, force: true }); }
  });
});

suite('live receipt revalidation', () => {
  test('a receipt cannot advance work after its checked code or requirements change', async () => {
    const f = fixture();
    const session = await f.begin();
    assert.equal(await session.revalidate?.(), false);
    assert.equal((await session.verify()).valid, true);
    assert.equal(await session.revalidate?.(), true);
    f.setCode('changed after receipt');
    assert.equal(await session.revalidate?.(), false);
    f.setCode('after-agent');
    assert.equal(await session.revalidate?.(), true);
    f.setCard({ ...card(), description: 'different scope' });
    assert.equal(await session.revalidate?.(), false);
  });
});
