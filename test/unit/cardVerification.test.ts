import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  parseVerificationVerdict,
  type VerificationVerdict,
} from '../../src/cardVerification';

suite('card verification verdict parser', () => {
  test('parses pass, fail, and human verdicts', () => {
    const verdicts: readonly [string, VerificationVerdict][] = [
      ['VERIFY: PASS', { kind: 'pass' }],
      ['VERIFY: FAIL: a required behavior is missing', {
        kind: 'fail',
        reason: 'a required behavior is missing',
      }],
      ['VERIFY: HUMAN: visual judgment is required', {
        kind: 'human',
        reason: 'visual judgment is required',
      }],
    ];

    for (const [activity, expected] of verdicts) {
      assert.deepEqual(parseVerificationVerdict(activity, 0), expected);
    }
  });

  test('scans only appended activity and lets the last VERIFY line win', () => {
    const previousActivity = 'Earlier run\nVERIFY: PASS\n';
    const currentActivity = [
      previousActivity,
      'Current run evidence',
      'VERIFY: FAIL: first concern',
      'VERIFY: HUMAN: needs product approval',
    ].join('\n');

    assert.deepEqual(
      parseVerificationVerdict(currentActivity, previousActivity.length),
      { kind: 'human', reason: 'needs product approval' },
    );
    assert.equal(parseVerificationVerdict(previousActivity, previousActivity.length), undefined);
  });

  test('rejects fail and human markers without a non-empty reason', () => {
    for (const marker of [
      'VERIFY: FAIL',
      'VERIFY: FAIL:',
      'VERIFY: FAIL:   ',
      'VERIFY: HUMAN',
      'VERIFY: HUMAN:',
      'VERIFY: HUMAN:   ',
    ]) {
      assert.equal(parseVerificationVerdict(marker, 0), undefined, marker);
    }

    assert.equal(
      parseVerificationVerdict('VERIFY: PASS\nVERIFY: FAIL:', 0),
      undefined,
      'an invalid last marker must not fall back to an earlier pass',
    );
  });

  test('does not infer a pass from fully checked acceptance criteria', () => {
    const activity = [
      '## Acceptance criteria',
      '- [x] The behavior works',
      '- [x] Tests pass',
    ].join('\n');

    assert.equal(parseVerificationVerdict(activity, 0), undefined);
  });

  test('returns no verdict for an out-of-range baseline', () => {
    const activity = 'VERIFY: PASS';

    assert.equal(parseVerificationVerdict(activity, -1), undefined);
    assert.equal(parseVerificationVerdict(activity, activity.length + 1), undefined);
  });
});
