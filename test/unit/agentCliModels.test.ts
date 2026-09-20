import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  AGENT_CLI_LABELS,
  resolveAgentCliModelSelection,
  runAgentCliCardHandoff,
  type AgentCliHandoffKind,
  type AgentCliInvocation,
  type AgentCliProcessResult,
  type AgentCliProviderId,
  type AgentCliResolution,
  type AgentCliTarget,
} from '../../src/agentCliHandoff';
import {
  EMPTY_AGENT_CLI_MODEL_CATALOG,
  agentCliModelsFor,
  defaultAgentCliModel,
  readAgentCliModelCatalog,
  resolveAgentCliModel,
} from '../../src/agentCliModels';
import {
  createAgentCliFallbackRunner,
  type AgentCliFallbackDeps,
  type AgentCliSwitchRecord,
} from '../../src/agentCliFallback';
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

const NOW = new Date('2026-09-19T09:30:00.000Z');
const CARD_MODEL = 'claude-opus-5';
const CODEX_DEFAULT = 'gpt-5-codex';
const CLAUDE_DEFAULT = 'claude-sonnet-5';
const CWD = 'E:/workspace';

suite('agent CLI model catalog: settings validation', () => {
  test('keeps the configured order per provider, with the first entry as the default', () => {
    const catalog = readAgentCliModelCatalog({
      codex: [CODEX_DEFAULT, 'gpt-5', 'o4-mini'],
      'claude-code': [CLAUDE_DEFAULT],
    });

    assert.deepEqual(agentCliModelsFor(catalog, 'codex'), [CODEX_DEFAULT, 'gpt-5', 'o4-mini']);
    assert.equal(defaultAgentCliModel(catalog, 'codex'), CODEX_DEFAULT);
    assert.equal(defaultAgentCliModel(catalog, 'claude-code'), CLAUDE_DEFAULT);
    // A provider with nothing configured stays absent rather than empty.
    assert.equal(defaultAgentCliModel(catalog, 'copilot'), undefined);
    assert.deepEqual(agentCliModelsFor(catalog, 'copilot'), []);
  });

  test('ignores unknown provider keys without touching the known ones', () => {
    const catalog = readAgentCliModelCatalog({
      codex: [CODEX_DEFAULT],
      'claude-code-cli': ['claude-opus-5'],
      gemini: ['gemini-3-pro'],
      '': ['nameless'],
    });

    assert.deepEqual(Object.keys(catalog), ['codex']);
    assert.equal(defaultAgentCliModel(catalog, 'codex'), CODEX_DEFAULT);
  });

  test('drops non-array values, non-string entries, blanks, duplicates, and empty lists', () => {
    const catalog = readAgentCliModelCatalog({
      copilot: CODEX_DEFAULT,
      codex: [
        7,
        null,
        { name: 'gpt-5' },
        '   ',
        '',
        CODEX_DEFAULT,
        ' gpt-5 ',
        'gpt-5',
        CODEX_DEFAULT,
      ],
      'claude-code': [],
      cursor: ['  ', ''],
    });

    // A single string is not a list: nothing is taken from it, not even itself.
    assert.equal(defaultAgentCliModel(catalog, 'copilot'), undefined);
    // Non-strings and blanks are skipped; survivors are trimmed and deduplicated.
    assert.deepEqual(agentCliModelsFor(catalog, 'codex'), [CODEX_DEFAULT, 'gpt-5']);
    // An empty list, or a list of only blanks, leaves the provider unconfigured.
    assert.equal('claude-code' in catalog, false);
    assert.equal('cursor' in catalog, false);
  });

  test('treats any non-object setting value as nothing configured, without throwing', () => {
    for (const value of [
      undefined,
      null,
      'claude-opus-5',
      42,
      true,
      [CODEX_DEFAULT],
      [],
      () => CODEX_DEFAULT,
    ]) {
      const catalog = readAgentCliModelCatalog(value);
      assert.deepEqual(Object.keys(catalog), [], `expected no models from ${String(value)}`);
      assert.equal(resolveAgentCliModel('codex', undefined, catalog), undefined);
    }
  });
});

