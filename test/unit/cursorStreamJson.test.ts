import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  createCursorStreamJsonRenderer,
  expandCursorStreamJsonOutput,
} from '../../src/cursorStreamJson';
import { detectCreditExhaustion } from '../../src/agentCliCredit';
import { detectModelRejection, type AgentCliModelSelection } from '../../src/agentCliHandoff';
import { createCliOutputFeed } from '../../src/agentCliFeedback';

suite('Cursor stream-json renderer', () => {
  test('emits assistant text, merging partial deltas into readable lines', () => {
    const renderer = createCursorStreamJsonRenderer();
    const lines = [
      ...renderer.write(
        `${JSON.stringify({
          type: 'assistant',
          timestamp_ms: 1,
          message: { role: 'assistant', content: [{ type: 'text', text: 'Hel' }] },
        })}\n`,
      ),
      ...renderer.write(
        `${JSON.stringify({
          type: 'assistant',
          timestamp_ms: 2,
          message: { role: 'assistant', content: [{ type: 'text', text: 'lo world\nNext' }] },
        })}\n`,
      ),
      ...renderer.flush(),
    ];
    assert.deepEqual(lines, ['Hello world', 'Next']);
  });

  test('skips duplicate partial-flush assistant events', () => {
    const renderer = createCursorStreamJsonRenderer();
    const lines = [
      ...renderer.write(
        `${JSON.stringify({
          type: 'assistant',
          timestamp_ms: 1,
          message: { role: 'assistant', content: [{ type: 'text', text: 'Only once' }] },
        })}\n`,
      ),
      ...renderer.write(
        `${JSON.stringify({
          type: 'assistant',
          timestamp_ms: 2,
          model_call_id: 'call-1',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Only once' }] },
        })}\n`,
      ),
      ...renderer.write(
        `${JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Only once' }] },
        })}\n`,
      ),
      ...renderer.flush(),
    ];
    assert.deepEqual(lines, ['Only once']);
  });

  test('summarizes a tool-call start as one line', () => {
    const renderer = createCursorStreamJsonRenderer();
    const lines = renderer.write(
      `${JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'c1',
        tool_call: { readToolCall: { args: { path: 'src/extension.ts' } } },
      })}\n`,
    );
    assert.deepEqual(lines, ['→ Read src/extension.ts']);
  });

  test('summarizes success and error result events with duration', () => {
    const ok = createCursorStreamJsonRenderer().write(
      `${JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 5234,
        result: 'all done',
      })}\n`,
    );
    assert.deepEqual(ok, ['✓ Completed in 5.2s']);

    const fail = createCursorStreamJsonRenderer().write(
      `${JSON.stringify({
        type: 'result',
        subtype: 'error',
        is_error: true,
        duration_ms: 800,
        result: 'credit balance is too low',
      })}\n`,
    );
    assert.deepEqual(fail, ['✗ Failed in 800ms: credit balance is too low']);
  });

  test('skips unknown event types without throwing and passes non-JSON through', () => {
    const renderer = createCursorStreamJsonRenderer();
    const lines = [
      ...renderer.write('{"type":"future_event","payload":1}\n'),
      ...renderer.write('plain progress line\n'),
      ...renderer.write('not { json at all\n'),
    ];
    assert.deepEqual(lines, ['plain progress line', 'not { json at all']);
  });

  test('handles a JSON event split across chunks and several events in one chunk', () => {
    const renderer = createCursorStreamJsonRenderer();
    const eventA = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'First' }] },
    });
    const eventB = JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
      tool_call: { writeToolCall: { args: { path: 'out.md' } } },
    });
    const eventC = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1000,
      result: 'First',
    });

    const lines = [
      ...renderer.write(eventA.slice(0, 12)),
      ...renderer.write(`${eventA.slice(12)}\n${eventB}\n${eventC.slice(0, 20)}`),
      ...renderer.write(`${eventC.slice(20)}\n`),
    ];
    assert.deepEqual(lines, ['First', '→ Write out.md', '✓ Completed in 1.0s']);
  });
});

suite('Cursor stream-json scanners', () => {
  const selection: AgentCliModelSelection = {
    requested: 'bad-model',
    applied: true,
    source: 'card',
    args: ['--model', 'bad-model'],
  };

  test('credit exhaustion matches a phrase inside a stream-json result event', () => {
    const signal = detectCreditExhaustion({
      started: true,
      cancelled: false,
      exitCode: 1,
      signal: null,
      stdout: `${JSON.stringify({
        type: 'result',
        subtype: 'error',
        is_error: true,
        duration_ms: 12,
        result: 'Error: Your credit balance is too low to continue.',
      })}\n`,
      stderr: '',
    });
    assert.ok(signal);
    assert.match(signal.detail, /credit balance is too low/i);
    assert.doesNotMatch(signal.detail, /"type":/);
  });

  test('model rejection matches a phrase inside a stream-json result event', () => {
    const rejection = detectModelRejection(
      {
        started: true,
        cancelled: false,
        exitCode: 1,
        signal: null,
        stdout: `${JSON.stringify({
          type: 'result',
          subtype: 'error',
          is_error: true,
          result: 'Error: unknown model "bad-model"',
        })}\n`,
        stderr: '',
      },
      selection,
    );
    assert.ok(rejection);
    assert.equal(rejection.model, 'bad-model');
    assert.match(rejection.detail, /unknown model/i);
    assert.doesNotMatch(rejection.detail, /"type":/);
  });

  test('expandCursorStreamJsonOutput surfaces result text for exit-failure summaries', () => {
    const expanded = expandCursorStreamJsonOutput(
      `${JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: 'Claude 4 Sonnet',
      })}\n${JSON.stringify({
        type: 'result',
        subtype: 'error',
        is_error: true,
        result: 'authentication expired',
      })}\n`,
    );
    assert.equal(expanded, 'authentication expired');
  });
});

suite('CLI output feed with Cursor renderer', () => {
  test('Cursor stdout is rendered; Copilot/Codex/Claude stay byte-for-byte', () => {
    const cursorLines: string[] = [];
    const cursorFeed = createCliOutputFeed({
      onLine: (line) => cursorLines.push(line),
      stdoutRenderer: createCursorStreamJsonRenderer(),
    });
    cursorFeed.write(
      `${JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Rendered' }] },
      })}\n`,
      'stdout',
    );
    assert.deepEqual(cursorLines, ['Rendered']);
    assert.ok(!cursorLines.some((line) => line.includes('"type"')));

    for (const label of ['copilot', 'codex', 'claude-code'] as const) {
      const lines: string[] = [];
      const feed = createCliOutputFeed({ onLine: (line) => lines.push(line) });
      const chunk = `${label}: verbatim line with {"type":"ignored"} inside\n`;
      feed.write(chunk, 'stdout');
      assert.deepEqual(lines, [`${label}: verbatim line with {"type":"ignored"} inside`], label);
    }
  });
});
