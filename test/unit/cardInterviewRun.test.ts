import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  buildCardInterviewPrompt,
  describeInterviewIneligibility,
  findInterviewCardSelection,
  formatInterviewStartEntry,
} from '../../src/aiCards';
import { runBoardLoop, type LoopGateways, type LoopStore } from '../../src/boardLoop';
import { startCardInterview, type CardInterviewDeps, type InterviewProviderPick } from '../../src/cardInterview';
import { createChatHandoffInFlight, type ChatHandoffTarget } from '../../src/chatHandoff';
import { isWebviewToHostMessage, type BoardState, type Card } from '../../src/types';
import {
  addCard,
  appendActivity,
  cloneBoard,
  defaultBoard,
  moveCard,
  setAcceptanceCriteria,
  setAssignee,
  setDescription,
} from '../../src/utils';

const COLUMNS = ['Backlog', 'Ready', 'In Progress', 'Verify', 'Done'] as const;
const CLAUDE: ChatHandoffTarget = {
  provider: 'claude-code',
  commandId: 'claude-vscode.editor.open',
  promptDelivery: 'positional',
};

function interviewBoard(options: { defined?: boolean; assignee?: 'human' | 'ai' | 'none' } = {}): {
  state: BoardState;
  cardId: string;
} {
  let state = defaultBoard([...COLUMNS]);
  const columnId = state.columns[1]!.id;
  state = addCard(state, columnId, 'Gather payroll facts');
  const cardId = state.columns[1]!.cards[0]!.id;
  if (options.defined !== false) {
    state = setDescription(state, cardId, 'Record payroll systems and headcount.');
    state = setAcceptanceCriteria(state, cardId, '- [ ] Payroll system named\n- [ ] Headcount recorded (unknown allowed)');
  }
  const assignee = options.assignee ?? 'human';
  if (assignee !== 'none') {
    state = setAssignee(state, cardId, assignee === 'ai' ? { kind: 'ai' } : { kind: 'human', name: 'Alice' });
  }
  return { state, cardId };
}

function findCard(state: BoardState, cardId: string): Card {
  const card = state.columns.flatMap((column) => column.cards).find((candidate) => candidate.id === cardId);
  assert.ok(card);
  return card;
}

interface Harness {
  deps: CardInterviewDeps;
  getState(): BoardState;
  setState(next: BoardState): void;
  prompts: string[];
  info: string[];
  warnings: string[];
  picks: number;
  restartOffers: number;
  inFlight: ReturnType<typeof createChatHandoffInFlight>;
}

function harness(
  initial: BoardState,
  options: {
    pick?: () => Promise<InterviewProviderPick>;
    delivered?: boolean;
    handOff?: (prompt: string, signal: AbortSignal) => Promise<boolean>;
    restart?: boolean;
  } = {},
): Harness {
  let state = cloneBoard(initial);
  const inFlight = createChatHandoffInFlight();
  const result: Harness = {
    prompts: [],
    info: [],
    warnings: [],
    picks: 0,
    restartOffers: 0,
    inFlight,
    getState: () => state,
    setState: (next) => {
      state = next;
    },
    deps: {
      reloadState: async () => cloneBoard(state),
      runExclusive: (key, action) => inFlight.run(key, action, { kind: 'interview' }),
      restartExclusive: (key, action) => inFlight.restart(key, action, { kind: 'interview' }),
      isInterviewInFlight: (key) => inFlight.holder(key) === 'interview',
      confirmRestart: async () => {
        result.restartOffers += 1;
        return options.restart ?? false;
      },
      pickProvider: async () => {
        result.picks += 1;
        return options.pick ? options.pick() : { kind: 'picked', target: CLAUDE };
      },
      handOff: async (_target, prompt, _subject, signal) => {
        result.prompts.push(prompt);
        return options.handOff ? options.handOff(prompt, signal) : (options.delivered ?? true);
      },
      appendActivity: async (cardId, entry) => {
        state = appendActivity(state, cardId, entry);
      },
      cardFilePath: (cardId) => `.mwnn/cards/${cardId}.md`,
      workspaceRoot: 'E:/work',
      showInformation: (message) => result.info.push(message),
      showWarning: (message) => result.warnings.push(message),
      refreshBoard: () => undefined,
      now: () => new Date('2026-10-09T12:00:00.000Z'),
    },
  };
  return result;
}

