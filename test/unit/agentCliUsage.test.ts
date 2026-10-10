import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { suite, test } from 'node:test';
import { AGENT_CLI_LABELS, type AgentCliProviderId, type AgentCliTarget } from '../../src/agentCliHandoff';
import {
  normalizeUsageWindows,
  parseClaudeCodeUsageOutput,
  parseCopilotQuota,
  parseCodexRateLimits,
  rankAgentClis,
  unknownUsage,
  type AgentCliRankCandidate,
  type AgentCliUsageSnapshot,
} from '../../src/agentCliUsage';
import {
  copilotUsageLaunch,
  probeAgentCliUsage,
  probeClaudeCodeUsage,
  probeCopilotUsage,
  probeCodexUsage,
} from '../../src/agentCliUsageProbe';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function reported(
  provider: AgentCliProviderId,
  remainingPercent: number,
  resetsAt?: number,
): AgentCliRankCandidate {
  return {
    provider,
    available: true,
    snapshot: {
      kind: 'reported',
      provider,
      remainingPercent,
      ...(resetsAt !== undefined ? { resetsAt } : {}),
    },
  };
}

function unknown(provider: AgentCliProviderId): AgentCliRankCandidate {
  return { provider, available: true, snapshot: unknownUsage(provider, 'not readable') };
}

function order(candidates: readonly AgentCliRankCandidate[], exclusions = new Map()): string[] {
  return rankAgentClis(candidates, exclusions, NOW).ranked.map((entry) => entry.provider);
}

suite('usage snapshot normalization', () => {
  test('a multi-window report binds to the lowest remaining window and its reset time', () => {
    const snapshot = normalizeUsageWindows('codex', [
      { remainingPercent: 94, resetsAt: NOW + 100 * HOUR },
      { remainingPercent: 30, resetsAt: NOW + 3 * HOUR },
    ]);
    assert.deepEqual(snapshot, {
      kind: 'reported',
      provider: 'codex',
      remainingPercent: 30,
      resetsAt: NOW + 3 * HOUR,
    });
  });

  test('clamps percentages to 0-100 and reports no windows as unknown', () => {
    const clamped = normalizeUsageWindows('codex', [{ remainingPercent: -12 }]);
    assert.equal(clamped.kind === 'reported' ? clamped.remainingPercent : undefined, 0);
    assert.equal(normalizeUsageWindows('codex', []).kind, 'unknown');
  });

  test('unknown reasons are redacted single lines', () => {
    const snapshot = unknownUsage('codex', 'failed\nwith token sk-live-ABCDEF1234567890');
    assert.equal(snapshot.kind, 'unknown');
    assert.ok(snapshot.kind === 'unknown' && !snapshot.reason.includes('sk-live-ABCDEF1234567890'));
    assert.ok(snapshot.kind === 'unknown' && !snapshot.reason.includes('\n'));
  });
});

const CLAUDE_NOW = Date.parse('2026-10-07T12:00:00.000Z');

async function readClaudeFixture(name: string): Promise<string> {
  const fixturePath = path.resolve(__dirname, '../../../test/fixtures', name);
  return fs.readFile(fixturePath, 'utf8');
}

