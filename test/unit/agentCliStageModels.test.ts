import { AGENT_CLI_PROVIDER_IDS } from '../../src/agentCliProviders';
import { createAgentCliUsageOrchestrator } from '../../src/agentCliOrchestrator';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { suite, test } from 'node:test';
import {
  AGENT_CLI_HANDOFF_KINDS,
  AGENT_CLI_LABELS,
  isAgentCliHandoffKind,
  resolveAgentCliModelSelection,
  resolveAgentCliTarget,
  runAgentCliCardHandoff,
  type AgentCliCardHandoff,
  type AgentCliCardHandoffResult,
  type AgentCliHandoffKind,
  type AgentCliInvocation,
  type AgentCliProcessResult,
  type AgentCliProviderId,
  type AgentCliTarget,
} from '../../src/agentCliHandoff';
import {
  AGENT_CLI_STAGE_MODELS_SETTING,
  EMPTY_AGENT_CLI_STAGE_MODELS,
  mergeAgentCliStagePreferences,
  readAgentCliStageThinkingLevels,
  readAgentCliThinkingLevels,
  resolveAgentCliThinkingLevel,
  readAgentCliModelCatalog,
  readAgentCliStageModels,
  resolveAgentCliModel,
  stageAgentCliModel,
} from '../../src/agentCliModels';
import { createAgentCliFallbackRunner } from '../../src/agentCliFallback';
import {
  runCardWithAgentCli,
  type RunCardWithAgentCliDeps,
  type RunCardWithAgentCliRequest,
} from '../../src/runWithAi';
import {
  addCard,
  appendActivity,
  cloneBoard,
  defaultBoard,
  setAcceptanceCriteria,
  setAssignee,
  setDescription,
  setPreferredModel,
  cardPreferredModelFor,
} from '../../src/utils';
import type { BoardState, Card } from '../../src/types';

const NOW = new Date('2026-09-19T11:00:00.000Z');
const CWD = 'E:/workspace';
const CARD_MODEL = 'claude-opus-5';
const WORKSPACE_DEFAULT = 'gpt-5-codex';

/** One distinct model per stage, so a stage running on the wrong rule is visible. */
const STAGE_MODELS = {
  definition: 'gpt-5-mini',
  triage: 'gpt-5-nano',
  implementation: 'gpt-5-codex-high',
  verification: 'gpt-5',
} as const satisfies Record<AgentCliHandoffKind, string>;

suite('AI loop stage model rules: settings validation', () => {
  test('keys are exactly the four handoff kinds, and no column identity appears', () => {
    // The stage ids the loop dispatches on are the only keys the setting has:
    // a column id is per-board and a column title is user-editable, so either
    // would silently stop matching. This asserts the key set, not a string.
    assert.deepEqual([...AGENT_CLI_HANDOFF_KINDS].sort(), [
      'definition',
      'implementation',
      'triage',
      'verification',
    ]);
    const rules = readAgentCliStageModels(STAGE_MODELS);
    assert.deepEqual(Object.keys(rules).sort(), [...AGENT_CLI_HANDOFF_KINDS].sort());
    for (const kind of AGENT_CLI_HANDOFF_KINDS) {
      assert.equal(isAgentCliHandoffKind(kind), true);
      assert.equal(stageAgentCliModel(rules, kind), STAGE_MODELS[kind]);
    }
    assert.equal(isAgentCliHandoffKind('col-mqwk2njn-1'), false);
    assert.equal(isAgentCliHandoffKind('In Progress'), false);
  });

  test('unknown stage keys are ignored without throwing', () => {
    const rules = readAgentCliStageModels({
      implementation: STAGE_MODELS.implementation,
      // A misspelled stage, a column id, and a column title all simply never
      // match a known stage, so none of them can reach a dispatch.
      implementaiton: 'typo-model',
      'col-mqwk2njn-3': 'column-id-model',
      'In Progress': 'column-title-model',
      review: 'not-a-stage',
    });

    assert.deepEqual(rules, { implementation: STAGE_MODELS.implementation });
    assert.equal(stageAgentCliModel(rules, 'definition'), undefined);
  });

  test('blank and unusable values are dropped rather than applied', () => {
    const rules = readAgentCliStageModels({
      definition: '   ',
      triage: '',
      implementation: `  ${STAGE_MODELS.implementation}  `,
      verification: 'has\u0000a-control-character',
    });

    // Trimmed, not merely accepted: the value reaches a spawn argument.
    assert.deepEqual(rules, { implementation: STAGE_MODELS.implementation });
  });

  test('non-object and non-string settings degrade to no rules without throwing', () => {
    for (const value of [undefined, null, 'gpt-5', 42, true, ['gpt-5'], () => 'gpt-5']) {
      const rules = readAgentCliStageModels(value);
      assert.deepEqual(rules, {});
      assert.equal(resolveAgentCliModel('codex', undefined, undefined, {
        stage: 'implementation',
        stageModels: rules,
      }), undefined);
    }

    for (const value of [0, false, {}, [], null]) {
      const rules = readAgentCliStageModels({ implementation: value, triage: value });
      assert.deepEqual(rules, {});
    }
  });
});

