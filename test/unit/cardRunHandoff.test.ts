import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  CARD_HANDOFF_BUSY_MESSAGE,
  CARD_RUN_IN_PROGRESS_MESSAGE,
  runRestartableCardHandoff,
  type CardRunHandoffDeps,
} from '../../src/cardRunHandoff';
import {
  createChatHandoffInFlight,
  createChatHandoffQueue,
  type ChatHandoffLease,
} from '../../src/chatHandoff';

const never = (): Promise<never> => new Promise(() => undefined);
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface Harness {
  readonly deps: CardRunHandoffDeps;
  readonly inFlight: ReturnType<typeof createChatHandoffInFlight>;
  readonly infos: string[];
  restartOffers: number;
}

function harness(options: { restart?: boolean; onConfirm?: () => void } = {}): Harness {
  const inFlight = createChatHandoffInFlight();
  const result: Harness = {
    inFlight,
    infos: [],
    restartOffers: 0,
    deps: {
      runExclusive: (key, run) => inFlight.run(key, run, { kind: 'card' }),
      restartExclusive: (key, run) => inFlight.restart(key, run, { kind: 'card' }),
      holder: (key) => inFlight.holder(key),
      processRunning: (key) => inFlight.processRunning(key),
      confirmRestart: async () => {
        result.restartOffers += 1;
        options.onConfirm?.();
        return options.restart ?? false;
      },
      showInformation: (message) => result.infos.push(message),
    },
  };
  return result;
}