suite('agent CLI model catalog: resolution order', () => {
  const catalog = readAgentCliModelCatalog({
    codex: [CODEX_DEFAULT, 'gpt-5'],
    'claude-code': [CLAUDE_DEFAULT],
  });

  test('the card own model wins over the workspace default', () => {
    assert.deepEqual(resolveAgentCliModel('codex', CARD_MODEL, catalog), {
      model: CARD_MODEL,
      source: 'card',
    });
  });

  test('the card model alone resolves even with nothing configured', () => {
    assert.deepEqual(resolveAgentCliModel('codex', CARD_MODEL), {
      model: CARD_MODEL,
      source: 'card',
    });
    assert.deepEqual(resolveAgentCliModel('codex', CARD_MODEL, EMPTY_AGENT_CLI_MODEL_CATALOG), {
      model: CARD_MODEL,
      source: 'card',
    });
  });

  test('the workspace default applies when the card names no model', () => {
    assert.deepEqual(resolveAgentCliModel('codex', undefined, catalog), {
      model: CODEX_DEFAULT,
      source: 'workspace-default',
    });
    // A card whose model is only whitespace names no model.
    assert.deepEqual(resolveAgentCliModel('codex', '   ', catalog), {
      model: CODEX_DEFAULT,
      source: 'workspace-default',
    });
  });

  test('neither the card nor the workspace naming a model resolves to nothing', () => {
    assert.equal(resolveAgentCliModel('codex', undefined), undefined);
    assert.equal(resolveAgentCliModel('codex', '  ', EMPTY_AGENT_CLI_MODEL_CATALOG), undefined);
  });

  test('a default configured for other providers only is ignored for the active provider', () => {
    // copilot and cursor are unconfigured here: each falls through to its own
    // default model rather than borrowing another provider entry.
    assert.equal(resolveAgentCliModel('copilot', undefined, catalog), undefined);
    assert.equal(resolveAgentCliModel('cursor', undefined, catalog), undefined);
    // And each configured provider still resolves to its own entry.
    assert.equal(resolveAgentCliModel('codex', undefined, catalog)?.model, CODEX_DEFAULT);
    assert.equal(resolveAgentCliModel('claude-code', undefined, catalog)?.model, CLAUDE_DEFAULT);
  });

  test('a blank entry, an empty list, and a non-array value all resolve to nothing', () => {
    assert.equal(
      resolveAgentCliModel('codex', undefined, readAgentCliModelCatalog({ codex: ['   '] })),
      undefined,
    );
    assert.equal(
      resolveAgentCliModel('codex', undefined, readAgentCliModelCatalog({ codex: [] })),
      undefined,
    );
    assert.equal(
      resolveAgentCliModel('codex', undefined, readAgentCliModelCatalog({ codex: CODEX_DEFAULT })),
      undefined,
    );
    // A blank first entry does not shadow the next usable one either.
    assert.equal(
      resolveAgentCliModel('codex', undefined, readAgentCliModelCatalog({ codex: ['', 'gpt-5'] }))
        ?.model,
      'gpt-5',
    );
  });

  test('the workspace default becomes that provider own CLI model argument', () => {
    const selection = resolveAgentCliModelSelection('codex', undefined, { catalog });
    assert.ok(selection);
    assert.equal(selection.applied, true);
    assert.equal(selection.source, 'workspace-default');
    assert.deepEqual(selection.args, ['--model', CODEX_DEFAULT]);

    // Nothing configured and no card model leaves the selection absent, which is
    // what keeps the argv identical to the behavior before this setting existed.
    assert.equal(resolveAgentCliModelSelection('codex', undefined), undefined);
    assert.equal(resolveAgentCliModelSelection('copilot', undefined, { catalog }), undefined);
  });
});