suite('AI loop stage model rules: settings manifest', () => {
  test('the setting is contributed, empty by default, and describes every stage', () => {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
      readonly contributes?: {
        readonly configuration?: {
          readonly properties?: Record<
            string,
            {
              readonly type?: string;
              readonly default?: unknown;
              readonly additionalProperties?: boolean;
              readonly markdownDescription?: string;
              readonly properties?: Record<string, { readonly type?: readonly string[]; readonly description?: string }>;
            }
          >;
        };
      };
    };
    const declared = manifest.contributes?.configuration?.properties?.[AGENT_CLI_STAGE_MODELS_SETTING];

    assert.ok(declared, `${AGENT_CLI_STAGE_MODELS_SETTING} is not contributed`);
    assert.equal(declared.type, 'object');
    // Empty by default is what keeps an untouched workspace behaving exactly
    // as it did before this setting existed.
    assert.deepEqual(declared.default, {});
    assert.equal(declared.additionalProperties, false);
    assert.deepEqual(Object.keys(declared.properties ?? {}).sort(), [...AGENT_CLI_HANDOFF_KINDS].sort());
    for (const kind of AGENT_CLI_HANDOFF_KINDS) {
      const declaredStage: { readonly type?: readonly string[]; readonly description?: string } | undefined =
        declared.properties?.[kind];
      assert.deepEqual(declaredStage?.type, ['object', 'string'], `${kind} must accept provider maps and legacy strings`);
      assert.ok((declaredStage?.description ?? '').length > 0, `${kind} has no description`);
    }
    // No column identity leaks into the settings UI.
    assert.doesNotMatch(JSON.stringify(declared), /col-|column/i);
  });
});

suite('AI loop stage model rules: resolution order', () => {
  const stageModels = readAgentCliStageModels(STAGE_MODELS);
  const catalog = readAgentCliModelCatalog({ codex: [WORKSPACE_DEFAULT] });

  test('a stage rule beats the workspace default', () => {
    const resolved = resolveAgentCliModel('codex', undefined, catalog, {
      stage: 'triage',
      stageModels,
    });

    assert.deepEqual(resolved, { model: STAGE_MODELS.triage, source: 'stage-rule' });
  });

  test("a card's own model beats the stage rule", () => {
    const resolved = resolveAgentCliModel('codex', CARD_MODEL, catalog, {
      stage: 'implementation',
      stageModels,
    });

    assert.deepEqual(resolved, { model: CARD_MODEL, source: 'card' });
  });

  test('an unset stage falls through to the workspace default, then to nothing', () => {
    const onlyTriage = readAgentCliStageModels({ triage: STAGE_MODELS.triage });

    assert.deepEqual(
      resolveAgentCliModel('codex', undefined, catalog, {
        stage: 'verification',
        stageModels: onlyTriage,
      }),
      { model: WORKSPACE_DEFAULT, source: 'workspace-default' },
    );
    // No card model, no rule for this stage, no workspace list for this
    // provider: nothing is resolved, so the argv is what it was before any of
    // these settings existed.
    assert.equal(
      resolveAgentCliModel('cursor', undefined, catalog, {
        stage: 'verification',
        stageModels: onlyTriage,
      }),
      undefined,
    );
    assert.equal(
      resolveAgentCliModel('codex', undefined, undefined, {
        stage: 'verification',
        stageModels: EMPTY_AGENT_CLI_STAGE_MODELS,
      }),
      undefined,
    );
  });

  test('omitting the stage skips the stage layer entirely', () => {
    assert.deepEqual(resolveAgentCliModel('codex', undefined, catalog), {
      model: WORKSPACE_DEFAULT,
      source: 'workspace-default',
    });
    assert.equal(resolveAgentCliModelSelection('codex', undefined, { stageModels })?.requested, undefined);
  });

  test('a stage rule becomes the CLI model argument and is labelled as a stage rule', () => {
    const selection = resolveAgentCliModelSelection('codex', undefined, {
      catalog,
      stage: 'definition',
      stageModels,
    });

    assert.ok(selection);
    assert.equal(selection.applied, true);
    assert.equal(selection.source, 'stage-rule');
    assert.equal(selection.stage, 'definition');
    assert.deepEqual(selection.args, ['--model', STAGE_MODELS.definition]);
  });

  test('a provider that takes no model selection reports the stage rule it skipped', () => {
    const selection = resolveAgentCliModelSelection('codex', undefined, {
      stage: 'triage',
      stageModels,
      flags: { copilot: undefined, codex: undefined, 'claude-code': undefined, cursor: undefined },
    });

    assert.ok(selection);
    assert.equal(selection.applied, false);
    assert.deepEqual(selection.args, []);
    assert.match(selection.reason ?? '', /AI loop stage model rule for the triage stage/);
    assert.match(selection.reason ?? '', new RegExp(STAGE_MODELS.triage));
  });
});

