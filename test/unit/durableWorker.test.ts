import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  createDurableWorkerSession,
  createMemoryWorkerFileSystem,
  createWorkerBoundsConfig,
} from '../../src/durableWorker';
import { resolveSharedWorkerRoot } from '../../src/workerStoreLocation';
import { cardLeaseKey, cardWorkKey, createRunId, repoLeaseKey, stageActionId } from '../../src/workerIds';
import { createWorkerLeaseStore } from '../../src/workerLease';
import { createWorkerCheckpointStore, createCheckpoint } from '../../src/workerCheckpoint';
import { checkWorkerBounds, DEFAULT_WORKER_BOUNDS } from '../../src/workerBounds';
import { reconcileWorkerStage } from '../../src/workerReconcile';
import type { Card } from '../../src/types';

const card = (extra: Partial<Card> = {}): Card => ({
  id: 'card-1',
  title: 'Task',
  createdAt: 1,
  description: 'Do the thing',
  acceptanceCriteria: '- [ ] Done',
  ...extra,
});

suite('worker identifiers', () => {
  test('project-qualifies cards and builds stable stage action ids', () => {
    assert.equal(cardWorkKey('prj_a', 'card-1'), 'prj_a~card-1');
    assert.equal(repoLeaseKey('prj_a'), 'repo:prj_a');
    assert.equal(cardLeaseKey('prj_a', 'card-1'), 'card:prj_a~card-1');
    assert.equal(stageActionId('run-x', 'implementation', 2), 'run-x:implementation:2');
    assert.match(createRunId({ nowMs: 36, sequence: 1 }), /^run-[0-9a-z]+-[0-9a-z]+$/);
  });
});

suite('shared worker store location', () => {
  test('resolves an editor-neutral root on Windows', () => {
    assert.equal(
      resolveSharedWorkerRoot({
        platform: 'win32',
        homeDirectory: 'C:\\Users\\dev',
        env: { APPDATA: 'C:\\Users\\dev\\AppData\\Roaming' },
      }).replace(/\\/g, '/'),
      'C:/Users/dev/AppData/Roaming/mwnn-kanban/mwnn-worker',
    );
  });
});

suite('checkpoints', () => {
  test('persist and reload an active run for restart recovery', async () => {
    const fs = createMemoryWorkerFileSystem(() => 1_000);
    const store = createWorkerCheckpointStore('/worker', fs, (...parts) => parts.join('/'));
    const checkpoint = createCheckpoint({
      runId: 'run-1',
      projectId: 'prj_a',
      cardId: 'card-1',
      ownerId: 'worker-1',
      stage: 'implementation',
      nowMs: 1_000,
      attempt: 1,
      activityBaseline: 12,
      lastActionId: 'run-1:implementation:1',
    });
    await store.save(checkpoint);
    const loaded = await store.loadActive('prj_a', 'card-1');
    assert.ok(loaded);
    assert.equal(loaded.runId, 'run-1');
    assert.equal(loaded.stage, 'implementation');
    assert.equal(loaded.activityBaseline, 12);
    assert.equal(loaded.lastActionId, 'run-1:implementation:1');
  });
});

suite('leases', () => {
  test('one owner holds a mutating lease; a duplicate trigger is refused', async () => {
    const fs = createMemoryWorkerFileSystem(() => 5_000);
    const store = createWorkerLeaseStore('/worker', fs, (...parts) => parts.join('/'));
    const first = await store.acquire({
      key: repoLeaseKey('prj_a'),
      ownerId: 'worker-1',
      runId: 'run-1',
      nowMs: 5_000,
      ttlMs: 60_000,
    });
    assert.equal(first.ok, true);
    const second = await store.acquire({
      key: repoLeaseKey('prj_a'),
      ownerId: 'worker-2',
      runId: 'run-2',
      nowMs: 5_100,
      ttlMs: 60_000,
    });
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.match(second.reason, /held by worker worker-1/);
    }
  });

  test('an expired lease can be reclaimed', async () => {
    let now = 1_000;
    const fs = createMemoryWorkerFileSystem(() => now);
    const store = createWorkerLeaseStore('/worker', fs, (...parts) => parts.join('/'));
    assert.equal(
      (await store.acquire({
        key: cardLeaseKey('prj_a', 'card-1'),
        ownerId: 'worker-1',
        runId: 'run-1',
        nowMs: now,
        ttlMs: 100,
      })).ok,
      true,
    );
    now = 2_000;
    const reclaimed = await store.acquire({
      key: cardLeaseKey('prj_a', 'card-1'),
      ownerId: 'worker-2',
      runId: 'run-2',
      nowMs: now,
      ttlMs: 100,
    });
    assert.equal(reclaimed.ok, true);
  });
});