suite('workspace default model: dispatch', () => {
  test('runs all four AI loop stages on the workspace default and records it on the card', async () => {
    const catalog = readAgentCliModelCatalog({ codex: [CODEX_DEFAULT, 'gpt-5'] });
    const kinds: readonly AgentCliHandoffKind[] = [
      'implementation',
      'definition',
      'triage',
      'verification',
    ];

    for (const kind of kinds) {
      const { state, cardId } = boardWithCard();
      const board = fakeBoard(state);
      const invocations: AgentCliInvocation[] = [];

      await runAgentCliCardHandoff(
        {
          kind,
          target: target('codex'),
          cardId,
          prompt: 'handoff prompt',
          cwd: CWD,
          store: board.store,
          signal: new AbortController().signal,
          modelCatalog: catalog,
        },
        {
          now: () => NOW,
          runProcess: async (invocation) => {
            invocations.push(invocation);
            return cleanExit();
          },
        },
      );

      assert.deepEqual(
        invocations[0]?.args,
        ['exec', '--model', CODEX_DEFAULT, '--sandbox', 'workspace-write', '-'],
        `the ${kind} stage did not run on the workspace default`,
      );
      assert.ok(board.activity(cardId).includes(`Workspace default model: ${CODEX_DEFAULT}.`));
      // The default stays a default: nothing is written back into the card.
      assert.equal(cardPreferredModelFor(board.card(cardId), 'codex'), undefined);
    }
  });

  test('a card own model wins over the workspace default and is reported as the card model', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    board.mutate((current) => setPreferredModel(current, cardId, 'codex', CARD_MODEL));
    const invocations: AgentCliInvocation[] = [];

    const result = await runAgentCliCardHandoff(
      {
        kind: 'implementation',
        target: target('codex'),
        cardId,
        prompt: 'handoff prompt',
        cwd: CWD,
        store: board.store,
        signal: new AbortController().signal,
        modelCatalog: readAgentCliModelCatalog({ codex: [CODEX_DEFAULT] }),
      },
      {
        now: () => NOW,
        runProcess: async (invocation) => {
          invocations.push(invocation);
          board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
          return cleanExit();
        },
      },
    );

    assert.equal(result.modelSelection?.requested, CARD_MODEL);
    assert.equal(result.modelSelection?.source, 'card');
    assert.deepEqual(invocations[0]?.args, [
      'exec',
      '--model',
      CARD_MODEL,
      '--sandbox',
      'workspace-write',
      '-',
    ]);
    assert.equal(cardPreferredModelFor(board.card(cardId), 'codex'), CARD_MODEL);
    assert.ok(board.activity(cardId).includes(`Card preferred model: ${CARD_MODEL}.`));
    assert.ok(!board.activity(cardId).includes(CODEX_DEFAULT));
  });

  test('no card model and nothing configured leaves the dispatch exactly as it was', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const invocations: AgentCliInvocation[] = [];

    const result = await runAgentCliCardHandoff(
      {
        kind: 'implementation',
        target: target('codex'),
        cardId,
        prompt: 'handoff prompt',
        cwd: CWD,
        store: board.store,
        signal: new AbortController().signal,
        // A catalog that only covers other providers is the same as no catalog.
        modelCatalog: readAgentCliModelCatalog({ 'claude-code': [CLAUDE_DEFAULT] }),
      },
      {
        now: () => NOW,
        runProcess: async (invocation) => {
          invocations.push(invocation);
          board.mutate((current) => appendActivity(current, cardId, 'STATUS: DONE'));
          return cleanExit();
        },
      },
    );

    assert.equal(result.modelSelection, undefined);
    assert.deepEqual(invocations[0]?.args, ['exec', '--sandbox', 'workspace-write', '-']);
    const activity = board.activity(cardId);
    assert.ok(!activity.includes('Card preferred model'));
    assert.ok(!activity.includes('Workspace default model'));
  });

  test('the credit fallback uses the replacement provider own default and records it', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const invocations: AgentCliInvocation[] = [];
    const switches: AgentCliSwitchRecord[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['claude-code'] },
      configuredPaths: {},
      modelCatalog: readAgentCliModelCatalog({
        codex: [CODEX_DEFAULT],
        'claude-code': [CLAUDE_DEFAULT, 'claude-opus-5'],
      }),
      cwd: CWD,
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      onSwitch: (record) => switches.push(record),
      resolveTarget: resolverFor(['claude-code']),
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

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: () => 'prompt',
    });

    assert.ok(outcome.kind === 'ran' && outcome.result.completed);
    // Each CLI ran on its own configured default, never the other one.
    assert.deepEqual(invocations[0]?.args, [
      'exec',
      '--model',
      CODEX_DEFAULT,
      '--sandbox',
      'workspace-write',
      '-',
    ]);
    assert.deepEqual(invocations[1]?.args, [
      '-p',
      '--permission-mode',
      'bypassPermissions',
      '--output-format',
      'text',
      '--model',
      CLAUDE_DEFAULT,
    ]);

    assert.equal(switches.length, 1);
    assert.deepEqual(switches[0]?.toModel, {
      model: CLAUDE_DEFAULT,
      source: 'workspace-default',
    });

    const activity = board.activity(cardId);
    assert.ok(
      activity.includes(
        `${AGENT_CLI_LABELS['claude-code']} model: "${CLAUDE_DEFAULT}", from the workspace default model.`,
      ),
      'the switch entry must record the model the replacement took over on',
    );
    assert.ok(activity.includes(`Workspace default model: ${CODEX_DEFAULT}.`));
    assert.ok(activity.includes(`Workspace default model: ${CLAUDE_DEFAULT}.`));
  });

  test('a replacement provider with no configured default runs its own default model', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const invocations: AgentCliInvocation[] = [];
    const switches: AgentCliSwitchRecord[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['cursor'] },
      configuredPaths: {},
      modelCatalog: readAgentCliModelCatalog({ codex: [CODEX_DEFAULT] }),
      cwd: CWD,
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
      onSwitch: (record) => switches.push(record),
      resolveTarget: resolverFor(['cursor']),
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
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: () => 'prompt',
    });

    // The exhausted provider default is not carried over to the replacement.
    assert.deepEqual(invocations[1]?.args, ['-p', '--force', '--output-format', 'text']);
    assert.equal(switches[0]?.toModel, undefined);
    assert.ok(
      board.activity(cardId).includes(`${AGENT_CLI_LABELS.cursor} runs on its own default model.`),
    );
  });
});