suite('AI loop stage model rules: dispatch', () => {
  test('each of the four stages dispatches on its own model within one loop run', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const stageModels = readAgentCliStageModels(STAGE_MODELS);
    const dispatched = new Map<AgentCliHandoffKind, readonly string[]>();

    // One board, one card, one sequence of handoffs: the same shape a loop run
    // has, so a stage reusing another stage's model would show up here.
    for (const kind of AGENT_CLI_HANDOFF_KINDS) {
      await runAgentCliCardHandoff(
        {
          kind,
          target: target('codex'),
          cardId,
          prompt: 'handoff prompt',
          cwd: CWD,
          store: board.store,
          signal: new AbortController().signal,
          modelCatalog: readAgentCliModelCatalog({ codex: [WORKSPACE_DEFAULT] }),
          stageModels,
        },
        {
          now: () => NOW,
          runProcess: async (invocation) => {
            dispatched.set(kind, invocation.args);
            return cleanExit();
          },
        },
      );
    }

    for (const kind of AGENT_CLI_HANDOFF_KINDS) {
      assert.deepEqual(
        dispatched.get(kind),
        ['exec', '--model', STAGE_MODELS[kind], '--sandbox', 'workspace-write', '-'],
        `the ${kind} stage did not run on its own configured model`,
      );
    }
    const activity = board.activity(cardId);
    for (const kind of AGENT_CLI_HANDOFF_KINDS) {
      assert.ok(
        activity.includes(`AI loop stage model rule for the ${kind} stage: ${STAGE_MODELS[kind]}.`),
        `the ${kind} stage did not record its model on the card`,
      );
    }
    // Rules stay settings: nothing is written back into the card.
    assert.equal(cardPreferredModelFor(board.card(cardId), 'codex'), undefined);
  });

  test('a stage with no rule falls back to the workspace default mid-run', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const stageModels = readAgentCliStageModels({ triage: STAGE_MODELS.triage });
    const dispatched = new Map<AgentCliHandoffKind, readonly string[]>();

    for (const kind of ['triage', 'implementation'] as const) {
      await runAgentCliCardHandoff(
        {
          kind,
          target: target('codex'),
          cardId,
          prompt: 'handoff prompt',
          cwd: CWD,
          store: board.store,
          signal: new AbortController().signal,
          modelCatalog: readAgentCliModelCatalog({ codex: [WORKSPACE_DEFAULT] }),
          stageModels,
        },
        {
          now: () => NOW,
          runProcess: async (invocation) => {
            dispatched.set(kind, invocation.args);
            return cleanExit();
          },
        },
      );
    }

    assert.deepEqual(dispatched.get('triage'), [
      'exec',
      '--model',
      STAGE_MODELS.triage,
      '--sandbox',
      'workspace-write',
      '-',
    ]);
    assert.deepEqual(dispatched.get('implementation'), [
      'exec',
      '--model',
      WORKSPACE_DEFAULT,
      '--sandbox',
      'workspace-write',
      '-',
    ]);
  });

  test('no stage rules at all leaves the argv byte-identical to an unconfigured workspace', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    let args: readonly string[] = [];

    const result = await runAgentCliCardHandoff(
      {
        kind: 'implementation',
        target: target('codex'),
        cardId,
        prompt: 'handoff prompt',
        cwd: CWD,
        store: board.store,
        signal: new AbortController().signal,
        stageModels: readAgentCliStageModels({ 'In Progress': 'column-title-model' }),
      },
      {
        now: () => NOW,
        runProcess: async (invocation) => {
          args = invocation.args;
          board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
          return cleanExit();
        },
      },
    );

    assert.deepEqual(args, ['exec', '--sandbox', 'workspace-write', '-']);
    assert.equal(result.modelSelection, undefined);
  });

  test("a card's own model overrides the stage rule for that dispatch only", async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    board.mutate((current) => setPreferredModel(current, cardId, 'codex', CARD_MODEL));
    let args: readonly string[] = [];

    const result = await runAgentCliCardHandoff(
      {
        kind: 'implementation',
        target: target('codex'),
        cardId,
        prompt: 'handoff prompt',
        cwd: CWD,
        store: board.store,
        signal: new AbortController().signal,
        modelCatalog: readAgentCliModelCatalog({ codex: [WORKSPACE_DEFAULT] }),
        stageModels: readAgentCliStageModels(STAGE_MODELS),
      },
      {
        now: () => NOW,
        runProcess: async (invocation) => {
          args = invocation.args;
          board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
          return cleanExit();
        },
      },
    );

    assert.equal(result.modelSelection?.source, 'card');
    assert.equal(result.modelSelection?.requested, CARD_MODEL);
    assert.deepEqual(args, ['exec', '--model', CARD_MODEL, '--sandbox', 'workspace-write', '-']);
    assert.ok(board.activity(cardId).includes(`Card preferred model: ${CARD_MODEL}.`));
  });

  test('a refused stage rule is reported like a refused card model, never as credit exhaustion', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);

    const result = await runAgentCliCardHandoff(
      {
        kind: 'verification',
        target: target('codex'),
        cardId,
        prompt: 'handoff prompt',
        cwd: CWD,
        store: board.store,
        signal: new AbortController().signal,
        stageModels: readAgentCliStageModels({ verification: STAGE_MODELS.verification }),
      },
      {
        now: () => NOW,
        runProcess: async () =>
          failedProcess(`Error: unknown model "${STAGE_MODELS.verification}"`),
      },
    );

    assert.equal(result.completed, false);
    // The CLI's allowance is fine, so the loop must not burn a fallback
    // provider on what is really a settings mistake.
    assert.equal(result.creditExhaustion, undefined);
    assert.equal(result.modelSelection?.source, 'stage-rule');
    assert.equal(result.modelSelection?.stage, 'verification');
    assert.match(result.reason ?? '', /rejected the AI loop stage model rule for the verification stage/);
    assert.match(result.reason ?? '', /The card was not advanced/);
    // Recovery identifies both the stage and CLI so other overrides are preserved.
    assert.ok((result.reason ?? '').includes(`"verification" / "codex" in ${AGENT_CLI_STAGE_MODELS_SETTING}`));
    assert.ok(board.activity(cardId).includes(AGENT_CLI_STAGE_MODELS_SETTING));
  });

  test('a refused card model still names the card, not the stage setting', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    board.mutate((current) => setPreferredModel(current, cardId, 'codex', CARD_MODEL));

    const result = await runAgentCliCardHandoff(
      {
        kind: 'implementation',
        target: target('codex'),
        cardId,
        prompt: 'handoff prompt',
        cwd: CWD,
        store: board.store,
        signal: new AbortController().signal,
        stageModels: readAgentCliStageModels(STAGE_MODELS),
      },
      {
        now: () => NOW,
        runProcess: async () => failedProcess(`Error: unknown model "${CARD_MODEL}"`),
      },
    );

    assert.equal(result.creditExhaustion, undefined);
    assert.match(result.reason ?? '', /rejected the card's preferred model/);
    assert.doesNotMatch(result.reason ?? '', new RegExp(AGENT_CLI_STAGE_MODELS_SETTING));
  });
});