suite('bounds', () => {
  test('attempts, elapsed time and stall are bounded with visible stops', () => {
    const config = createWorkerBoundsConfig({
      maxAttemptsPerStage: 2,
      maxElapsedMinutes: 60,
      stallTimeoutMinutes: 10,
    });
    const attempts = checkWorkerBounds(
      config,
      { startedAt: 0, updatedAt: 0, attempt: 3, stage: 'implementation' },
      1_000,
    );
    assert.equal(attempts.ok, false);
    if (!attempts.ok) {
      assert.equal(attempts.stop.kind, 'attempts');
      assert.match(attempts.stop.message, /retry bound/);
    }

    const elapsed = checkWorkerBounds(
      config,
      { startedAt: 0, updatedAt: 0, attempt: 1, stage: 'implementation' },
      60 * 60 * 1000,
    );
    assert.equal(elapsed.ok, false);
    if (!elapsed.ok) {
      assert.equal(elapsed.stop.kind, 'elapsed');
    }

    const stalled = checkWorkerBounds(
      config,
      { startedAt: 0, updatedAt: 0, attempt: 1, stage: 'implementation' },
      10 * 60 * 1000,
    );
    assert.equal(stalled.ok, false);
    if (!stalled.ok) {
      assert.equal(stalled.stop.kind, 'stalled');
    }

    assert.equal(
      checkWorkerBounds(
        DEFAULT_WORKER_BOUNDS,
        { startedAt: 0, updatedAt: 0, attempt: 1, stage: 'implementation' },
        1_000,
      ).ok,
      true,
    );
  });
});

suite('reconcile', () => {
  test('refuses blind retry when evidence already completed the stage', () => {
    const decision = reconcileWorkerStage({
      stage: 'implementation',
      card: card({ activity: 'STATUS: DONE\n' }),
      activityBaseline: 0,
      actionId: 'run-1:implementation:1',
    });
    assert.equal(decision.kind, 'needs-human');
    assert.match(decision.message, /fresh independent verification/i);
  });

  test('allows retry only after confirming the interrupted action left no evidence', () => {
    const decision = reconcileWorkerStage({
      stage: 'implementation',
      card: card({ activity: '### started\n' }),
      activityBaseline: 0,
      actionId: 'run-1:implementation:1',
    });
    assert.equal(decision.kind, 'retry');
  });

  test('needs a human when the activity baseline is missing or untrustworthy', () => {
    assert.equal(
      reconcileWorkerStage({
        stage: 'implementation',
        card: card({ activity: 'STATUS: DONE\n' }),
      }).kind,
      'needs-human',
    );
    assert.equal(
      reconcileWorkerStage({
        stage: 'implementation',
        card: card({ activity: 'short' }),
        activityBaseline: 99,
      }).kind,
      'needs-human',
    );
  });
});