suite('card interview eligibility', () => {
  test('a defined Human interview card outside Done is eligible', () => {
    const { state, cardId } = interviewBoard();
    const selection = findInterviewCardSelection(state, cardId);
    assert.equal(selection.eligible, true);
  });

  test('ordinary Human, AI, undefined, done and missing cards are ineligible', () => {
    assert.deepEqual(findInterviewCardSelection(interviewBoard().state, 'card-missing'), {
      eligible: false,
      reason: 'missing',
    });
    const unassigned = interviewBoard({ assignee: 'none' });
    assert.deepEqual(findInterviewCardSelection(unassigned.state, unassigned.cardId), {
      eligible: false,
      reason: 'not-interview',
    });

    const ai = interviewBoard({ assignee: 'ai' });
    assert.deepEqual(findInterviewCardSelection(ai.state, ai.cardId), { eligible: false, reason: 'not-interview' });
    assert.doesNotMatch(describeInterviewIneligibility('not-interview'), /check/i);

    const undefinedCard = interviewBoard({ defined: false });
    assert.deepEqual(findInterviewCardSelection(undefinedCard.state, undefinedCard.cardId), {
      eligible: false,
      reason: 'undefined',
    });

    const done = interviewBoard();
    const doneState = moveCard(done.state, done.cardId, done.state.columns[4]!.id, 0);
    assert.deepEqual(findInterviewCardSelection(doneState, done.cardId), { eligible: false, reason: 'done' });
    assert.match(describeInterviewIneligibility('done'), /done column/);
    assert.match(describeInterviewIneligibility('not-interview'), /Human card/);
  });

  test('the webview protocol accepts startCardInterview with a card id only', () => {
    assert.equal(isWebviewToHostMessage({ type: 'startCardInterview', cardId: 'card-1' }), true);
    assert.equal(isWebviewToHostMessage({ type: 'startCardInterview' }), false);
    assert.equal(isWebviewToHostMessage({ type: 'startCardInterview', cardId: 1 }), false);
  });
});