suite('AI loop stage model rules: the loop dispatch path', () => {
  test('the fallback runner the loop uses carries each stage rule to the CLI', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const dispatched = new Map<AgentCliHandoffKind, readonly string[]>();
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['cursor'] },
      configuredPaths: {},
      modelCatalog: readAgentCliModelCatalog({ codex: [WORKSPACE_DEFAULT] }),
      stageModels: readAgentCliStageModels(STAGE_MODELS),
      cwd: CWD,
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: async (provider) => ({ available: true, target: target(provider) }),
      runHandoff: (handoff, options) =>
        runAgentCliCardHandoff(handoff, {
          ...options,
          now: () => NOW,
          runProcess: async (invocation) => {
            dispatched.set(handoff.kind, invocation.args);
            return cleanExit();
          },
        }),
    });

    // One runner, one card: exactly the shape a loop run has.
    for (const kind of AGENT_CLI_HANDOFF_KINDS) {
      await runner.run({ kind, card: board.card(cardId), buildPrompt: () => 'prompt' });
    }

    for (const kind of AGENT_CLI_HANDOFF_KINDS) {
      assert.deepEqual(
        dispatched.get(kind),
        ['exec', '--model', STAGE_MODELS[kind], '--sandbox', 'workspace-write', '-'],
        `the ${kind} stage did not reach the CLI on its own configured model`,
      );
    }
  });

  test('a replacement CLI retries the interrupted stage on that stage rule', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const invocations: AgentCliInvocation[] = [];
    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['cursor'] },
      configuredPaths: {},
      stageModels: readAgentCliStageModels(STAGE_MODELS),
      cwd: CWD,
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      resolveTarget: async (provider) => ({ available: true, target: target(provider) }),
      runHandoff: (handoff, options) =>
        runAgentCliCardHandoff(handoff, {
          ...options,
          now: () => NOW,
          runProcess: async (invocation) => {
            invocations.push(invocation);
            if (invocation.provider === 'codex') {
              return failedProcess('This account is out of credits.');
            }
            board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
            return cleanExit();
          },
        }),
    });

    await runner.run({
      kind: 'triage',
      card: board.card(cardId),
      buildPrompt: () => 'prompt',
    });

    // The stage rule is not provider-specific, so it carries over to the
    // replacement, which spells `--model` its own way.
    assert.deepEqual(invocations[1]?.args, [
      '-p',
      '--force',
      '--output-format',
      'text',
      '--model',
      STAGE_MODELS.triage,
    ]);
    assert.ok(
      board
        .activity(cardId)
        .includes(`${AGENT_CLI_LABELS.cursor} model: "${STAGE_MODELS.triage}", from the AI loop stage model rule.`),
    );
  });
});