suite('durable worker session', () => {
  test('resumes from a persisted checkpoint and blocks a second owner', async () => {
    const fs = createMemoryWorkerFileSystem();
    const first = createDurableWorkerSession({
      rootPath: '/worker',
      fileSystem: fs,
      ownerId: 'worker-1',
      createRunId: () => 'run-fixed',
      bounds: createWorkerBoundsConfig({ maxAttemptsPerStage: 2, maxElapsedMinutes: 0, stallTimeoutMinutes: 0 }),
    });
    const began = await first.beginCard('prj_a', 'card-1');
    assert.equal(began.ok, true);
    if (!began.ok) {
      return;
    }
    const gate = await first.beforeStage({
      projectId: 'prj_a',
      cardId: 'card-1',
      stage: 'implementation',
      card: card({ activity: '' }),
      activityBaseline: 0,
    });
    assert.equal(gate.ok, true);

    const rival = createDurableWorkerSession({
      rootPath: '/worker',
      fileSystem: fs,
      ownerId: 'worker-2',
      createRunId: () => 'run-other',
    });
    const blocked = await rival.beginCard('prj_a', 'card-1');
    assert.equal(blocked.ok, false);

    // Simulate process death without release: leave the interrupted checkpoint.
    const restarted = createDurableWorkerSession({
      rootPath: '/worker',
      fileSystem: fs,
      ownerId: 'worker-3',
      // Lease still held by worker-1 — reclaim only after TTL. Force expiry via renew path:
      // finish the first owner cleanly, then restart resume against the same checkpoint file
      // by saving an active interrupted checkpoint without a live lease.
    });
    await first.finishCard({ projectId: 'prj_a', cardId: 'card-1', status: 'stopped', outcome: 'crash' });

    // Re-seed an interrupted active checkpoint after release so resume can load it.
    const checkpoints = createWorkerCheckpointStore('/worker', fs, (...parts) => parts.join('/'));
    await checkpoints.save(createCheckpoint({
      runId: 'run-fixed',
      projectId: 'prj_a',
      cardId: 'card-1',
      ownerId: 'worker-1',
      stage: 'implementation',
      nowMs: Date.now(),
      attempt: 1,
      activityBaseline: 0,
      lastActionId: 'run-fixed:implementation:1',
    }));

    const resumed = await restarted.beginCard('prj_a', 'card-1');
    assert.equal(resumed.ok, true);
    if (!resumed.ok) {
      return;
    }
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.runId, 'run-fixed');

    const withEvidence = await restarted.beforeStage({
      projectId: 'prj_a',
      cardId: 'card-1',
      stage: 'implementation',
      card: card({ activity: 'STATUS: DONE\n' }),
      activityBaseline: 0,
    });
    assert.equal(withEvidence.ok, false);
    assert.equal(withEvidence.ok === false && withEvidence.reconcile?.kind, 'needs-human');
  });

  test('reconcile-then-retry bumps the attempt and respects the attempt bound', async () => {
    const fs = createMemoryWorkerFileSystem();
    const worker = createDurableWorkerSession({
      rootPath: '/worker',
      fileSystem: fs,
      ownerId: 'worker-1',
      createRunId: () => 'run-retry',
      bounds: createWorkerBoundsConfig({ maxAttemptsPerStage: 2, maxElapsedMinutes: 0, stallTimeoutMinutes: 0 }),
    });
    assert.equal((await worker.beginCard('prj_a', 'card-1')).ok, true);
    const first = await worker.beforeStage({
      projectId: 'prj_a',
      cardId: 'card-1',
      stage: 'implementation',
      card: card({ activity: '' }),
      activityBaseline: 0,
    });
    assert.equal(first.ok, true);
    await worker.afterStage({
      projectId: 'prj_a',
      cardId: 'card-1',
      stage: 'implementation',
      completed: false,
      message: 'timed out',
    });

    const second = await worker.beforeStage({
      projectId: 'prj_a',
      cardId: 'card-1',
      stage: 'implementation',
      card: card({ activity: 'still empty\n' }),
      activityBaseline: 0,
    });
    assert.equal(second.ok, true);
    if (second.ok) {
      assert.equal(second.attempt, 2);
      assert.equal(second.reconcile?.kind, 'retry');
    }

    await worker.afterStage({
      projectId: 'prj_a',
      cardId: 'card-1',
      stage: 'implementation',
      completed: false,
    });
    const third = await worker.beforeStage({
      projectId: 'prj_a',
      cardId: 'card-1',
      stage: 'implementation',
      card: card({ activity: 'still empty\n' }),
      activityBaseline: 0,
    });
    assert.equal(third.ok, false);
    if (!third.ok) {
      assert.equal(third.stop?.kind, 'attempts');
    }
  });
});

suite('reconcile unresolved blockers', () => {
  test('recovery does not accept DONE after an unresolved BLOCKED marker', () => {
    const decision = reconcileWorkerStage({
      stage: 'implementation',
      card: card({ activity: 'STATUS: BLOCKED: independent check failed\nSTATUS: DONE\n' }),
      activityBaseline: 0,
      actionId: 'run-1:implementation:1',
    });
    assert.equal(decision.kind, 'blocked');
    if (decision.kind === 'blocked') {
      assert.equal(decision.reason, 'independent check failed');
    }
  });
});

suite('recovery requires host verification', () => {
  test('PASS text and a forged receipt mention cannot complete interrupted verification', () => {
    const decision = reconcileWorkerStage({ stage: 'verification',
      card: card({ activity: 'VERIFY: PASS\nReceipt: /forged/receipt.json\n' }),
      activityBaseline: 0, actionId: 'run-2:verification:1' });
    assert.equal(decision.kind, 'needs-human');
  });

  test('an explicit HUMAN verdict preserves the manual review result', () => {
    const decision = reconcileWorkerStage({ stage: 'verification',
      card: card({ activity: 'VERIFY: HUMAN: visual review required\n' }),
      activityBaseline: 0 });
    assert.equal(decision.kind, 'already-complete');
  });
});
