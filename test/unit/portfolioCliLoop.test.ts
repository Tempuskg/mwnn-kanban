import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPortfolioCliLoopCapability, isPortfolioPrimaryBoard, type PortfolioCliLoopDeps } from '../../src/portfolioCliLoop';
import { runAgentCliCardHandoff, type AgentCliCardHandoff, type AgentCliInvocation, type AgentCliProcessResult, type AgentCliTarget } from '../../src/agentCliHandoff';
import type { PortfolioLoopProgress, PortfolioLoopProject, PortfolioLoopSessionV1 } from '../../src/pro/contracts';
import type { BoardStore } from '../../src/boardStore';
import type { BoardState, Card } from '../../src/types';
import { cloneBoard, appendActivity, moveCard, setAssignee, setDescription, setAcceptanceCriteria } from '../../src/utils';

const project = (id: string): PortfolioLoopProject => ({ projectId: id, projectName: id, root: '/repos/' + id, boardFolder: '.tasks' });
function board(extra: Partial<Card> = {}, role = 'in-progress'): BoardState {
  const card: Card = { id: 'same', title: 'Task', createdAt: 1, description: 'Implement', acceptanceCriteria: '- [ ] Pass', assignee: { kind: 'ai' }, ...extra };
  return { version: 2, columns: ['backlog', 'ready', 'in-progress', 'verify', 'done'].map(value => ({ id: value, title: value, role: value as NonNullable<BoardState['columns'][number]['role']>, wipLimit: null, reverseWip: null, cards: value === role ? [card] : [] })) };
}
function titleOnlyBoard(): BoardState { const state = board({}, 'backlog'); const card = state.columns[0]!.cards[0]!; delete card.assignee; delete card.description; delete card.acceptanceCriteria; return state; }
function memory(initial: BoardState) {
  let state = cloneBoard(initial);
  const store = {
    reload: async () => cloneBoard(state), getState: () => cloneBoard(state),
    moveCard: async (id: string, col: string, index: number) => { state = moveCard(state, id, col, index); },
    setAssignee: async (id: string, assignee: Card['assignee']) => { state = setAssignee(state, id, assignee); },
    setAcceptanceCriteria: async (id: string, criteria: string) => { state = setAcceptanceCriteria(state, id, criteria); },
    appendActivity: async (id: string, entry: string) => { state = appendActivity(state, id, entry); },
  } as unknown as BoardStore;
  return { store, state: () => cloneBoard(state), mutate: (fn: (s: BoardState) => BoardState) => { state = fn(state); } };
}
const target = (provider: AgentCliTarget['provider']): AgentCliTarget => ({ provider, label: provider, executable: provider, launcher: 'standalone' });
const exit = (stderr = '', code = 0): AgentCliProcessResult => ({ started: true, cancelled: false, exitCode: code, signal: null, stdout: 'STATUS: DONE', stderr });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function until(check: () => boolean) { for (let i = 0; i < 100; i++) { if (check()) { return; } await new Promise<void>(resolve => setImmediate(resolve)); } assert.fail('Condition did not settle'); }
function harness(options: Pick<PortfolioCliLoopDeps, 'options' | 'maxDispatches'> = { options: () => ({}), maxDispatches: () => undefined }) {
  const boards = new Map([['/repos/A', memory(board())], ['/repos/B', memory(board())]]);
  let busy = false; let picks = 0; let released = 0;
  const calls: { stage: string; cwd: string; provider: string; prompt: string; args: readonly string[] }[] = [];
  let hook: ((handoff: AgentCliCardHandoff, invocation: AgentCliInvocation) => Promise<AgentCliProcessResult | undefined>) | undefined;
  const deps: PortfolioCliLoopDeps = {
    enabled: () => true, busy: () => busy,
    acquire: () => { if (busy) { return undefined; } busy = true; return () => { busy = false; released++; }; },
    onDidChange: () => ({ dispose: () => undefined }),
    pick: async () => { picks++; return {
      initialTarget: target('codex'), configuredPaths: {}, settings: { enabled: true, providers: ['claude-code'] },
      resolveTarget: async provider => ({ available: true, target: target(provider) }),
      stageModels: { implementation: 'stage-model' },
      runHandoff: (handoff, opts) => runAgentCliCardHandoff(handoff, { ...opts, runProcess: async invocation => {
        calls.push({ stage: handoff.kind, cwd: invocation.cwd, provider: invocation.provider, prompt: invocation.stdin, args: invocation.args });
        const result = await hook?.(handoff, invocation); if (result) { return result; }
        const data = boards.get(invocation.cwd)!;
        if (handoff.kind === 'definition') { data.mutate(s => setAcceptanceCriteria(setDescription(s, handoff.cardId, 'Defined task'), handoff.cardId, '- [ ] Definition meets task')); }
        if (handoff.kind === 'triage') { data.mutate(s => setAssignee(s, handoff.cardId, { kind: 'ai' })); }
        const note = handoff.kind === 'verification' ? 'VERIFY: PASS' : 'STATUS: DONE';
        data.mutate(s => appendActivity(s, handoff.cardId, note));
        return exit();
      } }),
    }; },
    openStore: async p => boards.get(p.root)?.store,
    definitionSettings: () => ({ candidates: { models: {}, thinkingLevels: {} }, overwriteExisting: false, mode: { kind: 'agent', reason: 'test' } }),
    finishDefinition: async () => undefined,
    delay: async () => { await new Promise<void>(resolve => setImmediate(resolve)); },
    ...options,
  };
  const capability = createPortfolioCliLoopCapability(deps);
  return { capability, deps, boards, calls, hook: (fn: NonNullable<typeof hook>) => { hook = fn; }, counts: () => ({ busy, picks, released }) };
}
async function start(h: ReturnType<typeof harness>): Promise<PortfolioLoopSessionV1> { const session = await h.capability.start(); assert.ok(session); return session; }