suite('AI loop stage model rules: Run Card with AI', () => {
  test('running a card uses the implementation stage rule', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    let args: readonly string[] = [];

    const completed = await runCardWithAgentCli(
      request('claude-code', cardId, 'implementation'),
      runDeps(board, async (invocation) => {
        args = invocation.args;
        board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
        return cleanExit();
      }),
    );

    assert.equal(completed, true);
    assert.deepEqual(args, [
      '-p',
      '--permission-mode',
      'bypassPermissions',
      '--output-format',
      'text',
      '--model',
      STAGE_MODELS.implementation,
    ]);
  });

  test('filling in a card definition uses the definition stage rule', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    let args: readonly string[] = [];

    await runCardWithAgentCli(
      request('claude-code', cardId, 'definition'),
      runDeps(board, async (invocation) => {
        args = invocation.args;
        return cleanExit();
      }),
    );

    assert.deepEqual(args.slice(-2), ['--model', STAGE_MODELS.definition]);
  });
});

suite('Per-stage per-CLI model and thinking preferences', () => {
  const rawModels = Object.fromEntries(AGENT_CLI_HANDOFF_KINDS.map((stage) => [stage,
    Object.fromEntries(AGENT_CLI_PROVIDER_IDS.map((provider) => [provider, stage + '-' + provider + '-model']))]));
  const rawLevels = Object.fromEntries(AGENT_CLI_HANDOFF_KINDS.map((stage) => [stage,
    Object.fromEntries(AGENT_CLI_PROVIDER_IDS.map((provider) => [provider, stage + '-' + provider + '-effort']))]));
  const models = readAgentCliStageModels(rawModels);
  const levels = readAgentCliStageThinkingLevels(rawLevels);

  test('all sixteen pairs resolve card, stage, provider and CLI defaults independently', () => {
    for (const stage of AGENT_CLI_HANDOFF_KINDS) {
      for (const provider of AGENT_CLI_PROVIDER_IDS) {
        const catalog = readAgentCliModelCatalog({ [provider]: ['provider-model'] });
        const defaults = readAgentCliThinkingLevels({ [provider]: 'provider-effort' });
        const modelContext = { stage, stageModels: models };
        const levelContext = { stage, stageThinkingLevels: levels };
        assert.deepEqual(resolveAgentCliModel(provider, 'card-model', catalog, modelContext), { model: 'card-model', source: 'card' });
        assert.deepEqual(resolveAgentCliThinkingLevel(provider, 'card-effort', defaults, levelContext), { level: 'card-effort', source: 'card' });
        assert.deepEqual(resolveAgentCliModel(provider, undefined, catalog, modelContext), { model: stage + '-' + provider + '-model', source: 'stage-rule' });
        assert.deepEqual(resolveAgentCliThinkingLevel(provider, undefined, defaults, levelContext), { level: stage + '-' + provider + '-effort', source: 'stage-rule' });
        const other = provider === 'codex' ? 'copilot' : 'codex';
        assert.deepEqual(resolveAgentCliModel(provider, undefined, catalog, { stage, stageModels: readAgentCliStageModels({ [stage]: { [other]: 'other-cli' } }) }), { model: 'provider-model', source: 'workspace-default' });
        assert.deepEqual(resolveAgentCliThinkingLevel(provider, undefined, defaults, { stage, stageThinkingLevels: {} }), { level: 'provider-effort', source: 'workspace-default' });
        assert.equal(resolveAgentCliModel(provider, undefined, {}, { stage, stageModels: {} }), undefined);
        assert.equal(resolveAgentCliThinkingLevel(provider, undefined, {}, { stage, stageThinkingLevels: {} }), undefined);
        // A model never requires effort, and effort never requires a model.
        assert.equal(resolveAgentCliThinkingLevel(provider, undefined, {}, { stage, stageThinkingLevels: {} }), undefined);
        assert.equal(resolveAgentCliModel(provider, undefined, {}, modelContext, 'escalation')?.source, 'escalation');
      }
    }
  });

  test('both configuration schemas allow optional free-form CLI entries at every stage and legacy strings', () => {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
      contributes: { configuration: { properties: Record<string, {
        properties: Record<string, { type: readonly string[]; properties: Record<string, { type: string; enum?: unknown }>; required?: unknown }>
      }> } }
    };
    for (const key of ['mwnn-kanban.agentCliStageModels', 'mwnn-kanban.agentCliStageThinkingLevels']) {
      const setting = manifest.contributes.configuration.properties[key];
      assert.ok(setting);
      for (const stage of AGENT_CLI_HANDOFF_KINDS) {
        const schema: { type: readonly string[]; properties: Record<string, { type: string; enum?: unknown }>; required?: unknown } | undefined = setting.properties[stage];
        assert.ok(schema);
        assert.deepEqual(schema.type, ['object', 'string']);
        assert.equal(schema.required, undefined);
        assert.deepEqual(Object.keys(schema.properties).sort(), [...AGENT_CLI_PROVIDER_IDS].sort());
        for (const provider of AGENT_CLI_PROVIDER_IDS) {
          assert.equal(schema.properties[provider]?.type, 'string');
          assert.equal(schema.properties[provider]?.enum, undefined, 'names must remain free-form');
        }
      }
    }
  });

  test('malformed stage/provider values are safely ignored on both axes', () => {
    const raw = { unknown: { codex: 'ignored' }, definition: { codex: ' good ', cursor: ' ', unknown: 'no', copilot: ['no'], 'claude-code': false },
      triage: [], implementation: { codex: 'bad\u0000value', cursor: null }, verification: 42 };
    assert.deepEqual(readAgentCliStageModels(raw), { definition: { codex: 'good' } });
    assert.deepEqual(readAgentCliStageThinkingLevels(raw), { definition: { codex: 'good' } });
    assert.deepEqual(readAgentCliStageThinkingLevels('not a map'), {});
  });

  test('scope inheritance merges by CLI even across legacy strings without mutating inputs', () => {
    const user = { implementation: 'legacy', definition: { copilot: 'user' } };
    const workspace = { implementation: { codex: 'local' }, definition: { cursor: 'local-cursor' } };
    const effective = mergeAgentCliStagePreferences({}, user, workspace, { implementation: { copilot: 'folder' } });
    assert.deepEqual(effective, { implementation: { copilot: 'folder', codex: 'local', 'claude-code': 'legacy', cursor: 'legacy' }, definition: { copilot: 'user', cursor: 'local-cursor' } });
    assert.deepEqual(user, { implementation: 'legacy', definition: { copilot: 'user' } });
    assert.deepEqual(workspace, { implementation: { codex: 'local' }, definition: { cursor: 'local-cursor' } });
    assert.equal(stageAgentCliModel(mergeAgentCliStagePreferences(user, { implementation: 'new-legacy' }), 'implementation', 'codex'), 'new-legacy');
  });

  test('all sixteen dispatches report the CLI, stage and independent sources, including unsupported effort', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    for (const kind of AGENT_CLI_HANDOFF_KINDS) {
      for (const provider of AGENT_CLI_PROVIDER_IDS) {
        let args: readonly string[] = [];
        const result = await runAgentCliCardHandoff({ kind, target: target(provider), cardId, prompt: 'prompt', cwd: CWD,
          store: board.store, signal: new AbortController().signal, stageModels: models, stageThinkingLevels: levels },
        { now: () => NOW, runProcess: async (invocation) => { args = invocation.args; return cleanExit(); } });
        const model = kind + '-' + provider + '-model';
        const effort = kind + '-' + provider + '-effort';
        assert.equal(result.modelSelection?.requested, model);
        assert.equal(result.modelSelection?.source, 'stage-rule');
        assert.equal(result.thinkingSelection?.requested, effort);
        assert.equal(result.thinkingSelection?.source, 'stage-rule');
        assert.ok(args.includes(model));
        if (provider === 'cursor') {
          assert.equal(result.thinkingSelection?.applied, false);
          assert.ok(!args.some((arg) => arg.includes(effort)));
          assert.match(board.activity(cardId), /not applied/i);
        } else {
          assert.equal(result.thinkingSelection?.applied, true);
          assert.ok(args.some((arg) => arg.includes(effort)));
        }
        assert.ok(board.activity(cardId).includes(AGENT_CLI_LABELS[provider]));
        assert.ok(board.activity(cardId).includes('for the ' + kind + ' stage: ' + model));
        assert.ok(board.activity(cardId).includes(effort));
        assert.equal(board.card(cardId).preferredModels, undefined);
        assert.equal(board.card(cardId).thinkingLevels, undefined);
      }
    }
  });

  test('absent preferences add no corresponding argument; each axis can dispatch alone', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      for (const axis of ['neither', 'model', 'effort']) {
        let args: readonly string[] = [];
        const result = await runAgentCliCardHandoff({ kind: 'implementation', target: target(provider), cardId, prompt: 'prompt', cwd: CWD,
          store: board.store, signal: new AbortController().signal, stageModels: axis === 'model' ? models : {}, stageThinkingLevels: axis === 'effort' ? levels : {} },
        { now: () => NOW, runProcess: async (invocation) => { args = invocation.args; return cleanExit(); } });
        assert.equal(args.includes('--model'), axis === 'model');
        assert.equal(result.modelSelection !== undefined, axis === 'model');
        assert.equal(result.thinkingSelection !== undefined, axis === 'effort');
        if (axis !== 'effort' || provider === 'cursor') {
          assert.ok(!args.some((arg) => /--effort|model_reasoning_effort/.test(arg)));
        }
      }
    }
  });

  for (const kind of AGENT_CLI_HANDOFF_KINDS) {
    for (const orchestrated of [false, true]) {
      test(kind + ' resolves both preferences again after ' + (orchestrated ? 'orchestrator selection and fallback' : 'credit fallback'), async () => {
        const { state, cardId } = boardWithCard();
        const board = fakeBoard(state);
        const selections: { provider: AgentCliProviderId; model?: string; effort?: string }[] = [];
        const orchestrator = createAgentCliUsageOrchestrator({ configuredPaths: {}, cwd: CWD,
          resolveTarget: async (provider) => ({ available: true, target: target(provider) }),
          probe: async (cli) => ({ kind: 'unknown', provider: cli.provider, reason: 'not reported' }),
        });
        const first = orchestrated ? 'copilot' : 'codex';
        const replacement = orchestrated ? 'codex' : 'cursor';
        const runner = createAgentCliFallbackRunner({
          initialTarget: target(orchestrated ? 'cursor' : first), configuredPaths: {}, cwd: CWD, store: board.store,
          signal: new AbortController().signal, settings: { enabled: !orchestrated, providers: [replacement] },
          stageModels: models, stageThinkingLevels: levels, ...(orchestrated ? { orchestrator } : {}),
          resolveTarget: async (provider) => ({ available: true, target: target(provider) }),
          runHandoff: async (handoff, options) => {
            const result = await runAgentCliCardHandoff(handoff, { ...options, now: () => NOW,
              runProcess: async (invocation) => {
                if (invocation.provider === first) { return failedProcess('This account is out of credits.'); }
                board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
                return cleanExit();
              },
            });
            selections.push({ provider: handoff.target.provider,
              ...(result.modelSelection ? { model: result.modelSelection.requested } : {}),
              ...(result.thinkingSelection ? { effort: result.thinkingSelection.requested } : {}),
            });
            return result;
          },
        });
        await runner.run({ kind, card: board.card(cardId), buildPrompt: () => 'prompt' });
        assert.deepEqual(selections, [first, replacement].map((provider) => ({ provider, model: kind + '-' + provider + '-model', effort: kind + '-' + provider + '-effort' })));
      });
    }
  }

  test('Run Card with AI uses the selected CLI implementation map on both axes', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    let args: readonly string[] = [];
    const deps = { ...runDeps(board, async (invocation) => {
      args = invocation.args;
      board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
      return cleanExit();
    }), stageModels: models, stageThinkingLevels: levels };
    await runCardWithAgentCli(request('claude-code', cardId, 'implementation'), deps);
    assert.ok(args.includes('implementation-claude-code-model'));
    assert.ok(args.includes('implementation-claude-code-effort'));
  });
});

