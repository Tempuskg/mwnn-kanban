import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as vm from 'node:vm';
import { suite, test } from 'node:test';
import * as aiLoopProvider from '../../src/aiLoopProvider';
import * as runWithAi from '../../src/runWithAi';

// Exercise the actual compiled extension-host picker bodies with UI/discovery
// fakes, without importing vscode or activating the extension in node:test.
const extension = fs.readFileSync('dist-test/src/extension.js', 'utf8');
function pickerBody(name: string): string {
  const start = extension.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `Missing picker ${name}`);
  const end = extension.indexOf('\n}', start);
  assert.ok(end > start);
  return extension.slice(start, end + 2);
}

function harness(licensed: boolean) {
  const targets = [
    { provider: 'codex', label: 'Codex CLI', executable: 'codex' },
    { provider: 'copilot', label: 'Copilot CLI', executable: 'copilot' },
  ];
  let discoveries = 0;
  let guidance = 0;
  let offered: readonly { label: string }[] = [];
  const sandbox = {
    pro_1: { canUseUsageOrchestrator: async (_folder: unknown, prompt = false) => {
      if (!licensed && prompt) { guidance++; }
      return licensed;
    } },
    aiLoopProvider_1: aiLoopProvider,
    runWithAi_1: runWithAi,
    readAiLoopProvider: () => 'orchestrator',
    getImplicitWorkspaceFolder: () => undefined,
    readAgentCliPaths: () => ({}),
    readAllowedAgentCliProviders: () => ['codex', 'copilot'],
    readUsageOrchestratorExcludedClis: () => [],
    discoverChatHandoffTargets: async () => ({ targets: [] }),
    agentCliHandoff_1: {
      resolveAllAgentCliTargets: async () => {
        discoveries++;
        return targets.map((target) => ({ available: true, target }));
      },
      resolveAgentCliTarget: async () => ({ available: true, target: targets[0] }),
    },
    vscode: { window: {
      showQuickPick: async (choices: readonly { label: string }[]) => {
        offered = choices;
        return choices.find((choice) => choice.label === 'Usage Orchestrator') ?? choices[0];
      },
      showWarningMessage: () => assert.fail('Unexpected warning'),
    } },
  };
  const context = vm.createContext(sandbox);
  const loop = vm.runInContext(`${pickerBody('pickAiLoopTarget')}\n${pickerBody('pickAgentCliTarget')}\npickAiLoopTarget`, context) as (cwd: string) => Promise<{ orchestrated?: boolean } | undefined>;
  const cli = vm.runInContext('pickAgentCliTarget', context) as (cwd: string, preference: string) => Promise<{ orchestrated: boolean } | undefined>;
  const card = vm.runInContext(`${pickerBody('pickRunWithAiProvider')}\npickRunWithAiProvider`, context) as () => Promise<unknown>;
  return { loop, cli, card, discoveries: () => discoveries, guidance: () => guidance, labels: () => Array.from(offered, (choice) => choice.label) };
}

suite('Extension-host provider picker license boundary', () => {
  test('saved orchestrator preference stops with guidance before discovery or dispatch', async () => {
    const h = harness(false);
    assert.equal(await h.loop('/workspace'), undefined);
    assert.equal(h.guidance(), 1);
    assert.equal(h.discoveries(), 0);
  });
  test('both pickers hide orchestration without a key and preserve individual choices', async () => {
    const h = harness(false);
    assert.equal((await h.cli('/workspace', 'prompt'))?.orchestrated, false);
    assert.deepEqual(h.labels(), ['Codex CLI', 'Copilot CLI']);
    await h.card();
    assert.ok(!h.labels().includes('Usage Orchestrator'));
    assert.ok(h.labels().includes('OpenAI Codex CLI'));
    assert.equal((await h.cli('/workspace', 'codex'))?.orchestrated, false);
    assert.equal(h.guidance(), 0);
  });
  test('eligible license offers orchestration in both pickers and starts a saved preference', async () => {
    const h = harness(true);
    assert.equal((await h.cli('/workspace', 'prompt'))?.orchestrated, true);
    assert.ok(h.labels().includes('Usage Orchestrator'));
    await h.card();
    assert.ok(h.labels().includes('Usage Orchestrator'));
    assert.equal((await h.loop('/workspace'))?.orchestrated, true);
  });
});
