import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { suite, test } from 'node:test';
import {
  createAgentCliModelDiscovery,
  type AgentCliActualModelEvidence,
  type AgentCliModelDiscoveryProcessEnd,
} from '../../src/agentCliModelDiscovery';

const SUCCESS: AgentCliModelDiscoveryProcessEnd = {
  started: true,
  cancelled: false,
  exitCode: 0,
};

function discovery(
  provider: 'copilot' | 'codex' | 'claude-code' | 'cursor',
  overrides: Partial<Parameters<typeof createAgentCliModelDiscovery>[1]> = {},
): { readonly signal: AbortController; readonly seen: AgentCliActualModelEvidence[]; readonly session: ReturnType<typeof createAgentCliModelDiscovery> } {
  const signal = new AbortController();
  const seen: AgentCliActualModelEvidence[] = [];
  const session = createAgentCliModelDiscovery(provider, {
    cwd: 'E:\\workspace',
    signal: signal.signal,
    onEvidence: (evidence) => seen.push(evidence),
    ...overrides,
  });
  return { signal, seen, session };
}

suite('agent CLI actual model discovery', () => {
  test('discovers Copilot model labels from delayed and chunked non-silent output', async () => {
    const { session, seen } = discovery('copilot');
    session.onOutput('Starting Copilot CLI...\nMod', 'stdout');
    session.onOutput('el: Claude Sonnet 5.5\n', 'stdout');

    const result = await session.finish(SUCCESS);
    assert.deepEqual(result, {
      kind: 'observed',
      evidence: {
        model: 'Claude Sonnet 5.5',
        source: 'Copilot CLI non-silent programmatic output model label',
      },
    });
    assert.deepEqual(seen.map(({ model }) => model), ['Claude Sonnet 5.5']);
  });

  test('reports Copilot metadata as unavailable when the label is missing or malformed', async () => {
    const missing = discovery('copilot');
    const missingResult = await missing.session.finish(SUCCESS);
    assert.equal(missingResult.kind, 'unavailable');
    assert.match(missingResult.reason, /did not include an explicit model label/);

    const malformed = discovery('copilot');
    malformed.session.onOutput('Model: \n', 'stdout');
    const malformedResult = await malformed.session.finish(SUCCESS);
    assert.equal(malformedResult.kind, 'unavailable');
    assert.match(malformedResult.reason, /missing, malformed/);
  });

  test('discovers Claude Code startup and changed assistant model fields', async () => {
    const { session, seen } = discovery('claude-code');
    session.onOutput('{"type":"system","subtype":"ini', 'stdout');
    session.onOutput('t","model":"claude-opus-5"}\n{"type":"assistant","message":{"model":"claude-sonnet-5"}}\n', 'stdout');

    const result = await session.finish(SUCCESS);
    assert.deepEqual(seen.map(({ model }) => model), ['claude-opus-5', 'claude-sonnet-5']);
    assert.deepEqual(result, {
      kind: 'observed',
      evidence: {
        model: 'claude-sonnet-5',
        source: 'Claude Code stream-json assistant.message.model',
      },
    });
  });

  test('discovers Cursor Agent CLI defaults from its stream-json init event', async () => {
    const { session } = discovery('cursor');
    session.onOutput('{"type":"system","subtype":"init","model":"Claude 4 Sonnet"}\n', 'stdout');
    const result = await session.finish(SUCCESS);
    assert.deepEqual(result, {
      kind: 'observed',
      evidence: {
        model: 'Claude 4 Sonnet',
        source: 'Cursor Agent stream-json system.init.model',
      },
    });
  });

  test('matches Codex rollout metadata to the thread id and records model changes', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-codex-model-'));
    try {
      const threadId = '01a0abcd-1234-4567-abcd-1234567890ab';
      const day = path.join(home, 'sessions', '2026', '10', '09');
      await fs.mkdir(day, { recursive: true });
      const rollout = path.join(day, `rollout-2026-10-09T12-00-00-${threadId}.jsonl`);
      const { session, seen } = discovery('codex', {
        codexHome: home,
        now: () => new Date(2026, 9, 9, 12, 0, 0),
        pollIntervalMs: 20,
        timeoutMs: 500,
      });
      session.onOutput(`{"type":"thread.started","thread_id":"${threadId}"}\n`, 'stdout');
      await new Promise((resolve) => setTimeout(resolve, 30));
      await fs.writeFile(rollout, [
        JSON.stringify({ type: 'session_meta', payload: { id: threadId, model: 'gpt-5-codex' } }),
        JSON.stringify({ type: 'turn_context', payload: { id: threadId, model: 'gpt-5.5-codex' } }),
        JSON.stringify({ type: 'session_meta', payload: { id: 'another-thread', model: 'wrong-session-model' } }),
        // Id-less turn context after a foreign session_meta belongs to that session.
        JSON.stringify({ type: 'turn_context', payload: { model: 'wrong-turn-model' } }),
      ].join('\n'));
      await new Promise((resolve) => setTimeout(resolve, 45));

      const result = await session.finish(SUCCESS);
      assert.deepEqual(seen.map(({ model }) => model), ['gpt-5-codex', 'gpt-5.5-codex']);
      assert.deepEqual(result, {
        kind: 'observed',
        evidence: {
          model: 'gpt-5.5-codex',
          source: 'Codex rollout turn_context.payload.model',
        },
      });
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  test('reads the model from real-shaped Codex turn_context records that carry no thread id', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-codex-model-'));
    try {
      const threadId = '01a1223c-f005-7500-97e9-87add739fd88';
      const day = path.join(home, 'sessions', '2026', '10', '09');
      await fs.mkdir(day, { recursive: true });
      // Real Codex: session_meta has the id but no model; turn_context has the
      // model but no id, thread_id, or session_id.
      await fs.writeFile(path.join(day, `rollout-2026-10-09T13-56-22-${threadId}.jsonl`), [
        JSON.stringify({ type: 'session_meta', payload: { id: threadId, session_id: threadId, model_provider: 'openai' } }),
        JSON.stringify({ type: 'turn_context', payload: { turn_id: 't1', model: 'gpt-6-luna', effort: 'max' } }),
        JSON.stringify({ type: 'turn_context', payload: { thread_id: 'another-thread', model: 'wrong-thread-model' } }),
      ].join('\n') + '\n');
      const { session, seen } = discovery('codex', {
        codexHome: home,
        now: () => new Date(2026, 9, 9, 13, 57, 0),
        pollIntervalMs: 20,
        timeoutMs: 500,
      });
      session.onOutput(`{"type":"thread.started","thread_id":"${threadId}"}\n`, 'stdout');
      await new Promise((resolve) => setTimeout(resolve, 45));

      const result = await session.finish(SUCCESS);
      assert.deepEqual(seen.map(({ model }) => model), ['gpt-6-luna']);
      assert.deepEqual(result, {
        kind: 'observed',
        evidence: {
          model: 'gpt-6-luna',
          source: 'Codex rollout turn_context.payload.model',
        },
      });
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  test('rejects malformed provider metadata without guessing a model', async () => {
    const { session } = discovery('claude-code');
    session.onOutput('{"type":"system","subtype":"init","model":null}\n', 'stdout');
    const result = await session.finish(SUCCESS);
    assert.equal(result.kind, 'unavailable');
    assert.match(result.reason, /missing, malformed/);
  });

  test('returns an explicit rejection reason without replacing the requested selection', async () => {
    const { session } = discovery('cursor');
    const result = await session.finish({
      started: true,
      cancelled: false,
      exitCode: 1,
      rejectedSelection: true,
    });
    assert.equal(result.kind, 'unavailable');
    assert.match(result.reason, /rejected the requested model/);
  });

  test('bounds Codex metadata polling and reports timeout or cancellation', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-codex-timeout-'));
    try {
      const threadId = '01a0abcd-1234-4567-abcd-1234567890ac';
      const timed = discovery('codex', {
        codexHome: home,
        now: () => new Date(2026, 9, 9, 12, 0, 0),
        pollIntervalMs: 20,
        timeoutMs: 60,
      });
      timed.session.onOutput(`{"type":"thread.started","thread_id":"${threadId}"}\n`, 'stdout');
      await new Promise((resolve) => setTimeout(resolve, 90));
      const timedResult = await timed.session.finish(SUCCESS);
      assert.equal(timedResult.kind, 'unavailable');
      assert.match(timedResult.reason, /timed out waiting/);

      const cancelled = discovery('codex', {
        codexHome: home,
        now: () => new Date(2026, 9, 9, 12, 0, 0),
        pollIntervalMs: 20,
        timeoutMs: 500,
      });
      cancelled.session.onOutput(`{"type":"thread.started","thread_id":"${threadId}"}\n`, 'stdout');
      cancelled.signal.abort();
      const cancelledResult = await cancelled.session.finish({
        ...SUCCESS,
        cancelled: true,
      });
      assert.equal(cancelledResult.kind, 'unavailable');
      assert.match(cancelledResult.reason, /cancelled before authoritative model metadata/);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