// --- helpers ---------------------------------------------------------------

interface FakeBoard {
  readonly store: {
    reload(): Promise<BoardState>;
    appendActivity(cardId: string, entry: string): Promise<void>;
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
  state = addCard(state, state.columns[2]!.id, 'Exercise the workspace default model');
  const cardId = state.columns[2]!.cards[0]!.id;
  state = setAssignee(state, cardId, { kind: 'ai' });
  state = setDescription(state, cardId, 'Run this card on the configured default model.');
  state = setAcceptanceCriteria(state, cardId, '- [ ] The dispatch uses the resolved model');
  return { state, cardId };
}

function resolverFor(
  available: readonly AgentCliProviderId[],
): NonNullable<AgentCliFallbackDeps['resolveTarget']> {
  return async (provider): Promise<AgentCliResolution> =>
    available.includes(provider)
      ? { available: true, target: target(provider) }
      : {
          available: false,
          provider,
          attemptedCommand: provider,
          reason: `${AGENT_CLI_LABELS[provider]} is not installed.`,
        };
}

function cleanExit(): AgentCliProcessResult {
  return { started: true, cancelled: false, exitCode: 0, signal: null, stdout: 'done', stderr: '' };
}

function failedProcess(message: string): AgentCliProcessResult {
  return { started: true, cancelled: false, exitCode: 1, signal: null, stdout: '', stderr: message };
}
