import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createOutcomeEvidenceFactory, criterionTexts, digest, parseVerificationProfile,
  type EvidenceCommandResult } from '../../src/outcomeEvidence';
import type { Card } from '../../src/types';

// Compiled to dist-test/test/unit/, so the repository root is three levels up.
const root = path.resolve(__dirname, '..', '..', '..');
const profilePath = path.join(root, '.mwnn', 'verification.json');
const MISSING_INPUTS = 'Missing or invalid verification inputs';

/** Cards whose criteria the repository profile must cover by exact checkbox text. */
const COVERED_CARDS = ['card-mw8ii6eu-1', 'card-mw89f8vw-1', 'card-mw8h6jsj-3', 'card-mvnyy9c2-1'];

function readCard(id: string): Card | undefined {
  const file = path.join(root, '.mwnn', 'cards', `${id}.md`);
  if (!fs.existsSync(file)) { return undefined; }
  const text = fs.readFileSync(file, 'utf8');
  const section = /^## Acceptance criteria\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1] ?? '';
  return { id, title: id, createdAt: 1, acceptanceCriteria: section };
}

const profileText = (): string => fs.readFileSync(profilePath, 'utf8');

suite('repository verification profile', () => {
  test('parses as a version-1 profile', () => {
    const profile = parseVerificationProfile(profileText());
    assert.equal(profile.version, 1);
    assert.ok(profile.criteria.length > 0);
  });

  test('maps every criterion of the covered cards by exact text', () => {
    const profile = parseVerificationProfile(profileText());
    for (const id of COVERED_CARDS) {
      const card = readCard(id);
      if (!card) { continue; } // Untracked board cards are absent from clean checkouts.
      const texts = criterionTexts(card);
      assert.ok(texts.length > 0, `${id} has acceptance criteria`);
      for (const text of texts) {
        const mapping = profile.criteria.find((entry) => entry.text === text);
        assert.ok(mapping, `${id} criterion is mapped: ${text}`);
        if (mapping.human === true) {
          assert.equal(mapping.checks.length, 0, `human criterion has no checks: ${text}`);
        } else {
          assert.ok(mapping.checks.length > 0, `automated criterion has checks: ${text}`);
        }
      }
    }
  });

  test('focused tests name compiled test files that exist under dist-test/test/', () => {
    const profile = parseVerificationProfile(profileText());
    const usesFocused = profile.criteria.some((entry) => entry.checks.includes('focused-tests'));
    assert.equal(usesFocused, (profile.focusedTests?.length ?? 0) > 0);
    for (const file of profile.focusedTests ?? []) {
      assert.match(file, /^dist-test\/test\/[a-zA-Z0-9_./-]+\.test\.js$/);
      assert.ok(fs.existsSync(path.join(root, file)), `${file} exists`);
    }
  });

  test('input capture succeeds for a fully mapped card with the repository profile', async () => {
    const profile = parseVerificationProfile(profileText());
    const automated = profile.criteria.find((entry) => entry.human !== true && entry.checks.length > 0);
    assert.ok(automated);
    const card: Card = { id: 'card-profile', title: 'Mapped card', createdAt: 1,
      acceptanceCriteria: `- [x] ${automated.text}` };
    const success: EvidenceCommandResult = { started: true, cancelled: false, exitCode: 0,
      stdout: '# tests 1\n# pass 1\n# fail 0\n# cancelled 0', stderr: '' };
    let ids = 0;
    const factory = createOutcomeEvidenceFactory({
      snapshot: async () => ({ root, head: 'head', digest: digest('code') }),
      readText: async (file) => {
        if (file.endsWith('verification.json')) { return profileText(); }
        if (file.endsWith('package.json')) { return fs.readFileSync(path.join(root, 'package.json'), 'utf8'); }
        return 'instructions';
      },
      run: async () => success,
      persist: async () => '/host/receipt.json',
      now: () => new Date('2026-11-09T00:00:00Z'), id: () => `id-${++ids}` });
    const session = await factory({ cwd: root, card, prompt: 'prompt', stage: 'implementation',
      signal: new AbortController().signal, reloadCard: async () => card });
    const result = await session.verify();
    if (!result.valid) { assert.ok(!result.reason.includes(MISSING_INPUTS), result.reason); }
    assert.equal(result.valid, true);
  });
});