suite('Claude Code local /usage parsing', () => {
  test('normalizes session and weekly windows to the binding window', async () => {
    const snapshot = parseClaudeCodeUsageOutput(
      await readClaudeFixture('claude-usage-two-windows.json'),
      CLAUDE_NOW,
    );
    assert.deepEqual(snapshot, {
      kind: 'reported',
      provider: 'claude-code',
      remainingPercent: 38.75,
      resetsAt: Date.parse('2026-10-13T15:00:00.000Z'),
    });
  });

  test('accepts a single reported window', async () => {
    const snapshot = parseClaudeCodeUsageOutput(
      await readClaudeFixture('claude-usage-single-window.json'),
      CLAUDE_NOW,
    );
    assert.deepEqual(snapshot, {
      kind: 'reported',
      provider: 'claude-code',
      remainingPercent: 73,
      resetsAt: Date.parse('2026-10-11T19:00:00.000Z'),
    });
  });

  test('accepts an on-the-hour reset time printed without minutes', () => {
    const snapshot = parseClaudeCodeUsageOutput(JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      local_command: 'usage',
      num_turns: 0,
      duration_api_ms: 0,
      result: 'Current session: 4% used · resets Oct 9, 7:20pm (America/Regina)\n'
        + 'Current week (all models): 27% used · resets Oct 12, 3am (America/Regina)',
    }), CLAUDE_NOW);
    assert.deepEqual(snapshot, {
      kind: 'reported',
      provider: 'claude-code',
      remainingPercent: 73,
      resetsAt: Date.parse('2026-10-12T09:00:00.000Z'),
    });
  });

  test('a missing reset time is unknown with a reason', async () => {
    const snapshot = parseClaudeCodeUsageOutput(
      await readClaudeFixture('claude-usage-missing-reset.json'),
      CLAUDE_NOW,
    );
    assert.equal(snapshot.kind, 'unknown');
    assert.match(snapshot.kind === 'unknown' ? snapshot.reason : '', /missing its reset time/i);
  });

  test('an API-key account that reports no plan windows is unknown with a reason', async () => {
    const snapshot = parseClaudeCodeUsageOutput(
      await readClaudeFixture('claude-usage-api-key.json'),
      CLAUDE_NOW,
    );
    assert.equal(snapshot.kind, 'unknown');
    assert.match(snapshot.kind === 'unknown' ? snapshot.reason : '', /API key|plan usage/i);
  });

  test('malformed or hostile output is unknown and is not copied into the reason', async () => {
    const fixture = await readClaudeFixture('claude-usage-malformed.txt');
    const snapshot = parseClaudeCodeUsageOutput(fixture, CLAUDE_NOW);
    assert.equal(snapshot.kind, 'unknown');
    assert.ok(snapshot.kind === 'unknown' && !snapshot.reason.includes('sk-live-ABCDEF1234567890'));
  });

  test('a result with model turns is rejected as unknown', async () => {
    const fixture = JSON.parse(await readClaudeFixture('claude-usage-single-window.json')) as Record<string, unknown>;
    const snapshot = parseClaudeCodeUsageOutput(
      JSON.stringify({ ...fixture, num_turns: 1, duration_api_ms: 20 }),
      CLAUDE_NOW,
    );
    assert.equal(snapshot.kind, 'unknown');
    assert.match(snapshot.kind === 'unknown' ? snapshot.reason : '', /zero-turn local/i);
  });

  test('missing local-command fields or usage percentages are unknown', async () => {
    const fixture = JSON.parse(await readClaudeFixture('claude-usage-single-window.json')) as Record<string, unknown>;
    const missingEnvelopeField = { ...fixture };
    delete missingEnvelopeField['duration_api_ms'];
    assert.equal(parseClaudeCodeUsageOutput(JSON.stringify(missingEnvelopeField), CLAUDE_NOW).kind, 'unknown');

    const missingPercentage = {
      ...fixture,
      result: 'Current session: usage unavailable · resets Oct 9, 10:30pm (America/Regina)',
    };
    assert.equal(parseClaudeCodeUsageOutput(JSON.stringify(missingPercentage), CLAUDE_NOW).kind, 'unknown');
  });
});

suite('Codex account/rateLimits/read parsing', () => {
  test('reads the real app-server shape: used percent and Unix-second reset times', () => {
    const snapshot = parseCodexRateLimits({
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 6, windowDurationMins: 10080, resetsAt: 1791980642 },
        secondary: null,
        credits: { hasCredits: false, unlimited: false, balance: '0' },
        planType: 'plus',
        rateLimitReachedType: null,
      },
    });
    assert.deepEqual(snapshot, {
      kind: 'reported',
      provider: 'codex',
      remainingPercent: 94,
      resetsAt: 1791980642 * 1000,
    });
  });

  test('a 5-hour and a weekly window normalize to the binding one', () => {
    const snapshot = parseCodexRateLimits({
      rateLimits: {
        primary: { usedPercent: 80, windowDurationMins: 300, resetsAt: 1791400000 },
        secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: 1791980642 },
      },
    });
    assert.deepEqual(snapshot, {
      kind: 'reported',
      provider: 'codex',
      remainingPercent: 20,
      resetsAt: 1791400000 * 1000,
    });
  });

  test('a limit Codex says is reached is 0% remaining', () => {
    const snapshot = parseCodexRateLimits({
      rateLimits: {
        primary: { usedPercent: 40, resetsAt: 1791400000 },
        rateLimitReachedType: 'primary',
      },
    });
    assert.equal(snapshot.kind === 'reported' ? snapshot.remainingPercent : undefined, 0);
  });

  test('malformed or hostile responses are unknown, never guessed', () => {
    const inputs: unknown[] = [
      null,
      'rate limits',
      [],
      {},
      { rateLimits: null },
      { rateLimits: { primary: { usedPercent: 'lots' } } },
      { rateLimits: { primary: ['x'] } },
      { rateLimits: { primary: { usedPercent: Number.NaN } } },
      { rateLimits: { primary: null, secondary: null } },
      { rateLimits: { primary: { usedPercent: 10 }, secondary: 'weekly' } },
    ];
    for (const input of inputs) {
      assert.equal(parseCodexRateLimits(input).kind, 'unknown', JSON.stringify(input));
    }
  });
});