test('full public lifecycle runs only the selected card, in the unopened root and correct board path', async () => {
  const h = harness({ options: () => ({ verifyWithAi: true }), maxDispatches: () => undefined });
  h.boards.set('/repos/A', memory(titleOnlyBoard()));
  const session = await start(h);
  const pick = await session.selectCard(project('A')); assert.equal(pick.kind, 'card');
  const result = await session.runCard(project('A'), 'same', () => undefined);
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(h.calls.map(c => c.stage), ['definition', 'triage', 'implementation', 'verification']);
  assert.ok(h.calls.every(c => c.cwd === '/repos/A' && c.prompt.includes('.tasks/cards/same.md')));
  assert.equal(h.boards.get('/repos/A')!.state().columns[4]!.cards[0]!.id, 'same');
  assert.equal(h.boards.get('/repos/B')!.state().columns[2]!.cards.length, 1);
  session.finish(); assert.equal(h.counts().released, 1);
});

test('human verification handback is actionable and duplicate card ids have independent evidence', async () => {
  const h = harness(); const session = await start(h);
  for (const id of ['A', 'B']) { const result = await session.runCard(project(id), 'same', () => undefined); assert.equal(result.outcome, 'human'); }
  assert.deepEqual(h.calls.map(c => c.cwd), ['/repos/A', '/repos/B']);
  for (const data of h.boards.values()) { const card = data.state().columns[3]!.cards[0]!; assert.equal(card.assignee?.kind, 'human'); assert.match(card.activity ?? '', /Human verification procedure/); }
  session.finish();
});

test('fresh-definition review holds persist across returns to the same project', async () => {
  const h = harness({ options: () => ({ reviewFreshDefinitions: true }), maxDispatches: () => undefined });
  const undefinedCard = titleOnlyBoard();
  h.boards.set('/repos/A', memory(undefinedCard)); const session = await start(h);
  assert.equal((await session.runCard(project('A'), 'same', () => undefined)).outcome, 'review');
  assert.equal((await session.selectCard(project('A'))).kind, 'empty');
  assert.ok(!h.calls.some(c => c.stage === 'implementation')); assert.equal(h.boards.get('/repos/A')!.state().columns[1]!.cards.length, 1);
  session.finish();
});

test('Human, Done, dependencies, WIP and reverse-WIP use the unfiltered full board', async () => {
  const h = harness(); const session = await start(h);
  h.boards.set('/repos/A', memory(board({ assignee: { kind: 'human' } }))); assert.equal((await session.selectCard(project('A'))).kind, 'empty');
  h.boards.set('/repos/A', memory(board({}, 'done'))); assert.equal((await session.selectCard(project('A'))).kind, 'empty');
  const dependent = board({ dependsOn: ['dependency'] }, 'ready'); dependent.columns[0]!.cards.push({ id: 'dependency', title: 'Unfinished', createdAt: 2, assignee: { kind: 'human' } }); h.boards.set('/repos/A', memory(dependent)); assert.equal((await session.selectCard(project('A'))).kind, 'empty');
  const limited = board({}, 'ready'); limited.columns[2]!.wipLimit = 0; h.boards.set('/repos/A', memory(limited)); assert.equal((await session.selectCard(project('A'))).kind, 'empty');
  const reverse = board({}, 'ready'); reverse.columns[1]!.reverseWip = 3; reverse.columns[0]!.cards.push({ id: 'other', title: 'Another', createdAt: 2 }); h.boards.set('/repos/A', memory(reverse));
  const pick = await session.selectCard(project('A')); assert.equal(pick.kind, 'card'); if (pick.kind === 'card') { assert.equal(pick.card.cardId, 'other'); }
  assert.equal(h.calls.length, 0); session.finish();
});

