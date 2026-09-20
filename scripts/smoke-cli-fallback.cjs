/**
 * AI-loop CLI fallback smoke test, with simulated CLI results.
 *
 * Runs the real board store, the real AI board loop, and the real CLI handoff
 * evidence rules over a throwaway workspace, but replaces the CLI process
 * itself: the first provider "exits" with a credit-exhaustion message and the
 * replacement "exits" after appending the required STATUS marker. No agent CLI
 * is spawned and no paid credits are consumed.
 *
 * Verifies that a simulated credit failure continues the same card stage on
 * the replacement CLI, and that the switch is displayed in loop progress and
 * recorded in the card Activity.
 */

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createAgentCliFallbackRunner,
} = require('../dist-test/src/agentCliFallback.js');
const {
  AGENT_CLI_LABELS,
  runAgentCliCardHandoff,
} = require('../dist-test/src/agentCliHandoff.js');
const { buildCardHandoffPrompt } = require('../dist-test/src/aiCards.js');
const { runBoardLoop } = require('../dist-test/src/boardLoop.js');
const { createBoardStore } = require('../dist-test/src/boardStore.js');

const NEWLINE = String.fromCharCode(10);
const PRIMARY = 'codex';
const REPLACEMENT = 'claude-code';

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

async function main() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-fallback-smoke-'));
  const boardFolder = '.mwnn';
  try {
    const store = await createBoardStore({
      fileSystem: nodeFileSystem(workspaceRoot),
      boardFolder,
      defaultColumns: ['In Progress', 'Verify', 'Done'],
      defaultReadyReverseWip: 0,
    });
    const inProgress = store.getState().columns.find((column) => column.role === 'in-progress');
    if (!inProgress) {
      throw new Error('Smoke board has no In Progress column.');
    }

    let state = await store.addCard(inProgress.id, 'CLI fallback smoke');
    const card = state.columns
      .flatMap((column) => column.cards)
      .find((candidate) => candidate.title === 'CLI fallback smoke');
    if (!card) {
      throw new Error('Smoke card was not created.');
    }
    await store.setDescription(card.id, 'Continue this stage on the replacement CLI.');
    await store.setAcceptanceCriteria(
      card.id,
      ['- [ ] Partial step done by the first CLI', '- [ ] The replacement CLI finishes the stage'].join(NEWLINE),
    );
    await store.setAssignee(card.id, { kind: 'ai' });
    await store.appendActivity(card.id, 'Partial work from the first CLI is preserved.');
    state = await store.reload();
    const readyCard = state.columns
      .flatMap((column) => column.cards)
      .find((candidate) => candidate.id === card.id);
    if (!readyCard) {
      throw new Error('Smoke card disappeared before dispatch.');
    }

    const controller = new AbortController();
    const progress = [];
    const dispatched = [];
    const promptsByProvider = new Map();

    const runner = createAgentCliFallbackRunner({
      initialTarget: fakeTarget(PRIMARY),
      settings: { enabled: true, providers: [REPLACEMENT] },
      configuredPaths: {},
      cwd: workspaceRoot,
      store,
      signal: controller.signal,
      onProgress: (message) => {
        progress.push(message);
        console.log(message);
      },
      onSwitch: (record) => {
        console.log(`SWITCH: ${record.from.label} -> ${record.to.label} (${record.detail})`);
      },
      onPause: (reason) => {
        console.error(`PAUSE: ${reason}`);
      },
      resolveTarget: async (provider) => ({ available: true, target: fakeTarget(provider) }),
      runHandoff: (handoff, options) =>
        runAgentCliCardHandoff(handoff, {
          ...options,
          runProcess: async (invocation) => {
            dispatched.push(invocation.provider);
            promptsByProvider.set(invocation.provider, invocation.stdin);
            if (invocation.provider === PRIMARY) {
              // Partial work the replacement must keep instead of redoing.
              await store.setAcceptanceCriteria(
                handoff.cardId,
                ['- [x] Partial step done by the first CLI', '- [ ] The replacement CLI finishes the stage'].join(NEWLINE),
              );
              return {
                started: true,
                cancelled: false,
                exitCode: 1,
                signal: null,
                stdout: '',
                stderr: 'Simulated failure: you have run out of credits for this session.',
              };
            }
            await store.appendActivity(handoff.cardId, 'Finished by the replacement CLI.\nSTATUS: DONE');
            return {
              started: true,
              cancelled: false,
              exitCode: 0,
              signal: null,
              stdout: 'simulated replacement run finished',
              stderr: '',
            };
          },
        }),
    });

    const summary = await runBoardLoop(
      store,
      {
        dispatchCard: async (current) => {
          const outcome = await runner.run({
            kind: 'implementation',
            card: current,
            buildPrompt: (latest) =>
              buildCardHandoffPrompt(latest, `${boardFolder}/cards/${latest.id}.md`),
          });
          if (outcome.kind !== 'ran') {
            return false;
          }
          return {
            started: outcome.result.completed,
            activityBaseline: outcome.result.activityBaseline,
          };
        },
        requestDefinition: async () => false,
        requestTriage: async () => false,
        decideDoability: async () => ({ decision: 'ai' }),
      },
      {
        isCancelled: () => controller.signal.aborted,
        delay: async () => undefined,
      },
      {
        pollIntervalMs: 0,
        onEvent: (message) => console.log(message),
      },
    );

    const finalState = await store.reload();
    const finalColumn = finalState.columns.find((column) =>
      column.cards.some((candidate) => candidate.id === card.id));
    const finalCard = finalColumn?.cards.find((candidate) => candidate.id === card.id);
    const activity = finalCard?.activity ?? '';
    const replacementPrompt = promptsByProvider.get(REPLACEMENT) ?? '';

    assert(
      dispatched.join(',') === `${PRIMARY},${REPLACEMENT}`,
      `expected one run per CLI in order, got: ${dispatched.join(',') || 'none'}`,
    );
    assert(
      replacementPrompt.includes('## Handoff note')
      && replacementPrompt.includes('STATUS: DONE')
      && replacementPrompt.includes('- [x] Partial step done by the first CLI'),
      'the replacement did not receive the interruption note, the stage markers, and the latest card contents',
    );
    assert(
      activity.includes(`Switched from ${AGENT_CLI_LABELS[PRIMARY]} to ${AGENT_CLI_LABELS[REPLACEMENT]}`)
      && activity.includes('Interrupted stage: implementation.')
      && activity.includes('Exhaustion reason:'),
      'the switch was not recorded in the card Activity',
    );
    assert(
      progress.some((message) =>
        message.includes(`continuing the implementation stage with ${AGENT_CLI_LABELS[REPLACEMENT]}`)),
      'the switch was not displayed in loop progress',
    );
    assert(
      activity.includes('Partial work from the first CLI is preserved.'),
      'existing Activity history was not preserved',
    );
    assert(
      !summary.cancelled && summary.skipped.length === 0 && finalColumn?.role === 'verify',
      `the continued stage did not complete into Verify (column: ${finalColumn?.title ?? 'none'})`,
    );

    console.log(
      `SMOKE PASS: a simulated ${AGENT_CLI_LABELS[PRIMARY]} credit failure continued the same implementation stage on ${AGENT_CLI_LABELS[REPLACEMENT]} without spending real credits.`,
    );
  } finally {
    const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (
      !workspaceRoot.startsWith(tempRoot)
      || !path.basename(workspaceRoot).startsWith('mwnn-fallback-smoke-')
    ) {
      throw new Error(`Refusing to remove unexpected smoke workspace: ${workspaceRoot}`);
    }
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`SMOKE FAIL: ${message}`);
  }
}

function fakeTarget(provider) {
  return {
    provider,
    label: AGENT_CLI_LABELS[provider],
    executable: `simulated-${provider}`,
    launcher: 'standalone',
  };
}

function nodeFileSystem(workspaceRoot) {
  const resolve = (relativePath) =>
    path.resolve(workspaceRoot, ...relativePath.split('/').filter(Boolean));
  return {
    async exists(relativePath) {
      try {
        await fs.access(resolve(relativePath));
        return true;
      } catch {
        return false;
      }
    },
    async readFile(relativePath) {
      return fs.readFile(resolve(relativePath), 'utf8');
    },
    async writeFile(relativePath, content) {
      await fs.mkdir(path.dirname(resolve(relativePath)), { recursive: true });
      await fs.writeFile(resolve(relativePath), content, 'utf8');
    },
    async deleteFile(relativePath) {
      await fs.rm(resolve(relativePath), { force: true });
    },
    async readDirectory(relativePath) {
      return fs.readdir(resolve(relativePath));
    },
    async createDirectory(relativePath) {
      await fs.mkdir(resolve(relativePath), { recursive: true });
    },
  };
}