async function readCopilotFixture(name: string): Promise<string> {
  const fixturePath = path.resolve(__dirname, '../../../test/fixtures', name);
  return fs.readFile(fixturePath, 'utf8');
}

const COPILOT_NOW = Date.parse('2026-10-09T12:00:00.000Z');

suite('Copilot account.getQuota parsing', () => {
  test('reads the premium-interactions remaining percentage and reset date', async () => {
    const response = JSON.parse(await readCopilotFixture('copilot-usage-normal.json')) as Record<string, unknown>;
    assert.deepEqual(parseCopilotQuota(response['result'], COPILOT_NOW), {
      kind: 'reported',
      provider: 'copilot',
      remainingPercent: 42.5,
      resetsAt: Date.parse('2026-10-16T00:00:00.000Z'),
    });
  });

  test('an unlimited quota is 100% remaining with no reset time', async () => {
    const response = JSON.parse(await readCopilotFixture('copilot-usage-unlimited.json')) as Record<string, unknown>;
    assert.deepEqual(parseCopilotQuota(response['result'], COPILOT_NOW), {
      kind: 'reported',
      provider: 'copilot',
      remainingPercent: 100,
    });
  });

  test('a missing reset date keeps the reported percentage without inventing a reset', async () => {
    const response = JSON.parse(await readCopilotFixture('copilot-usage-missing-reset.json')) as Record<string, unknown>;
    assert.deepEqual(parseCopilotQuota(response['result'], COPILOT_NOW), {
      kind: 'reported',
      provider: 'copilot',
      remainingPercent: 75,
    });
  });

  test('an account with no premium allowance is unknown, not a spent quota about to reset', () => {
    // Shape returned live by a Copilot Free account: the reset date is already past.
    const snapshot = parseCopilotQuota({
      quotaSnapshots: {
        premium_interactions: {
          entitlementRequests: 0,
          usedRequests: 0,
          remainingPercentage: 0,
          resetDate: '2026-10-09T05:21:20.137-07:00',
          hasQuota: false,
        },
      },
    }, COPILOT_NOW);
    assert.equal(snapshot.kind, 'unknown');
    assert.match(snapshot.kind === 'unknown' ? snapshot.reason : '', /no premium-request allowance/);
  });

  test('an account with no premium allowance reports its chat quota instead', () => {
    // Shape returned live by a Copilot Free account.
    const snapshot = parseCopilotQuota({
      quotaSnapshots: {
        chat: {
          entitlementRequests: 200,
          usedRequests: 1,
          remainingPercentage: 99.5,
          resetDate: '2026-11-09T14:21:20.137-07:00',
        },
        premium_interactions: {
          entitlementRequests: 0,
          usedRequests: 0,
          remainingPercentage: 0,
          resetDate: '2026-10-09T05:21:20.137-07:00',
          hasQuota: false,
        },
      },
    }, COPILOT_NOW);
    assert.deepEqual(snapshot, {
      kind: 'reported',
      provider: 'copilot',
      remainingPercent: 99.5,
      resetsAt: Date.parse('2026-11-09T21:21:20.137Z'),
    });
  });

  test('a reset date that has already passed is dropped so a spent quota is not ranked as refilled', () => {
    const snapshot = parseCopilotQuota({
      quotaSnapshots: {
        premium_interactions: {
          entitlementRequests: 300,
          remainingPercentage: 0,
          resetDate: '2026-10-09T11:59:00.000Z',
        },
      },
    }, COPILOT_NOW);
    assert.deepEqual(snapshot, { kind: 'reported', provider: 'copilot', remainingPercent: 0 });
  });

  test('missing fields, malformed dates, and hostile percentages remain unknown', async () => {
    const response = JSON.parse(await readCopilotFixture('copilot-usage-normal.json')) as Record<string, unknown>;
    const result = response['result'] as { quotaSnapshots: { premium_interactions: Record<string, unknown> } };
    const missingPercentage = {
      quotaSnapshots: {
        premium_interactions: { entitlementRequests: 300, usedRequests: 10 },
      },
    };
    const malformedDate = {
      quotaSnapshots: {
        premium_interactions: { ...result.quotaSnapshots.premium_interactions, resetDate: 'next Tuesday' },
      },
    };
    const hostilePercentage = {
      quotaSnapshots: {
        premium_interactions: { ...result.quotaSnapshots.premium_interactions, remainingPercentage: 1000 },
      },
    };
    for (const value of [null, [], {}, { quotaSnapshots: [] }, missingPercentage, malformedDate, hostilePercentage]) {
      assert.equal(parseCopilotQuota(value, COPILOT_NOW).kind, 'unknown', JSON.stringify(value));
    }
  });
});