// --- helpers ---------------------------------------------------------------

interface FakeBoard {
  readonly store: {
    reload(): Promise<BoardState>;
    appendActivity(cardId: string, entry: string): Promise<void>;
    moveCard(cardId: string, toColumnId: string, toIndex: number): Promise<void>;
    setAssignee(cardId: string, assignee: Card['assignee']): Promise<void>;
    setAcceptanceCriteria(cardId: string, acceptanceCriteria: string): Promise<void>;
  };
  mutate(apply: (state: BoardState) => BoardState): void;
  card(cardId: string): Card;
  activity(cardId: string): string;
}

function target(provider: AgentCliProviderId): AgentCliTarget {
  return {
    provider,
    label: AGENT_CLI_LABELS[provider],
    executable: `${provider}-executable`,
    launcher: 'standalone',
  };
}

function fakeBoard(initial: BoardState): FakeBoard {
  let state = cloneBoard(initial);
  const card = (cardId: string): Card => {
    const found = findCard(state, cardId);
    if (!found) {
      throw new Error(`Card ${cardId} not found`);
    }
    return found;
  };
  return {
    store: {
      reload: async () => cloneBoard(state),
      appendActivity: async (cardId, entry) => {
        state = appendActivity(state, cardId, entry);
      },
      // Unused by these assertions, but `runCardWithAgentCli` parks a finished
      // implementation card, so the store surface has to be complete.
      moveCard: async () => undefined,
      setAssignee: async (cardId, assignee) => {
        state = setAssignee(state, cardId, assignee);
      },
      setAcceptanceCriteria: async (cardId, acceptanceCriteria) => {
        state = setAcceptanceCriteria(state, cardId, acceptanceCriteria);
      },
    },
    mutate(apply) {
      state = apply(state);
    },
    card,
    activity: (cardId) => card(cardId).activity ?? '',
  };
}

