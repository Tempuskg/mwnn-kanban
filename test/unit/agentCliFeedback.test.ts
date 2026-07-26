import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  createCliOutputFeed,
  formatCliCommandLine,
  formatCliRunExit,
  formatCliRunStart,
  truncateStatusLine,
  type CliOutputStream,
} from '../../src/agentCliFeedback';
import type { AgentCliInvocation, AgentCliProcessResult } from '../../src/agentCliHandoff';

interface RecordedLine {
  readonly line: string;
  readonly stream: CliOutputStream;
}

function invocation(overrides: Partial<AgentCliInvocation> = {}): AgentCliInvocation {
  return {
    provider: 'claude-code',
    label: 'Anthropic Claude Code CLI',
    command: 'C:\\Tools\\claude.EXE',
    args: ['-p', '--output-format', 'text'],
    stdin: 'the multi-line prompt\npiped to the CLI',
    cwd: 'E:\\workspace',
    ...overrides,
  };
}

function processResult(overrides: Partial<AgentCliProcessResult> = {}): AgentCliProcessResult {
  return {
    started: true,
    cancelled: false,
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    ...overrides,
  };
}

suite('CLI output feed line assembly', () => {
  test('assembles complete lines across chunk boundaries per stream', () => {
    const lines: RecordedLine[] = [];
    const feed = createCliOutputFeed({ onLine: (line, stream) => lines.push({ line, stream }) });

    feed.write('hel', 'stdout');
    feed.write('lo\nwor', 'stdout');
    feed.write('problem: ', 'stderr');
    feed.write('ld\n', 'stdout');
    feed.write('auth expired\n', 'stderr');

    assert.deepEqual(lines, [
      { line: 'hello', stream: 'stdout' },
      { line: 'world', stream: 'stdout' },
      { line: 'problem: auth expired', stream: 'stderr' },
    ]);
  });

  test('treats carriage-return redraws and CRLF endings as line breaks', () => {
    const lines: string[] = [];
    const feed = createCliOutputFeed({ onLine: (line) => lines.push(line) });

    feed.write('10%\r20%\r30%\n', 'stdout');
    feed.write('done\r\n', 'stdout');

    assert.deepEqual(lines, ['10%', '20%', '30%', 'done']);
  });

  test('flush emits a buffered partial line as a complete line', () => {
    const lines: RecordedLine[] = [];
    const feed = createCliOutputFeed({ onLine: (line, stream) => lines.push({ line, stream }) });

    feed.write('no newline yet', 'stdout');
    assert.deepEqual(lines, []);

    feed.flush();
    assert.deepEqual(lines, [{ line: 'no newline yet', stream: 'stdout' }]);
  });
});

suite('CLI output feed status ticker', () => {
  test('emits the first status immediately and throttles the rest', () => {
    let clock = 0;
    const statuses: string[] = [];
    const feed = createCliOutputFeed({
      onStatus: (line) => statuses.push(line),
      statusIntervalMs: 100,
      now: () => clock,
    });

    feed.write('one\n', 'stdout');
    feed.write('two\n', 'stdout');
    feed.write('three\n', 'stdout');
    assert.deepEqual(statuses, ['one'], 'later lines inside the interval must be held back');

    clock = 150;
    feed.write('four\n', 'stdout');
    assert.deepEqual(statuses, ['one', 'four']);
  });

  test('flush delivers the freshest held-back status line', () => {
    const statuses: string[] = [];
    const feed = createCliOutputFeed({
      onStatus: (line) => statuses.push(line),
      statusIntervalMs: 100,
      now: () => 0,
    });

    feed.write('one\n', 'stdout');
    feed.write('two\n', 'stdout');
    feed.write('three\n', 'stdout');
    feed.flush();

    assert.deepEqual(statuses, ['one', 'three']);
  });

  test('whitespace-only lines never become status updates', () => {
    const statuses: string[] = [];
    const feed = createCliOutputFeed({ onStatus: (line) => statuses.push(line), now: () => 0 });

    feed.write('\n   \n\t\n', 'stdout');
    feed.flush();

    assert.deepEqual(statuses, []);
  });

  test('a long-lived unterminated line still advances the ticker', () => {
    const statuses: string[] = [];
    const feed = createCliOutputFeed({ onStatus: (line) => statuses.push(line), now: () => 0 });

    feed.write('Thinking about the card…', 'stdout');

    assert.deepEqual(statuses, ['Thinking about the card…']);
  });
});

suite('CLI feedback formatting', () => {
  test('truncateStatusLine collapses whitespace and caps the length', () => {
    assert.equal(truncateStatusLine('  spread \t over\nlines  '), 'spread over lines');
    const truncated = truncateStatusLine('x'.repeat(300));
    assert.equal(truncated.length, 120);
    assert.ok(truncated.endsWith('…'));
  });

  test('run-start heading names the provider, kind, card, prompt size, and working directory', () => {
    const stdin = 'the multi-line prompt\npiped to the CLI';
    const lines = formatCliRunStart(invocation({ stdin }), 'implementation', 'My card');
    assert.match(lines[0] ?? '', /Anthropic Claude Code CLI/);
    assert.match(lines[0] ?? '', /implementation/);
    assert.match(lines[0] ?? '', /"My card"/);
    assert.match(lines[2] ?? '', new RegExp(`prompt: ${stdin.length} chars via stdin`));
    assert.match(lines[3] ?? '', /E:\\workspace/);
    assert.ok(!lines.some((line) => line.includes(stdin)), 'the prompt must not be echoed verbatim');
  });

  test('the echoed command line elides a long argument', () => {
    const argument = `Work the card. ${'details '.repeat(200)}`;
    const commandLine = formatCliCommandLine(invocation({ args: ['-p', argument] }));
    assert.ok(commandLine.length < 200, 'a long argument must not be echoed verbatim');
    assert.match(commandLine, /\[\d+ chars\]/);
    assert.match(commandLine, /^C:\\Tools\\claude\.EXE -p /);
    assert.doesNotMatch(commandLine, /\n/);
  });

  test('run-exit footers describe success, failure, and cancellation distinctly', () => {
    assert.match(formatCliRunExit(processResult()), /code 0/);
    assert.match(formatCliRunExit(processResult({ cancelled: true })), /Stopped by the user/);
    assert.match(
      formatCliRunExit(processResult({ started: false, error: 'ENOENT' })),
      /Failed to start: ENOENT/,
    );
    assert.match(
      formatCliRunExit(processResult({ error: 'stream broke' })),
      /Failed while running: stream broke/,
    );
    assert.match(formatCliRunExit(processResult({ exitCode: 41 })), /exit code 41/);
    assert.match(
      formatCliRunExit(processResult({ exitCode: null, signal: 'SIGTERM' })),
      /signal SIGTERM/,
    );
  });
});