suite('usage orchestrator ranking', () => {
  test('a reporting CLI with a reset time outranks an unknown one', () => {
    assert.deepEqual(order([unknown('copilot'), reported('codex', 10, NOW + 50 * HOUR)]), [
      'codex',
      'copilot',
    ]);
  });

  test('soonest reset first; equal resets by higher remaining percentage', () => {
    assert.deepEqual(
      order([
        reported('copilot', 90, NOW + 10 * HOUR),
        reported('codex', 20, NOW + 2 * HOUR),
        reported('claude-code', 60, NOW + 2 * HOUR),
      ]),
      ['claude-code', 'codex', 'copilot'],
    );
  });

  test('unknown CLIs come next in built-in provider order, then reporting CLIs with no reset time', () => {
    assert.deepEqual(
      order([
        reported('codex', 99),
        unknown('cursor'),
        unknown('copilot'),
        reported('claude-code', 40, NOW + HOUR),
      ]),
      ['claude-code', 'copilot', 'cursor', 'codex'],
    );
  });

  test('reporting CLIs without a reset time rank by higher remaining percentage, ties by provider order', () => {
    assert.deepEqual(
      order([reported('cursor', 50), reported('codex', 80), reported('copilot', 50)]),
      ['codex', 'copilot', 'cursor'],
    );
  });

  test('a CLI at 0% is skipped until its reset time passes, and for good without one', () => {
    const future = rankAgentClis([reported('codex', 0, NOW + HOUR), unknown('cursor')], new Map(), NOW);
    assert.deepEqual(future.ranked.map((entry) => entry.provider), ['cursor']);
    assert.match(future.skipped[0]?.reason ?? '', /0% remaining until/);

    const passed = rankAgentClis([reported('codex', 0, NOW - 1), unknown('cursor')], new Map(), NOW);
    assert.deepEqual(passed.ranked.map((entry) => entry.provider), ['codex', 'cursor']);

    const never = rankAgentClis([reported('codex', 0)], new Map(), NOW);
    assert.deepEqual(never.ranked, []);
    assert.match(never.skipped[0]?.reason ?? '', /no reset time/);
  });

  test('unavailable executables and run exclusions are skipped with reasons; exclusions expire at reset', () => {
    const candidates: AgentCliRankCandidate[] = [
      { provider: 'copilot', available: false, unavailableReason: 'Copilot CLI is not installed.' },
      reported('codex', 50, NOW + 2 * HOUR),
      unknown('cursor'),
    ];
    const exclusions = new Map<AgentCliProviderId, { readonly until?: number }>([
      ['codex', { until: NOW + HOUR }],
      ['cursor', {}],
    ]);
    const ranking = rankAgentClis(candidates, exclusions, NOW);
    assert.deepEqual(ranking.ranked, []);
    assert.deepEqual(ranking.skipped.map((entry) => entry.provider), ['copilot', 'codex', 'cursor']);

    const later = rankAgentClis(candidates, exclusions, NOW + HOUR);
    assert.deepEqual(later.ranked.map((entry) => entry.provider), ['codex']);
  });

  test('no percentage is synthesized for an unknown CLI', () => {
    const ranking = rankAgentClis(
      [reported('codex', 80), reported('copilot', 20), unknown('cursor')],
      new Map(),
      NOW,
    );
    const cursor = ranking.ranked.find((entry) => entry.provider === 'cursor');
    assert.equal(cursor?.snapshot.kind, 'unknown');
    assert.equal(cursor?.rule, 'unknown-drain');
    assert.ok(cursor && !('remainingPercent' in cursor.snapshot));
  });
});