function findCard(state: BoardState, cardId: string): Card | undefined {
  for (const column of state.columns) {
    const found = column.cards.find((candidate) => candidate.id === cardId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function boardWithCard(): { readonly state: BoardState; readonly cardId: string } {
  let state = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Verify', 'Done']);
  state = addCard(state, state.columns[2]!.id, 'Exercise the per-stage model rules');
  const cardId = state.columns[2]!.cards[0]!.id;
  state = setAssignee(state, cardId, { kind: 'ai' });
  state = setDescription(state, cardId, 'Run each stage on its own configured model.');
  state = setAcceptanceCriteria(state, cardId, '- [ ] The dispatch uses the resolved model');
  return { state, cardId };
}

function request(
  provider: AgentCliProviderId,
  cardId: string,
  kind: RunCardWithAgentCliRequest['kind'],
): RunCardWithAgentCliRequest {
  return { provider, kind, card: { id: cardId, title: 'Run the card via CLI' }, prompt: 'prompt' };
}

/**
 * `runCardWithAgentCli` wired to the real shared handoff with only the process
 * spawn and the executable probe stubbed, so the model it dispatches on comes
 * from the same single resolution site the loop uses.
 */
function runDeps(
  board: FakeBoard,
  runProcess: (invocation: AgentCliInvocation) => Promise<AgentCliProcessResult>,
): RunCardWithAgentCliDeps {
  return {
    configuredPaths: {},
    cwd: CWD,
    store: board.store,
    modelCatalog: readAgentCliModelCatalog({ 'claude-code': [WORKSPACE_DEFAULT] }),
    stageModels: readAgentCliStageModels(STAGE_MODELS),
    runWithProgress: (_title, task) => task(new AbortController().signal, () => undefined),
    showInformation: () => undefined,
    showWarning: () => undefined,
    refreshBoard: () => undefined,
    resolveTarget: (provider, configuredPaths, options) =>
      resolveAgentCliTarget(provider, configuredPaths, {
        ...options,
        platform: 'win32',
        env: { PATH: 'C:\\Tools' },
        canExecute: async (candidate) => candidate.toLowerCase().endsWith('claude.exe'),
        probeGhCopilot: async () => ({ supported: true }),
      }),
    runHandoff: (handoff: AgentCliCardHandoff): Promise<AgentCliCardHandoffResult> =>
      runAgentCliCardHandoff(handoff, { now: () => NOW, runProcess }),
  };
}

function cleanExit(): AgentCliProcessResult {
  return { started: true, cancelled: false, exitCode: 0, signal: null, stdout: 'done', stderr: '' };
}

function failedProcess(message: string): AgentCliProcessResult {
  return { started: true, cancelled: false, exitCode: 1, signal: null, stdout: '', stderr: message };
}