test('stale completion and non-passing verification are never accepted as Done', async () => {
  const h = harness({ options: () => ({ verifyWithAi: true }), maxDispatches: () => undefined });
  h.boards.set('/repos/A', memory(board({ activity: 'STATUS: DONE' })));
  h.hook(async () => exit()); const session = await start(h);
  assert.equal((await session.runCard(project('A'), 'same', () => undefined)).outcome, 'skipped');
  assert.equal((await session.selectCard(project('A'))).kind, 'empty');
  h.boards.set('/repos/B', memory(board({}, 'verify')));
  assert.equal((await session.runCard(project('B'), 'same', () => undefined)).outcome, 'human');
  assert.equal(h.boards.get('/repos/B')!.state().columns[4]!.cards.length, 0); session.finish();
});

test('BLOCKED handoff is skipped against the correct project and never retried', async () => {
  const h = harness(); h.hook(async handoff => { if (handoff.cwd === '/repos/A') { h.boards.get(handoff.cwd)!.mutate(s => appendActivity(s, handoff.cardId, 'STATUS: BLOCKED: needs a person')); return exit(); } return undefined; });
  const session = await start(h); assert.equal((await session.runCard(project('A'), 'same', () => undefined)).outcome, 'skipped'); assert.equal((await session.selectCard(project('A'))).kind, 'empty');
  assert.equal((await session.runCard(project('B'), 'same', () => undefined)).outcome, 'human'); session.finish();
});

test('one shared budget and credit fallback spans stages and projects; per-stage model rules survive', async () => {
  const h = harness({ options: () => ({}), maxDispatches: () => 2 });
  h.hook(async handoff => handoff.target.provider === 'codex' ? exit('This account is out of credits.', 1) : undefined);
  const session = await start(h); assert.equal((await session.runCard(project('A'), 'same', () => undefined)).outcome, 'human');
  assert.equal((await session.runCard(project('B'), 'same', () => undefined)).outcome, 'stopped');
  assert.equal(session.outcome(), 'budget'); assert.deepEqual(h.calls.map(c => c.provider), ['codex', 'claude-code']);
  assert.ok(h.calls[0]!.args.includes('stage-model')); assert.match(h.boards.get('/repos/B')!.state().columns[2]!.cards[0]!.activity ?? '', /dispatch budget/i);
  assert.match(session.finish(), /2/);
});

test('credit exhaustion without fallback is distinct from a budget stop', async () => {
  const h = harness(); const original = h.deps.pick;
  h.deps.pick = async () => { const options = await original(); return options ? { ...options, settings: { enabled: false, providers: [] } } : undefined; };
  h.hook(async () => exit('This account is out of credits.', 1)); const session = await start(h);
  await session.runCard(project('A'), 'same', () => undefined); assert.equal(session.outcome(), 'credits'); assert.equal(h.calls.length, 1); session.finish();
});

test('a reset within the cap waits instead of ending with credits, and reports the wait as progress', async () => {
  const h = harness(); const original = h.deps.pick;
  let now = Date.parse('2026-10-21T09:00:00.000Z'); const reset = now + 2 * 3_600_000;
  h.deps.pick = async () => { const options = await original(); return options ? {
    ...options, settings: { enabled: false, providers: [] }, now: () => new Date(now),
    usageResetWait: {
      maxWaitHours: 6,
      probe: async probed => now < reset ? { kind: 'reported', provider: probed.provider, remainingPercent: 0, resetsAt: reset } : { kind: 'reported', provider: probed.provider, remainingPercent: 80 },
      delay: async ms => { now += ms; await new Promise<void>(resolve => setImmediate(resolve)); },
    },
  } : undefined; };
  h.hook(async () => h.calls.length === 1 ? exit('This account is out of credits.', 1) : undefined);
  const messages: string[] = []; const session = await start(h);
  const result = await session.runCard(project('A'), 'same', progress => { messages.push(progress.message); });
  assert.notEqual(session.outcome(), 'credits'); assert.notEqual(result.outcome, 'stopped');
  assert.equal(h.calls.length, 2); assert.ok(now >= reset);
  assert.ok(messages.some(message => /^Waiting for .+ usage limit to reset at /.test(message)));
  session.finish();
});