/** A stand-in `codex app-server`: JSON-RPC over stdio, scripted by mode. */
const FAKE_APP_SERVER = `
const fs = require('node:fs');
const readline = require('node:readline');
const [mode, pidFile] = process.argv.slice(2);
fs.writeFileSync(pidFile, String(process.pid));
const out = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
if (mode === 'exit') { process.exit(3); }
if (mode === 'flood') { const big = 'x'.repeat(65536); setInterval(() => process.stdout.write(big), 1); }
setInterval(() => {}, 1000);
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === 1) {
    if (mode === 'old') { out({ id: 1, error: { code: -32601, message: 'Method not found' } }); return; }
    out({ method: 'remoteControl/status/changed', params: {} });
    process.stdout.write('not json\\n');
    out({ id: 1, result: {} });
  }
  if (message.id === 2) {
    if (mode === 'ok') out({ id: 2, result: { rateLimits: {
      primary: { usedPercent: 6, windowDurationMins: 10080, resetsAt: 1791980642 },
      secondary: { usedPercent: 70, windowDurationMins: 300, resetsAt: 1791400000 } } } });
    if (mode === 'apikey') out({ id: 2, error: { code: -32600, message: 'requires ChatGPT login; key sk-live-ABCDEF1234567890' } });
    if (mode === 'hostile') out({ id: 2, result: { rateLimits: { primary: { usedPercent: 'lots' } } } });
  }
});
`;

const CODEX: AgentCliTarget = {
  provider: 'codex',
  label: AGENT_CLI_LABELS.codex,
  executable: 'codex',
  launcher: 'standalone',
};