suite('card interview prompt', () => {
  const { state, cardId } = interviewBoard();
  const prompt = buildCardInterviewPrompt(findCard(state, cardId), `.mwnn/cards/${cardId}.md`, 'E:/work');

  test('carries the exact workspace and card paths and the card definition', () => {
    assert.match(prompt, /Workspace root: E:\/work/);
    assert.ok(prompt.includes(`This card is stored as a markdown file at: .mwnn/cards/${cardId}.md`));
    assert.match(prompt, /Headcount recorded \(unknown allowed\)/);
  });

  test('reads saved records and local AI instructions, then asks one question at a time', () => {
    assert.match(prompt, /Read the saved card file above in full/);
    assert.match(prompt, /AGENTS\.md, CLAUDE\.md, \.github\/copilot-instructions\.md/);
    assert.match(prompt, /Reuse every answer already recorded/);
    assert.match(prompt, /Ask exactly one question per message, then stop and wait for the reply/);
    assert.match(prompt, /Split a multipart question/);
    assert.match(prompt, /never for credentials, passwords, account numbers or customer records/);
  });

  test('runs as a coworking session that answers and acts before it asks', () => {
    assert.match(prompt, /coworking session with the person/);
    assert.match(prompt, /Try to answer it yourself from the card, the linked artifacts, the repository and read-only commands/);
    assert.match(prompt, /Never ask the person for something you can find out on your own/);
    assert.match(prompt, /Do any in-scope, safe workspace step yourself instead of asking the person to do it/);
    assert.match(prompt, /explicit go-ahead before any outward-facing, destructive or hard-to-undo action/);
    assert.match(prompt, /only for what only they can supply: decisions, preferences, approval or sign-off, and facts that are not available in the workspace/);
    assert.match(prompt, /state the finding and its source and ask them to confirm or correct it, instead of asking an open-ended question/);
    assert.match(prompt, /Record each fact you found or step you did as a dated Activity entry giving its source \(file path, command or artifact\), and label it verified evidence/);
    assert.match(prompt, /Answers from the person stay labelled user-reported/);
    assert.doesNotMatch(prompt, /You ask, listen and record|Do not implement the work/);
    assert.ok(prompt.indexOf('## Do it yourself first') < prompt.indexOf('## Asking'));
    assert.match(prompt, /Never invent or guess answers/);
  });

  test('records each answer durably and keeps zero, none, unknown and skipped distinct', () => {
    assert.match(prompt, /Append a dated entry under the card's "## Activity" section with the question, the answer, and its source/);
    assert.match(prompt, /Update only the linked fact or baseline artifacts/);
    assert.match(prompt, /zero .*none .*unknown .*skipped/);
    assert.match(prompt, /Never fill a missing answer by inference/);
    assert.match(prompt, /Reread the saved card and every changed artifact .* before asking the next question/);
    assert.match(prompt, /No provider conversation id is needed/);
    assert.match(prompt, /Preserve unrelated facts, existing rows and all historical Activity/);
  });

  test('completion requires evidence and never bulk-checks or finishes on launch', () => {
    assert.match(prompt, /never bulk-check criteria/);
    assert.match(prompt, /only when the criterion explicitly allows them/);
    assert.match(prompt, /parse any changed JSON/);
    assert.match(prompt, /user-reported or verified evidence/);
    assert.match(prompt, /needs human verification or sign-off, leave it for that person/);
    assert.match(prompt, /Starting this chat is not evidence of completion/);
    assert.match(prompt, /do not change the card's assignee/);
  });

  test('a fully met interview records STATUS: DONE and supersedes a resolved blocked marker', () => {
    assert.match(prompt, /When every acceptance criterion is checked and no unresolved exception remains, end the closing Activity summary with `STATUS: DONE` on its own line/);
    assert.match(prompt, /reword that line into a plain note that no longer starts with `STATUS:`/);
    assert.match(prompt, /While any criterion stays open, add no `STATUS: DONE` line/);
    assert.match(prompt, /Writing the status never moves the card/);
  });

  test('the start entry is not completion evidence', () => {
    const entry = formatInterviewStartEntry('Claude Code', new Date('2026-10-09T12:00:00.000Z'));
    assert.match(entry, /2026-10-09T12:00:00\.000Z - AI-guided interview started in Claude Code/);
    assert.match(entry, /not evidence that any acceptance criterion is met/);
    assert.doesNotMatch(entry, /STATUS:/);
  });
});

suite('startCardInterview dispatch', () => {
  test('an eligible card launches once, keeps Human ownership and records only a start note', async () => {
    const { state, cardId } = interviewBoard();
    const h = harness(state);

    assert.equal(await startCardInterview(cardId, h.deps), 'started');

    assert.equal(h.prompts.length, 1);
    assert.ok(h.prompts[0]!.includes(`.mwnn/cards/${cardId}.md`));
    const card = findCard(h.getState(), cardId);
    assert.deepEqual(card.assignee, { kind: 'human', name: 'Alice' });
    assert.equal(card.acceptanceCriteria, '- [ ] Payroll system named\n- [ ] Headcount recorded (unknown allowed)');
    assert.match(card.activity ?? '', /AI-guided interview started in Claude Code/);
    assert.equal(h.getState().columns[1]!.cards[0]!.id, cardId);
  });

  test('ineligible cards never open the picker or a chat', async () => {
    for (const options of [{ assignee: 'none' as const }, { assignee: 'ai' as const }, { defined: false }]) {
      const { state, cardId } = interviewBoard(options);
      const h = harness(state);
      assert.equal(await startCardInterview(cardId, h.deps), 'ineligible');
      assert.equal(h.picks, 0);
      assert.equal(h.prompts.length, 0);
      assert.equal(findCard(h.getState(), cardId).activity, undefined);
      assert.equal(h.info.length, 1);
    }
  });

  test('a completed card is not re-dispatched', async () => {
    const { state, cardId } = interviewBoard();
    const h = harness(moveCard(state, cardId, state.columns[4]!.id, 0));
    assert.equal(await startCardInterview(cardId, h.deps), 'ineligible');
    assert.equal(h.prompts.length, 0);
    assert.match(h.info[0]!, /done column/);
  });

  test('eligibility is reread after the picker so a card moved to Done meanwhile is not launched', async () => {
    const { state, cardId } = interviewBoard();
    let h: Harness | undefined;
    h = harness(state, {
      pick: async () => {
        h!.setState(moveCard(h!.getState(), cardId, h!.getState().columns[4]!.id, 0));
        return { kind: 'picked', target: CLAUDE };
      },
    });
    assert.equal(await startCardInterview(cardId, h.deps), 'ineligible');
    assert.equal(h.prompts.length, 0);
    assert.equal(findCard(h.getState(), cardId).activity, undefined);
  });

  test('cancellation, no provider and delivery failure record nothing', async () => {
    const cases: { pick?: () => Promise<InterviewProviderPick>; delivered?: boolean; outcome: string }[] = [
      { pick: async () => ({ kind: 'cancelled' }), outcome: 'cancelled' },
      { pick: async () => ({ kind: 'unavailable', message: 'Install a chat extension.' }), outcome: 'unavailable' },
      { delivered: false, outcome: 'failed' },
    ];
    for (const { outcome, ...options } of cases) {
      const { state, cardId } = interviewBoard();
      const h = harness(state, options);
      assert.equal(await startCardInterview(cardId, h.deps), outcome);
      const card = findCard(h.getState(), cardId);
      assert.equal(card.activity, undefined, outcome);
      assert.deepEqual(card.assignee, { kind: 'human', name: 'Alice' });
      assert.equal(card.acceptanceCriteria, findCard(state, cardId).acceptanceCriteria);
    }
    const board = interviewBoard();
    const cancelled = harness(board.state, { pick: async () => ({ kind: 'cancelled' }) });
    await startCardInterview(board.cardId, cancelled.deps);
    assert.match(cancelled.info[0]!, /Interview not started/);
    const unavailable = harness(board.state, {
      pick: async () => ({ kind: 'unavailable', message: 'Install a chat extension.' }),
    });
    await startCardInterview(board.cardId, unavailable.deps);
    assert.deepEqual(unavailable.warnings, ['Install a chat extension.']);
  });

  test('a duplicate launch while one is starting is refused', async () => {
    const { state, cardId } = interviewBoard();
    let release: (pick: InterviewProviderPick) => void = () => undefined;
    const h = harness(state, { pick: () => new Promise((resolve) => (release = resolve)) });

    const first = startCardInterview(cardId, h.deps);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(await startCardInterview(cardId, h.deps), 'busy');
    release({ kind: 'picked', target: CLAUDE });
    assert.equal(await first, 'started');

    assert.equal(h.prompts.length, 1);
    assert.equal((findCard(h.getState(), cardId).activity ?? '').match(/interview started/g)?.length, 1);
    assert.equal(h.restartOffers, 1, 'a stuck-looking interview is offered a restart');
  });

  test('a hand-off of another kind keeps the busy message with no restart offer', async () => {
    const { state, cardId } = interviewBoard();
    const h = harness(state, { restart: true });
    let release: () => void = () => undefined;
    const other = h.inFlight.run(cardId, () => new Promise<void>((resolve) => (release = resolve)));

    assert.equal(await startCardInterview(cardId, h.deps), 'busy');
    assert.equal(h.restartOffers, 0);
    assert.equal(h.picks, 0);
    assert.match(h.info.at(-1)!, /already starting/);
    release();
    await other;
    assert.equal(h.inFlight.holder(cardId), undefined);
  });

  test('restarting after partial progress resumes from the saved card and preserves answers', async () => {
    const { state, cardId } = interviewBoard();
    const answers = [
      '### 2026-10-08 - Interview answer',
      'Q: Which payroll system? A: Ceridian (reported by Alice in interview chat, 2026-10-08).',
      'Q: Contractor headcount? A: zero (reported by Alice, 2026-10-08).',
      'Q: Union agreements? A: none. Q: Overtime policy owner? A: unknown. Q: Bonus pool? A: skipped.',
    ].join('\n');
    const h = harness(appendActivity(state, cardId, answers));

    assert.equal(await startCardInterview(cardId, h.deps), 'started');

    const activity = findCard(h.getState(), cardId).activity ?? '';
    assert.ok(activity.startsWith(answers), 'existing answers stay first and unchanged');
    assert.match(activity, /AI-guided interview started/);
    // The resume prompt points back at the durable record rather than a chat id.
    assert.ok(h.prompts[0]!.includes(`.mwnn/cards/${cardId}.md`));
    assert.match(h.prompts[0]!, /it may already hold answers from an earlier interview chat/);
    assert.equal(findCard(h.getState(), cardId).acceptanceCriteria?.includes('[x]'), false);
  });
});

suite('restarting a stuck interview', () => {
  const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  const startEntries = (h: Harness, cardId: string): number =>
    (findCard(h.getState(), cardId).activity ?? '').match(/interview started/g)?.length ?? 0;

  /** An interview whose first provider pick never settles until the test releases it. */
  function stuckInterview(options: { restart?: boolean } = {}) {
    const { state, cardId } = interviewBoard();
    const releases: ((pick: InterviewProviderPick) => void)[] = [];
    let first = true;
    const h = harness(state, {
      ...options,
      pick: () => {
        if (first) {
          first = false;
          return new Promise((resolve) => releases.push(resolve));
        }
        return Promise.resolve({ kind: 'picked', target: CLAUDE });
      },
    });
    const started = startCardInterview(cardId, h.deps);
    return { h, cardId, releases, started };
  }

  test('restart while the earlier attempt never resolves ends started with exactly one start entry', async () => {
    const { h, cardId } = stuckInterview({ restart: true });
    await tick();

    assert.equal(await startCardInterview(cardId, h.deps), 'started');

    assert.equal(h.restartOffers, 1);
    assert.equal(h.picks, 2, 'the restart runs the full flow, including a fresh provider pick');
    assert.equal(h.prompts.length, 1);
    assert.equal(startEntries(h, cardId), 1);
    assert.deepEqual(findCard(h.getState(), cardId).assignee, { kind: 'human', name: 'Alice' });
  });

  test('declining or waiting leaves the earlier attempt untouched and ends busy with no picker call', async () => {
    const { h, cardId, releases, started } = stuckInterview({ restart: false });
    await tick();

    assert.equal(await startCardInterview(cardId, h.deps), 'busy');
    assert.equal(h.restartOffers, 1);
    assert.equal(h.picks, 1, 'only the earlier attempt opened a picker');
    assert.equal(startEntries(h, cardId), 0);

    releases[0]!({ kind: 'picked', target: CLAUDE });
    assert.equal(await started, 'started', 'the untouched earlier attempt still completes');
    assert.equal(startEntries(h, cardId), 1);
  });

  test('the abandoned attempt resolving late writes nothing and shows no message', async () => {
    const { h, cardId, releases, started } = stuckInterview({ restart: true });
    await tick();
    assert.equal(await startCardInterview(cardId, h.deps), 'started');
    const infoBefore = h.info.length;

    releases[0]!({ kind: 'cancelled' });
    assert.equal(await started, 'superseded');
    assert.equal(h.info.length, infoBefore, 'no "no chat was chosen" notice');
    assert.deepEqual(h.warnings, []);
    assert.equal(startEntries(h, cardId), 1);
    assert.equal(h.prompts.length, 1);
  });

  test('an abandoned delivery that reports late success or failure neither records nor refreshes', async () => {
    for (const lateResult of [true, false]) {
      const { state, cardId } = interviewBoard();
      let finish: (delivered: boolean) => void = () => undefined;
      let calls = 0;
      let refreshes = 0;
      const h = harness(state, {
        restart: true,
        handOff: (_prompt, signal) => {
          calls += 1;
          if (calls === 1) {
            return new Promise<boolean>((resolve) => (finish = resolve));
          }
          assert.equal(signal.aborted, false);
          return Promise.resolve(true);
        },
      });
      h.deps = { ...h.deps, refreshBoard: () => { refreshes += 1; } };
      const first = startCardInterview(cardId, h.deps);
      await tick();

      assert.equal(await startCardInterview(cardId, h.deps), 'started');
      assert.equal(refreshes, 1);
      finish(lateResult);
      assert.equal(await first, 'superseded');
      assert.equal(refreshes, 1);
      assert.equal(startEntries(h, cardId), 1);
      assert.deepEqual(h.warnings, []);
    }
  });

  test('a card that became ineligible is refused on restart with the existing message', async () => {
    const { h, cardId } = stuckInterview({ restart: true });
    await tick();
    h.setState(moveCard(h.getState(), cardId, h.getState().columns[4]!.id, 0));

    assert.equal(await startCardInterview(cardId, h.deps), 'ineligible');
    assert.match(h.info.at(-1)!, /done column/);
    assert.equal(h.prompts.length, 0);
    assert.equal(startEntries(h, cardId), 0);
  });

  test('a restart chosen after the earlier attempt finished starts normally with one prompt', async () => {
    const { state, cardId } = interviewBoard();
    const h = harness(state, { restart: true });
    // restartExclusive finds no holder when the lock was already freed.
    assert.deepEqual(await h.deps.restartExclusive(cardId, async () => 'ran'), { started: true, value: 'ran' });
    assert.equal(await startCardInterview(cardId, h.deps), 'started');
    assert.equal(h.restartOffers, 0);
    assert.equal(h.prompts.length, 1);
    assert.equal(startEntries(h, cardId), 1);
  });

  test('a third click during the restarted attempt still sees the busy state', async () => {
    const { state, cardId } = interviewBoard();
    const releases: ((pick: InterviewProviderPick) => void)[] = [];
    const h = harness(state, {
      restart: true,
      pick: () => new Promise((resolve) => releases.push(resolve)),
    });
    const first = startCardInterview(cardId, h.deps);
    await tick();
    const second = startCardInterview(cardId, h.deps);
    await tick();

    releases[0]!({ kind: 'cancelled' });
    assert.equal(await first, 'superseded');
    assert.equal(h.inFlight.holder(cardId), 'interview', 'the stale release did not free the new lock');

    h.deps = { ...h.deps, confirmRestart: async () => false };
    assert.equal(await startCardInterview(cardId, h.deps), 'busy');
    assert.equal(h.picks, 2, 'the declined third click opened no picker');

    releases[1]!({ kind: 'picked', target: CLAUDE });
    assert.equal(await second, 'started');
    assert.equal(h.inFlight.holder(cardId), undefined);
    assert.equal(startEntries(h, cardId), 1);
  });
});

suite('interview cards and the unattended AI loop', () => {
  test('the AI loop never dispatches or changes an interview card', async () => {
    const { state, cardId } = interviewBoard();
    let current = cloneBoard(state);
    const calls: string[] = [];
    const store: LoopStore = {
      reload: async () => cloneBoard(current),
      moveCard: async (id, toColumnId, toIndex) => {
        current = moveCard(current, id, toColumnId, toIndex);
      },
      setAssignee: async (id, assignee) => {
        current = setAssignee(current, id, assignee);
      },
      setAcceptanceCriteria: async (id, value) => {
        current = setAcceptanceCriteria(current, id, value);
      },
      appendActivity: async (id, entry) => {
        current = appendActivity(current, id, entry);
      },
    };
    const gateways = new Proxy({}, {
      get: (_target, name) => async () => {
        calls.push(String(name));
        return { started: false };
      },
    }) as LoopGateways;

    await runBoardLoop(store, gateways, { isCancelled: () => false, delay: async () => undefined }, { pollIntervalMs: 0 });

    const card = findCard(current, cardId);
    assert.deepEqual(calls, []);
    assert.deepEqual(card.assignee, { kind: 'human', name: 'Alice' });
    assert.equal(card.activity, undefined);
    assert.equal(current.columns[1]!.cards[0]!.id, cardId);
  });
});
