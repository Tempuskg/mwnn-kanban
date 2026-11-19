import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  createBoardReloadScheduler,
  type BoardReloadSchedulerDeps,
  type BoardReloadTimers,
} from '../../src/boardReloadScheduler';

interface FakeTimers extends BoardReloadTimers {
  advance(ms: number): Promise<void>;
  pendingIntervals(): number;
}

function fakeTimers(): FakeTimers {
  let now = 0;
  let nextId = 1;
  const timeouts = new Map<number, { at: number; callback: () => void }>();
  const intervals = new Map<number, { every: number; next: number; callback: () => void }>();
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  };
  return {
    setTimeout: (callback, ms) => {
      const id = nextId++;
      timeouts.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout: (handle) => {
      timeouts.delete(handle as number);
    },
    setInterval: (callback, ms) => {
      const id = nextId++;
      intervals.set(id, { every: ms, next: now + ms, callback });
      return id;
    },
    clearInterval: (handle) => {
      intervals.delete(handle as number);
    },
    pendingIntervals: () => intervals.size,
    advance: async (ms) => {
      const end = now + ms;
      for (;;) {
        const dueTimeouts = [...timeouts.entries()].filter(([, entry]) => entry.at <= end);
        const dueIntervals = [...intervals.values()].filter((entry) => entry.next <= end);
        const nextAt = Math.min(
          ...dueTimeouts.map(([, entry]) => entry.at),
          ...dueIntervals.map((entry) => entry.next),
        );
        if (!Number.isFinite(nextAt)) {
          break;
        }
        now = nextAt;
        for (const [id, entry] of dueTimeouts) {
          if (entry.at === nextAt && timeouts.has(id)) {
            timeouts.delete(id);
            entry.callback();
          }
        }
        for (const entry of dueIntervals) {
          if (entry.next === nextAt) {
            entry.next += entry.every;
            entry.callback();
          }
        }
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

function harness(overrides: Partial<BoardReloadSchedulerDeps> = {}) {
  const timers = fakeTimers();
  const calls = { reloads: 0, posts: 0 };
  let changed = false;
  const scheduler = createBoardReloadScheduler({
    reload: async () => {
      calls.reloads += 1;
      return changed;
    },
    post: () => {
      calls.posts += 1;
    },
    debounceMs: 75,
    timers,
    ...overrides,
  });
  return {
    timers,
    calls,
    scheduler,
    setChanged: (value: boolean) => {
      changed = value;
    },
  };
}

suite('board reload scheduler', () => {
  test('coalesces a burst of watcher events into one reload and repost', async () => {
    const { timers, calls, scheduler } = harness();
    // A whole-file rewrite typically fires delete/create/change in quick succession.
    scheduler.schedule('event');
    await timers.advance(20);
    scheduler.schedule('event');
    scheduler.schedule('event');
    await timers.advance(74);
    assert.equal(calls.reloads, 0);
    await timers.advance(1);
    assert.deepEqual(calls, { reloads: 1, posts: 1 });
  });

  test('watcher events repost even when the store reports no change', async () => {
    const { timers, calls, scheduler } = harness();
    scheduler.schedule('event');
    await timers.advance(75);
    assert.equal(calls.posts, 1);
  });

  test('a resync reposts only when the reload changed the board', async () => {
    const { timers, calls, scheduler, setChanged } = harness();
    scheduler.schedule('resync');
    await timers.advance(75);
    assert.deepEqual(calls, { reloads: 1, posts: 0 });

    setChanged(true);
    scheduler.schedule('resync');
    await timers.advance(75);
    assert.deepEqual(calls, { reloads: 2, posts: 1 });
  });

  test('polls while active so a missed watcher event still reaches the board', async () => {
    let active = false;
    const { timers, calls, setChanged } = harness({ pollMs: 1000, isActive: () => active });
    await timers.advance(2500);
    assert.equal(calls.reloads, 0, 'no polling while the board is closed');

    active = true;
    setChanged(true);
    await timers.advance(1000);
    assert.deepEqual(calls, { reloads: 1, posts: 1 });
  });

  test('requeues a request that arrives while a reload is running', async () => {
    let release: (() => void) | undefined;
    const timers = fakeTimers();
    let reloads = 0;
    let posts = 0;
    const scheduler = createBoardReloadScheduler({
      reload: () => {
        reloads += 1;
        return new Promise<boolean>((resolve) => {
          release = () => resolve(false);
        });
      },
      post: () => {
        posts += 1;
      },
      debounceMs: 75,
      timers,
    });

    scheduler.schedule('event');
    await timers.advance(75);
    assert.equal(reloads, 1);
    scheduler.schedule('event');
    await timers.advance(200);
    assert.equal(reloads, 1, 'waits for the in-flight reload');

    release!();
    await timers.advance(0);
    await timers.advance(75);
    assert.equal(reloads, 2);
    release!();
    await timers.advance(0);
    assert.equal(posts, 2);
  });

  test('reports reload errors and keeps scheduling', async () => {
    const errors: unknown[] = [];
    let fail = true;
    const { timers, scheduler } = harness({
      reload: async () => {
        if (fail) {
          throw new Error('disk gone');
        }
        return true;
      },
      onError: (error) => errors.push(error),
    });
    scheduler.schedule('event');
    await timers.advance(75);
    assert.equal(errors.length, 1);

    fail = false;
    scheduler.schedule('event');
    await timers.advance(75);
    assert.equal(errors.length, 1);
  });

  test('dispose stops pending reloads and polling', async () => {
    const { timers, calls, scheduler } = harness({ pollMs: 1000 });
    scheduler.schedule('event');
    scheduler.dispose();
    await timers.advance(5000);
    assert.equal(calls.reloads, 0);
    assert.equal(timers.pendingIntervals(), 0);
  });
});
