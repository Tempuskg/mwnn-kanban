const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const {
  resolveAgentCliTarget,
  runAgentCliCardHandoff,
} = require('../dist-test/src/agentCliHandoff.js');
const { buildCardHandoffPrompt } = require('../dist-test/src/aiCards.js');
const { runBoardLoop } = require('../dist-test/src/boardLoop.js');
const { createBoardStore } = require('../dist-test/src/boardStore.js');

const provider = process.argv[2];
const configuredExecutable = process.argv[3];
const supportedProviders = ['copilot', 'codex', 'claude-code', 'cursor'];

if (!supportedProviders.includes(provider)) {
  console.error(`Usage: node scripts/smoke-agent-cli.cjs <${supportedProviders.join('|')}> [executable-path]`);
  process.exitCode = 2;
} else {
  void main(provider, configuredExecutable).catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}

async function main(selectedProvider, executableOverride) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mwnn-agent-smoke-'));
  const boardFolder = '.mwnn';
  const boardRoot = path.resolve(workspaceRoot, boardFolder);
  let timeout;
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: workspaceRoot, stdio: 'ignore' });
    const configuredPaths = executableOverride
      ? { [selectedProvider]: executableOverride }
      : {};
    const resolution = await resolveAgentCliTarget(
      selectedProvider,
      configuredPaths,
      { cwd: workspaceRoot },
    );
    if (!resolution.available) {
      throw new Error(resolution.reason);
    }

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

    let state = await store.addCard(inProgress.id, `AI loop smoke for ${selectedProvider}`);
    const card = state.columns
      .flatMap((column) => column.cards)
      .find((candidate) => candidate.title === `AI loop smoke for ${selectedProvider}`);
    if (!card) {
      throw new Error('Smoke card was not created.');
    }
    await store.setDescription(
      card.id,
      'This is an end-to-end handoff smoke test. Do not modify any repository file except this smoke card. Append a concise completion note and the required STATUS marker to this card Activity.',
    );
    await store.setAcceptanceCriteria(
      card.id,
      '- [ ] Only the smoke card is edited\n- [ ] Activity ends with STATUS: DONE',
    );
    state = await store.setAssignee(card.id, { kind: 'ai' });
    const readyCard = state.columns
      .flatMap((column) => column.cards)
      .find((candidate) => candidate.id === card.id);
    if (!readyCard) {
      throw new Error('Smoke card disappeared before dispatch.');
    }

    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 5 * 60_000);
    const cardPath = `${boardFolder}/cards/${card.id}.md`;

    const summary = await runBoardLoop(
      store,
      {
        dispatchCard: async (currentCard) => {
          const result = await runAgentCliCardHandoff({
            kind: 'implementation',
            target: resolution.target,
            cardId: currentCard.id,
            prompt: buildCardHandoffPrompt(currentCard, cardPath),
            cwd: workspaceRoot,
            store,
            signal: controller.signal,
          });
          if (!result.completed && !result.cancelled) {
            console.error(result.reason ?? 'CLI handoff failed without a reason.');
          }
          return {
            started: result.completed,
            activityBaseline: result.activityBaseline,
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
    if (
      summary.cancelled
      || summary.skipped.length > 0
      || finalColumn?.role !== 'verify'
      || finalCard?.assignee?.kind !== 'human'
    ) {
      throw new Error(
        `Smoke handoff did not reach the recoverable Verify transition.\n${finalCard?.activity ?? 'No card activity was available.'}`,
      );
    }

    console.log(`SMOKE PASS: ${resolution.target.label} processed ${card.id} through the AI loop into Verify.`);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (
      !workspaceRoot.startsWith(tempRoot)
      || !path.basename(workspaceRoot).startsWith('mwnn-agent-smoke-')
      || boardRoot !== path.join(workspaceRoot, '.mwnn')
    ) {
      throw new Error(`Refusing to remove unexpected smoke workspace: ${workspaceRoot}`);
    }
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
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