test('a usage-reset wait reports structured usageWait, then omits the key once the stage resumes', async () => {
  const h = harness(); const original = h.deps.pick;
  let now = Date.parse('2026-10-21T09:00:00.000Z'); const reset = now + 2 * 3_600_000;
  h.deps.pick = async () => { const options = await original(); return options ? {
    ...options, settings: { enabled: false, providers: [] }, now: () => new Date(now),
    usageResetWait: {
      maxWaitHours: 6,
      probe: async probed => now < reset ? { kind: 'reported', provider: probed.provider, remainingPercent: 0, resetsAt: reset } : { kind: 'reported', provider: probed.provider, remainingPercent: 80 },
      delay: async ms => { now += ms; await new Promise<void>(resolve => setImmediate(resolve)); },
    },
  } : undefined; };
  h.hook(async () => h.calls.length === 1 ? exit('This account is out of credits.', 1) : undefined);
  const reports: PortfolioLoopProgress[] = []; const session = await start(h);
  await session.runCard(project('A'), 'same', progress => { reports.push(progress); });
  const waiting = reports.findIndex(progress => progress.usageWait !== undefined);
  assert.ok(waiting >= 0);
  assert.deepEqual(reports[waiting]!.usageWait, { providerLabel: 'OpenAI Codex CLI', resetsAt: reset });
  assert.match(reports[waiting]!.message, /^Waiting for /);
  const after = reports.slice(waiting + 1).find(progress => !('usageWait' in progress));
  assert.ok(after, 'a later report omits usageWait'); assert.match(after.message, /has reset/);
  assert.ok(reports.filter(progress => progress.usageWait === undefined).every(progress => !('usageWait' in progress)));
  session.finish();
});

test('a wait that runs out clears usageWait and puts the host reason in the credits summary', async () => {
  const h = harness(); const original = h.deps.pick;
  let now = Date.parse('2026-10-21T09:00:00.000Z');
  h.deps.pick = async () => { const options = await original(); return options ? {
    ...options, settings: { enabled: false, providers: [] }, now: () => new Date(now),
    usageResetWait: {
      maxWaitHours: 1,
      probe: async probed => ({ kind: 'unknown', provider: probed.provider, reason: 'no usage report' }),
      delay: async ms => { now += ms; await new Promise<void>(resolve => setImmediate(resolve)); },
    },
  } : undefined; };
  h.hook(async () => exit('This account is out of credits.', 1));
  const reports: PortfolioLoopProgress[] = []; const session = await start(h);
  await session.runCard(project('A'), 'same', progress => { reports.push(progress); });
  const waiting = reports.find(progress => progress.usageWait !== undefined);
  assert.equal(waiting?.usageWait?.providerLabel, 'OpenAI Codex CLI');
  assert.equal(typeof waiting?.usageWait?.nextCheckAt, 'number'); assert.ok(!('resetsAt' in waiting!.usageWait!));
  assert.ok(!('usageWait' in reports[reports.length - 1]!));
  assert.equal(session.outcome(), 'credits'); assert.equal(h.calls.length, 1);
  assert.match(session.finish(), /No usage reset was reported for .+ within the 1-hour maximum wait/);
});

test('pause allows current CLI to finish but holds advancement; Stop releases a paused run', async () => {
  const h = harness(); const stage = deferred(); h.hook(async () => { await stage.promise; return undefined; }); const session = await start(h);
  const running = session.runCard(project('A'), 'same', () => undefined); await until(() => h.calls.length === 1); session.pause(); stage.resolve();
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(h.boards.get('/repos/A')!.state().columns[2]!.cards.length, 1);
  session.resume(); assert.equal((await running).outcome, 'human'); assert.equal(h.counts().picks, 1); session.finish();
  const paused = harness(); const hold = deferred(); paused.hook(async () => { await hold.promise; return undefined; }); const next = await start(paused); const pending = next.runCard(project('A'), 'same', () => undefined);
  await until(() => paused.calls.length === 1); next.pause(); hold.resolve(); await new Promise<void>(resolve => setImmediate(resolve)); next.stop(); assert.equal((await pending).outcome, 'stopped'); assert.equal(paused.calls.length, 1); next.finish();
});

