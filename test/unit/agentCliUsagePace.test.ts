import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  AI_USAGE_PACE_TOLERANCE_POINTS,
  FIVE_HOUR_WINDOW_MS,
  WEEKLY_WINDOW_MS,
  classifyUsagePace,
  evaluateCliPace,
  predictBehindAtMs,
  usagePace,
  type UsagePaceWindow,
} from '../../src/agentCliUsagePace';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const NOW = Date.UTC(2026, 9, 22, 12);
const RESET = NOW + 3 * HOUR;

function fiveHour(usedPercent: number, overrides: Partial<UsagePaceWindow> = {}): UsagePaceWindow {
  return {
    usedPercent,
    resetsAtMs: RESET,
    lengthMs: FIVE_HOUR_WINDOW_MS,
    asOfMs: NOW,
    ...overrides,
  };
}

suite('usagePace', () => {
  test('variance of exactly -5 is on pace; just below is behind', () => {
    assert.equal(AI_USAGE_PACE_TOLERANCE_POINTS, 5);
    // 40% elapsed (2 of 5 hours remaining → 3 elapsed).
    const asOf = RESET - 3 * HOUR;
    assert.equal(usagePace(fiveHour(35, { asOfMs: asOf }), asOf).status, 'onPace');
    assert.equal(usagePace(fiveHour(35, { asOfMs: asOf }), asOf).variancePoints, -5);
    assert.equal(usagePace(fiveHour(34.99, { asOfMs: asOf }), asOf).status, 'behind');
  });
});

suite('classifyUsagePace', () => {
  test('a stale reading is unknown', () => {
    const window = fiveHour(50, { asOfMs: NOW - 30 * MINUTE - 1 });
    assert.deepEqual(classifyUsagePace(window, NOW), {
      status: 'stale',
      ageMs: 30 * MINUTE + 1,
      limitMs: 30 * MINUTE,
    });
  });

  test('a reset window is unknown', () => {
    const window = fiveHour(91, { resetsAtMs: NOW - 1, asOfMs: NOW - 5 * MINUTE });
    assert.deepEqual(classifyUsagePace(window, NOW), { status: 'reset' });
  });

  test('a window with no length is unknown', () => {
    const window: UsagePaceWindow = {
      usedPercent: 40,
      resetsAtMs: RESET,
      asOfMs: NOW,
    };
    assert.deepEqual(classifyUsagePace(window, NOW), { status: 'noLength' });
  });

  test('a reading at the freshness limit is still current', () => {
    const window = fiveHour(50, { asOfMs: NOW - 30 * MINUTE });
    assert.equal(classifyUsagePace(window, NOW).status, 'current');
  });
});

suite('predictBehindAtMs', () => {
  test('one window: behind when elapsed passes used plus tolerance', () => {
    // 20% used, 40% elapsed → behind when elapsed reaches 25%.
    const window = fiveHour(20, { asOfMs: RESET - 3 * HOUR });
    const start = RESET - FIVE_HOUR_WINDOW_MS;
    assert.equal(predictBehindAtMs(window), start + 0.25 * FIVE_HOUR_WINDOW_MS);
  });

  test('multiple windows: the latest predicted time decides the CLI', () => {
    // Both ahead so the CLI is not eligible; prediction still uses the later window.
    const five = fiveHour(90, { asOfMs: NOW });
    const weekly: UsagePaceWindow = {
      usedPercent: 90,
      resetsAtMs: NOW + WEEKLY_WINDOW_MS / 2,
      lengthMs: WEEKLY_WINDOW_MS,
      asOfMs: NOW,
    };
    const eligibility = evaluateCliPace([five, weekly], NOW);
    assert.equal(eligibility.status, 'not-behind');
    const fiveAt = predictBehindAtMs(five);
    const weeklyAt = predictBehindAtMs(weekly);
    assert.ok(fiveAt !== undefined && weeklyAt !== undefined);
    assert.equal(eligibility.predictedBehindAtMs, Math.max(fiveAt, weeklyAt));
  });

  test('crossing after reset: high used predicts into the next cycle', () => {
    // 96% used never reaches behind before reset (needs elapsed > 101).
    const window = fiveHour(96, { asOfMs: NOW });
    assert.equal(
      predictBehindAtMs(window),
      RESET + (AI_USAGE_PACE_TOLERANCE_POINTS / 100) * FIVE_HOUR_WINDOW_MS,
    );
  });

  test('earliest predicted time across CLIs is the next wake', () => {
    const soon = fiveHour(0, {
      resetsAtMs: NOW + FIVE_HOUR_WINDOW_MS,
      asOfMs: NOW,
    });
    const later = fiveHour(0, {
      resetsAtMs: NOW + 2 * FIVE_HOUR_WINDOW_MS,
      lengthMs: FIVE_HOUR_WINDOW_MS,
      asOfMs: NOW,
    });
    const a = predictBehindAtMs(soon)!;
    const b = predictBehindAtMs(later)!;
    assert.ok(a < b);
    assert.equal(Math.min(a, b), a);
  });
});

suite('evaluateCliPace', () => {
  test('every known-length window must be behind', () => {
    // Both readings are fresh; elapsed at asOf differs by using different resets.
    const behind = fiveHour(10, {
      resetsAtMs: NOW + HOUR,
      asOfMs: NOW,
    }); // start = NOW+1h-5h; elapsed 80% → variance -70
    const ahead = fiveHour(90, {
      resetsAtMs: NOW + 4 * HOUR,
      asOfMs: NOW,
    }); // start = NOW+4h-5h; elapsed 20% → variance +70
    assert.equal(evaluateCliPace([behind], NOW).status, 'behind');
    assert.equal(evaluateCliPace([behind, ahead], NOW).status, 'not-behind');
  });
});