async function runFakeProbe(
  mode: string,
  timeoutMs = 5_000,
): Promise<{ readonly snapshot: AgentCliUsageSnapshot; readonly pid: number | undefined }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-usage-probe-'));
  try {
    const script = path.join(dir, 'app-server.cjs');
    const pidFile = path.join(dir, 'pid');
    await fs.writeFile(script, FAKE_APP_SERVER, 'utf8');
    const snapshot = await probeCodexUsage(CODEX, {
      cwd: dir,
      timeoutMs,
      launch: { command: process.execPath, args: [script, mode, pidFile] },
    });
    const pid = Number(await fs.readFile(pidFile, 'utf8').catch(() => ''));
    return { snapshot, pid: Number.isInteger(pid) && pid > 0 ? pid : undefined };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

suite('Codex usage probe (app-server JSON-RPC)', () => {
  test('reads the binding window and ends the process before resolving', async () => {
    const { snapshot, pid } = await runFakeProbe('ok');
    assert.deepEqual(snapshot, {
      kind: 'reported',
      provider: 'codex',
      remainingPercent: 30,
      resetsAt: 1791400000 * 1000,
    });
    assert.ok(pid !== undefined && !isRunning(pid), 'probe process must have ended');
  });

  test('a non-ChatGPT account is unknown, with the redacted server message', async () => {
    const { snapshot, pid } = await runFakeProbe('apikey');
    assert.equal(snapshot.kind, 'unknown');
    assert.match(snapshot.kind === 'unknown' ? snapshot.reason : '', /ChatGPT/);
    assert.ok(snapshot.kind === 'unknown' && !snapshot.reason.includes('sk-live-ABCDEF1234567890'));
    assert.ok(pid !== undefined && !isRunning(pid));
  });

  test('an unsupported version, a hostile response, and a nonzero exit are unknown', async () => {
    for (const mode of ['old', 'hostile', 'exit']) {
      const { snapshot, pid } = await runFakeProbe(mode);
      assert.equal(snapshot.kind, 'unknown', mode);
      assert.ok(pid === undefined || !isRunning(pid), `${mode}: probe process must have ended`);
    }
    const exited = await runFakeProbe('exit');
    assert.match(exited.snapshot.kind === 'unknown' ? exited.snapshot.reason : '', /code 3/);
  });

  test('a server that never answers times out as unknown and is stopped', async () => {
    const started = Date.now();
    const { snapshot, pid } = await runFakeProbe('hang', 400);
    assert.equal(snapshot.kind, 'unknown');
    assert.match(snapshot.kind === 'unknown' ? snapshot.reason : '', /did not report usage/);
    assert.ok(Date.now() - started < 4_000);
    assert.ok(pid !== undefined && !isRunning(pid));
  });

  test('an output flood is cut off as unknown', async () => {
    const { snapshot, pid } = await runFakeProbe('flood');
    assert.equal(snapshot.kind, 'unknown');
    assert.ok(pid !== undefined && !isRunning(pid));
  });

  test('a missing executable is unknown rather than an error', async () => {
    const snapshot = await probeCodexUsage(
      { ...CODEX, executable: path.join(os.tmpdir(), 'mwnn-no-such-codex-binary') },
      { cwd: os.tmpdir(), timeoutMs: 2_000 },
    );
    assert.equal(snapshot.kind, 'unknown');
  });

  test('Cursor remains unknown because its CLI exposes usage only interactively', async () => {
    const snapshot = await probeAgentCliUsage(
      { provider: 'cursor', label: AGENT_CLI_LABELS.cursor, executable: 'cursor', launcher: 'standalone' },
      { cwd: os.tmpdir() },
    );
    assert.equal(snapshot.kind, 'unknown', 'cursor');
  });
});

const FAKE_CLAUDE_CLI = `
const fs = require('node:fs');
const [mode, eventsFile, fixturePath, ...args] = process.argv.slice(2);
fs.appendFileSync(eventsFile, JSON.stringify({ pid: process.pid, args }) + '\\n');
if (args[0] === '--version') {
  const version = mode === 'unsupported' ? '2.1.294' : mode === 'newer' ? '2.2.0' : '2.1.295';
  process.stdout.write(version + ' (Claude Code)');
  process.exit(0);
}
if (mode === 'hang') { setInterval(() => {}, 1000); }
if (mode === 'nonzero') { process.exit(7); }
if (mode === 'flood') { process.stdout.write('x'.repeat(1024 * 1024 + 1)); setInterval(() => {}, 1000); }
process.stdout.write(fs.readFileSync(fixturePath, 'utf8'));
`;

interface FakeClaudeProbeResult {
  readonly snapshot: AgentCliUsageSnapshot;
  readonly pids: readonly number[];
  readonly invocations: readonly { readonly pid: number; readonly args: readonly string[] }[];
}

async function runFakeClaudeProbe(
  mode: string,
  fixtureName = 'claude-usage-two-windows.json',
  timeoutMs = 5_000,
): Promise<FakeClaudeProbeResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-claude-usage-probe-'));
  try {
    const script = path.join(dir, 'claude.cjs');
    const eventsFile = path.join(dir, 'events.jsonl');
    const fixturePath = path.resolve(__dirname, '../../../test/fixtures', fixtureName);
    await fs.writeFile(script, FAKE_CLAUDE_CLI, 'utf8');
    const snapshot = await probeClaudeCodeUsage(
      {
        provider: 'claude-code',
        label: AGENT_CLI_LABELS['claude-code'],
        executable: 'claude',
        launcher: 'standalone',
      },
      {
        cwd: dir,
        timeoutMs,
        now: CLAUDE_NOW,
        claudeLaunch: {
          command: process.execPath,
          args: [script, mode, eventsFile, fixturePath],
        },
      },
    );
    const rawEvents = await fs.readFile(eventsFile, 'utf8').catch(() => '');
    const invocations = rawEvents.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const event = JSON.parse(line) as { pid?: unknown; args?: unknown };
        return typeof event.pid === 'number' && Array.isArray(event.args)
          ? [{ pid: event.pid, args: event.args.filter((arg): arg is string => typeof arg === 'string') }]
          : [];
      } catch {
        return [];
      }
    });
    return { snapshot, invocations, pids: invocations.map((event) => event.pid) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

suite('Claude Code usage probe (local /usage command)', () => {
  test('uses only the local /usage command, reports real plan usage, and ends both processes', async () => {
    const { snapshot, invocations, pids } = await runFakeClaudeProbe('two-windows');
    assert.deepEqual(snapshot, {
      kind: 'reported',
      provider: 'claude-code',
      remainingPercent: 38.75,
      resetsAt: Date.parse('2026-10-13T15:00:00.000Z'),
    });
    assert.deepEqual(invocations.map((entry) => entry.args), [
      ['--version'],
      ['--print', '/usage', '--output-format', 'json', '--no-session-persistence'],
    ]);
    assert.ok(pids.length === 2 && pids.every((pid) => !isRunning(pid)));
  });

  test('a newer release than the minimum verified version is still probed', async () => {
    const { snapshot, invocations } = await runFakeClaudeProbe('newer');
    assert.equal(snapshot.kind, 'reported');
    assert.equal(invocations.length, 2);
  });

  test('an older unsupported version is unknown and never receives the /usage invocation', async () => {
    const { snapshot, invocations, pids } = await runFakeClaudeProbe('unsupported');
    assert.equal(snapshot.kind, 'unknown');
    assert.match(snapshot.kind === 'unknown' ? snapshot.reason : '', /unsupported/);
    assert.deepEqual(invocations.map((entry) => entry.args), [['--version']]);
    assert.ok(pids.every((pid) => !isRunning(pid)));
  });

  test('a nonzero exit, output flood, or timeout is unknown and the process ends', async () => {
    for (const mode of ['nonzero', 'flood', 'hang']) {
      const started = Date.now();
      const { snapshot, pids } = await runFakeClaudeProbe(mode, 'claude-usage-two-windows.json', 350);
      assert.equal(snapshot.kind, 'unknown', mode);
      assert.ok(Date.now() - started < 2_500, `${mode}: probe exceeded its timeout and termination grace`);
      assert.ok(pids.length >= 1 && pids.every((pid) => !isRunning(pid)), `${mode}: process must have ended`);
    }
  });
});

const COPILOT: AgentCliTarget = {
  provider: 'copilot',
  label: AGENT_CLI_LABELS.copilot,
  executable: 'copilot',
  launcher: 'standalone',
};

/** A stand-in Copilot SDK server that speaks Content-Length JSON-RPC over stdio. */
const FAKE_COPILOT_SERVER = `
const fs = require('node:fs');
const [mode, pidFile, fixturePath, requestLog] = process.argv.slice(2);
fs.writeFileSync(pidFile, String(process.pid));
const writeFrame = (body) => {
  const data = Buffer.from(body, 'utf8');
  process.stdout.write('Content-Length: ' + data.length + '\\r\\n\\r\\n');
  process.stdout.write(data);
};
const write = (message) => writeFrame(JSON.stringify(message));
const respond = (request) => {
  fs.appendFileSync(requestLog, JSON.stringify({ id: request.id, method: request.method }) + '\\n');
  if (request.method === 'connect') {
    if (mode === 'unsupported') {
      write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 2 } });
    } else if (mode === 'legacy') {
      write({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
    } else {
      write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 3 } });
    }
    return;
  }
  if (request.method === 'ping') {
    write({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 3 } });
    return;
  }
  if (request.method !== 'account.getQuota') return;
  if (mode === 'hang') return;
  if (mode === 'exit') process.exit(7);
  if (mode === 'flood') {
    writeFrame('x'.repeat(1024 * 1024 + 1));
    setInterval(() => {}, 1000);
    return;
  }
  const responseText = fs.readFileSync(fixturePath, 'utf8');
  if (mode === 'malformed') {
    writeFrame(responseText);
    return;
  }
  const response = JSON.parse(responseText);
  response.id = request.id;
  write(response);
};
let input = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  while (true) {
    const headerEnd = input.indexOf('\\r\\n\\r\\n');
    if (headerEnd < 0) return;
    const header = input.subarray(0, headerEnd).toString('ascii');
    const match = /content-length:\\s*(\\d+)/i.exec(header);
    if (!match) return;
    const length = Number(match[1]);
    const frameEnd = headerEnd + 4 + length;
    if (input.length < frameEnd) return;
    const body = input.subarray(headerEnd + 4, frameEnd).toString('utf8');
    input = input.subarray(frameEnd);
    try { respond(JSON.parse(body)); } catch { return; }
  }
});
setInterval(() => {}, 1000);
`;

interface FakeCopilotProbeResult {
  readonly snapshot: AgentCliUsageSnapshot;
  readonly pid: number | undefined;
  readonly requests: readonly { readonly id: number; readonly method: string }[];
}

async function runFakeCopilotProbe(
  mode: string,
  fixtureName = 'copilot-usage-normal.json',
  timeoutMs = 5_000,
): Promise<FakeCopilotProbeResult> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-copilot-usage-probe-'));
  try {
    const script = path.join(dir, 'copilot-server.cjs');
    const pidFile = path.join(dir, 'pid');
    const requestLog = path.join(dir, 'requests.jsonl');
    const fixturePath = path.resolve(__dirname, '../../../test/fixtures', fixtureName);
    await fs.writeFile(script, FAKE_COPILOT_SERVER, 'utf8');
    const snapshot = await probeCopilotUsage(COPILOT, {
      cwd: dir,
      timeoutMs,
      now: COPILOT_NOW,
      launch: { command: process.execPath, args: [script, mode, pidFile, fixturePath, requestLog] },
    });
    const parsedPid = Number(await fs.readFile(pidFile, 'utf8').catch(() => ''));
    const rawRequests = await fs.readFile(requestLog, 'utf8').catch(() => '');
    const requests = rawRequests.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const request = JSON.parse(line) as { id?: unknown; method?: unknown };
        return typeof request.id === 'number' && typeof request.method === 'string'
          ? [{ id: request.id, method: request.method }]
          : [];
      } catch {
        return [];
      }
    });
    return {
      snapshot,
      pid: Number.isInteger(parsedPid) && parsedPid > 0 ? parsedPid : undefined,
      requests,
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

suite('Copilot usage probe (SDK account.getQuota RPC)', () => {
  test('uses the dispatch-resolved executable and launcher for its SDK server', () => {
    const pathOverride = 'C:\\Copilot CLI\\copilot.cmd';
    assert.deepEqual(copilotUsageLaunch({ ...COPILOT, executable: pathOverride }), {
      command: pathOverride,
      args: ['--headless', '--no-auto-update', '--stdio'],
    });
    const ghPath = 'C:\\GitHub CLI\\gh.exe';
    assert.deepEqual(copilotUsageLaunch({ ...COPILOT, executable: ghPath, launcher: 'gh-copilot' }), {
      command: ghPath,
      args: ['copilot', '--headless', '--no-auto-update', '--stdio'],
    });
  });

  test('reads the quota fixture after the SDK compatibility handshake and closes the process', async () => {
    const { snapshot, pid, requests } = await runFakeCopilotProbe('normal');
    assert.deepEqual(snapshot, {
      kind: 'reported',
      provider: 'copilot',
      remainingPercent: 42.5,
      resetsAt: Date.parse('2026-10-16T00:00:00.000Z'),
    });
    assert.deepEqual(requests.map((request) => request.method), ['connect', 'account.getQuota']);
    assert.ok(pid !== undefined && !isRunning(pid), 'probe process must have ended');
  });

  test('supports the SDK ping fallback for a legacy server, then reads its quota fixture', async () => {
    const { snapshot, pid, requests } = await runFakeCopilotProbe('legacy');
    assert.equal(snapshot.kind, 'reported');
    assert.deepEqual(requests.map((request) => request.method), ['connect', 'ping', 'account.getQuota']);
    assert.ok(pid !== undefined && !isRunning(pid));
  });

  test('an unlimited fixture has 100% remaining and no reset time', async () => {
    const { snapshot, pid } = await runFakeCopilotProbe('unlimited', 'copilot-usage-unlimited.json');
    assert.deepEqual(snapshot, { kind: 'reported', provider: 'copilot', remainingPercent: 100 });
    assert.ok(pid !== undefined && !isRunning(pid));
  });

  test('a missing reset fixture reports its percentage without a reset time', async () => {
    const { snapshot, pid } = await runFakeCopilotProbe('missing-reset', 'copilot-usage-missing-reset.json');
    assert.deepEqual(snapshot, { kind: 'reported', provider: 'copilot', remainingPercent: 75 });
    assert.ok(pid !== undefined && !isRunning(pid));
  });

  test('a signed-out account returns unknown with the CLI reason', async () => {
    const { snapshot, pid } = await runFakeCopilotProbe('signed-out', 'copilot-usage-signed-out.json');
    assert.equal(snapshot.kind, 'unknown');
    assert.match(snapshot.kind === 'unknown' ? snapshot.reason : '', /not signed in/i);
    assert.ok(pid !== undefined && !isRunning(pid));
  });

  test('unsupported protocol, malformed or hostile output, and process errors are unknown and closed', async () => {
    const cases: readonly (readonly [string, string])[] = [
      ['unsupported', 'copilot-usage-normal.json'],
      ['malformed', 'copilot-usage-malformed.txt'],
      ['hostile', 'copilot-usage-hostile.json'],
      ['exit', 'copilot-usage-normal.json'],
      ['flood', 'copilot-usage-normal.json'],
    ];
    for (const [mode, fixtureName] of cases) {
      const { snapshot, pid } = await runFakeCopilotProbe(mode, fixtureName);
      assert.equal(snapshot.kind, 'unknown', mode);
      assert.ok(pid !== undefined && !isRunning(pid), `${mode}: probe process must have ended`);
    }
  });

  test('a hung CLI times out as unknown and is stopped', async () => {
    const started = Date.now();
    const { snapshot, pid } = await runFakeCopilotProbe('hang', 'copilot-usage-normal.json', 350);
    assert.equal(snapshot.kind, 'unknown');
    assert.match(snapshot.kind === 'unknown' ? snapshot.reason : '', /did not report usage/);
    assert.ok(Date.now() - started < 2_500);
    assert.ok(pid !== undefined && !isRunning(pid));
  });
});