suite('restartable Run with AI hand-off', () => {
  test('a dismissed provider picker releases the lock and the picker shows again', async () => {
    const h = harness();
    const activity: string[] = [];
    let picks = 0;
    const attempt = async (lease: ChatHandoffLease): Promise<boolean> => {
      picks += 1;
      const choice = await Promise.resolve<string | undefined>(undefined); // Escape: showQuickPick resolves undefined
      if (!choice || lease.signal.aborted) {
        return false;
      }
      activity.push('handoff recorded');
      return true;
    };

    assert.equal(await runRestartableCardHandoff('card-A', h.deps, attempt), false);
    assert.equal(h.inFlight.holder('card-A'), undefined, 'the lock is free right after the dismissal');
    assert.equal(await runRestartableCardHandoff('card-A', h.deps, attempt), false);

    assert.equal(picks, 2, 'the second start reaches the picker again');
    assert.deepEqual(h.infos, [], 'no "already in progress" message');
    assert.equal(h.restartOffers, 0);
    assert.deepEqual(activity, [], 'a cancelled attempt records nothing');
  });

  test('a pending card holder can be restarted and its lease aborts', async () => {
    const h = harness({ restart: true });
    let oldLease: ChatHandoffLease | undefined;
    void runRestartableCardHandoff('card-A', h.deps, async (lease) => { oldLease = lease; return never(); });
    await tick();
    assert.equal(h.inFlight.holder('card-A'), 'card');

    const restarted = await runRestartableCardHandoff('card-A', h.deps, async (lease) => !lease.signal.aborted);

    assert.equal(restarted, true, 'the restarted attempt runs and succeeds');
    assert.equal(h.restartOffers, 1);
    assert.equal(oldLease?.signal.aborted, true, 'the abandoned attempt is told to stop');
    assert.deepEqual(h.infos, []);
    assert.equal(h.inFlight.holder('card-A'), undefined);
  });

  test('Wait or dismissing the restart offer changes nothing', async () => {
    const h = harness({ restart: false });
    let oldLease: ChatHandoffLease | undefined;
    void runRestartableCardHandoff('card-A', h.deps, async (lease) => { oldLease = lease; return never(); });
    await tick();
    let ran = false;

    assert.equal(await runRestartableCardHandoff('card-A', h.deps, async () => { ran = true; return true; }), false);

    assert.equal(h.restartOffers, 1);
    assert.equal(ran, false);
    assert.equal(oldLease?.signal.aborted, false, 'the earlier attempt stays live');
    assert.equal(h.inFlight.holder('card-A'), 'card');
  });

  test('a superseded attempt writes, records and says nothing when it finally resumes', async () => {
    const h = harness({ restart: true });
    const writes: string[] = [];
    const messages: string[] = [];
    let resume!: () => void;
    const stuck = new Promise<void>((resolve) => { resume = resolve; });
    const queue = createChatHandoffQueue();
    const deliveries: string[] = [];

    const first = runRestartableCardHandoff('card-A', h.deps, async (lease) => {
      // A chat delivery waiting on a confirmation toast that was hidden.
      await queue.run(async () => { deliveries.push('first'); await stuck; }, lease.signal);
      if (lease.signal.aborted) {
        return false;
      }
      writes.push('activity entry');
      messages.push('handed off');
      return true;
    });
    await tick();

    const second = await runRestartableCardHandoff('card-A', h.deps, async (lease) => {
      // The restarted delivery is not queued behind the stuck one.
      await queue.run(async () => { deliveries.push('second'); }, lease.signal);
      writes.push('restarted entry');
      return true;
    });
    assert.equal(second, true);
    assert.deepEqual(deliveries, ['first', 'second'], 'the abandoned delivery left the queue order');

    resume();
    assert.equal(await first, false);
    assert.deepEqual(writes, ['restarted entry'], 'only the restarted attempt wrote');
    assert.deepEqual(messages, []);
    assert.equal(h.inFlight.holder('card-A'), undefined, 'the stale release did not free or leak the lock');
  });

  test('a running CLI process is refused: no second process, Stop is pointed to, no restart offer', async () => {
    const h = harness({ restart: true });
    let processes = 0;
    let finish!: () => void;
    const running = new Promise<void>((resolve) => { finish = resolve; });
    let firstLease: ChatHandoffLease | undefined;
    const first = runRestartableCardHandoff('card-A', h.deps, async (lease) => {
      firstLease = lease;
      lease.setProcessRunning(true);
      processes += 1;
      await running;
      lease.setProcessRunning(false);
      return true;
    });
    await tick();

    const second = await runRestartableCardHandoff('card-A', h.deps, async () => { processes += 1; return true; });

    assert.equal(second, false);
    assert.equal(processes, 1, 'a second process was not started');
    assert.equal(h.restartOffers, 0, 'restart is never offered for a running process');
    assert.deepEqual(h.infos, [CARD_RUN_IN_PROGRESS_MESSAGE]);
    assert.match(CARD_RUN_IN_PROGRESS_MESSAGE, /Stop/);
    assert.equal(firstLease?.signal.aborted, false, 'the running attempt was not abandoned');

    finish();
    assert.equal(await first, true);
  });

  test('a process that starts while the restart offer is open is not abandoned', async () => {
    let started: ChatHandoffLease | undefined;
    const h = harness({ restart: true, onConfirm: () => started?.setProcessRunning(true) });
    void runRestartableCardHandoff('card-A', h.deps, async (lease) => { started = lease; return never(); });
    await tick();
    let ran = false;

    assert.equal(await runRestartableCardHandoff('card-A', h.deps, async () => { ran = true; return true; }), false);

    assert.equal(ran, false);
    assert.equal(started?.signal.aborted, false);
    assert.deepEqual(h.infos, [CARD_RUN_IN_PROGRESS_MESSAGE]);
  });

  test('another kind of hand-off (the AI loop) is never restartable', async () => {
    const h = harness({ restart: true });
    void h.inFlight.run('card-A', () => never());
    let ran = false;

    assert.equal(await runRestartableCardHandoff('card-A', h.deps, async () => { ran = true; return true; }), false);

    assert.equal(ran, false);
    assert.equal(h.restartOffers, 0);
    assert.deepEqual(h.infos, [CARD_HANDOFF_BUSY_MESSAGE]);
    assert.equal(h.inFlight.holder('card-A'), 'other');
  });

  test('an interview holder keeps its own restart flow and is not restartable here', async () => {
    const h = harness({ restart: true });
    void h.inFlight.run('card-A', () => never(), { kind: 'interview' });

    assert.equal(await runRestartableCardHandoff('card-A', h.deps, async () => true), false);

    assert.equal(h.restartOffers, 0);
    assert.deepEqual(h.infos, [CARD_HANDOFF_BUSY_MESSAGE]);
  });
});