test('Stop cancels active CLI; lease blocks concurrent loops and picker cancellation releases it', async () => {
  const h = harness(); h.hook(async handoff => { await new Promise<void>(resolve => handoff.signal.addEventListener('abort', () => resolve(), { once: true })); return { ...exit(), cancelled: true }; });
  const session = await start(h); assert.equal(await h.capability.start(), undefined); const pending = session.runCard(project('A'), 'same', () => undefined); await until(() => h.calls.length === 1); session.stop(); assert.equal((await pending).outcome, 'stopped'); session.finish();
  assert.equal(h.counts().busy, false); assert.equal(h.boards.get('/repos/A')!.state().columns[2]!.cards.length, 1);
  const cancelled = harness(); cancelled.deps.pick = async () => undefined; assert.equal(await cancelled.capability.start(), undefined); assert.equal(cancelled.counts().busy, false);
});


test('pause holds a credit-fallback process and the shared ledger survives resume', async () => {
  const h = harness({ options: () => ({}), maxDispatches: () => 2 }); const failed = deferred();
  h.hook(async handoff => { if (handoff.target.provider === 'codex') { await failed.promise; return exit('This account is out of credits.', 1); } return undefined; });
  const session = await start(h); const running = session.runCard(project('A'), 'same', () => undefined);
  await until(() => h.calls.length === 1); session.pause(); failed.resolve();
  await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(h.calls.length, 1);
  session.resume(); assert.equal((await running).outcome, 'human');
  assert.equal((await session.runCard(project('B'), 'same', () => undefined)).outcome, 'stopped'); assert.equal(session.outcome(), 'budget'); assert.equal(h.calls.length, 2); session.finish();
});


test('another root of one registered project cannot duplicate a settled card', async () => {
  const h = harness(); h.boards.set('/repos/clone', memory(board())); const session = await start(h);
  assert.equal((await session.runCard(project('A'), 'same', () => undefined)).outcome, 'human');
  assert.equal((await session.selectCard({ ...project('A'), root: '/repos/clone' })).kind, 'empty');
  assert.equal((await session.selectCard(project('B'))).kind, 'card'); session.finish();
});


test('primary-store matching respects Windows aliases and Linux root case', () => {
  assert.equal(isPortfolioPrimaryBoard('C:/Repo/', '.tasks', 'c:/repo', './.tasks', 'win32'), true);
  assert.equal(isPortfolioPrimaryBoard('/repos/A', '.tasks', '/repos/a', '.tasks', 'linux'), false);
  assert.equal(isPortfolioPrimaryBoard('/repos/A', '.tasks', '/repos/A', '.mwnn', 'linux'), false);
});


test('blocked selection metadata distinguishes empty and completed boards from dependency and capacity holds', async () => {
  const h = harness(); const session = await start(h);
  for (const state of [board({ assignee: { kind: 'human' } }), board({}, 'done')]) {
    h.boards.set('/repos/A', memory(state));
    const choice = await session.selectCard(project('A'));
    assert.equal(choice.kind, 'empty');
    if (choice.kind === 'empty') { assert.equal(choice.blocked, undefined); }
  }
  const dependent = board({ dependsOn: ['dependency'] }, 'ready');
  dependent.columns[0]!.cards.push({ id: 'dependency', title: 'Human prerequisite', createdAt: 2, assignee: { kind: 'human' } });
  const limited = board({}, 'ready'); limited.columns[2]!.wipLimit = 0;
  for (const state of [dependent, limited]) {
    const data = memory(state); h.boards.set('/repos/A', data);
    const before = data.state();
    const choice = await session.selectCard(project('A'));
    assert.equal(choice.kind, 'empty');
    if (choice.kind === 'empty') { assert.equal(choice.blocked, true); }
    assert.deepEqual(data.state(), before, 'selection preserves placement, dependencies and evidence');
  }
  assert.equal(h.calls.length, 0);
  session.finish();
});

test('a blocked handoff reports remaining blocked work and a fresh session can select it again', async () => {
  const h = harness();
  h.hook(async handoff => {
    h.boards.get(handoff.cwd)!.mutate(s => appendActivity(s, handoff.cardId, 'STATUS: BLOCKED: needs a person'));
    return exit();
  });
  const session = await start(h);
  assert.equal((await session.runCard(project('A'), 'same', () => undefined)).outcome, 'skipped');
  const before = h.boards.get('/repos/A')!.state();
  const choice = await session.selectCard(project('A'));
  assert.equal(choice.kind, 'empty');
  if (choice.kind === 'empty') { assert.equal(choice.blocked, true); }
  assert.equal((await session.selectCard(project('B'))).kind, 'card', 'the same id in another project remains runnable');
  assert.deepEqual(h.boards.get('/repos/A')!.state(), before);
  assert.equal(h.calls.length, 1);
  session.finish();
  const next = await start(h);
  assert.equal((await next.selectCard(project('A'))).kind, 'card', 'new Play has fresh session skips');
  next.finish();
  assert.equal(h.counts().released, 2);
});
