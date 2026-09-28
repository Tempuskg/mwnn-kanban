import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  AGENT_CLI_LABELS,
  AGENT_CLI_PROVIDER_IDS,
  AGENT_CLI_THINKING_FLAGS,
  buildAgentCliInvocation,
  formatAgentCliStartEntry,
  resolveAgentCliModelSelection,
  resolveAgentCliThinkingSelection,
  runAgentCliCardHandoff,
  type AgentCliInvocation,
  type AgentCliProcessResult,
  type AgentCliProviderId,
  type AgentCliTarget,
} from '../../src/agentCliHandoff';
import {
  EMPTY_AGENT_CLI_STAGE_THINKING_LEVELS,
  EMPTY_AGENT_CLI_THINKING_LEVELS,
  defaultAgentCliThinkingLevel,
  readAgentCliStageThinkingLevels,
  readAgentCliThinkingLevels,
  resolveAgentCliThinkingLevel,
  stageAgentCliThinkingLevel,
} from '../../src/agentCliModels';
import { parseCard, serializeCard, type CardDocument } from '../../src/serialization';
import {
  isCardThinkingLevels,
  isWebviewToHostMessage,
  type BoardState,
  type Card,
  type CardThinkingLevels,
} from '../../src/types';
import {
  addCard,
  appendActivity,
  cardThinkingLevelFor,
  cloneBoard,
  defaultBoard,
  normalizeCardThinkingLevels,
  normalizeThinkingLevel,
  setAcceptanceCriteria,
  setAssignee,
  setDescription,
  setPreferredModel,
  setThinkingLevel,
} from '../../src/utils';

const NOW = new Date('2026-09-20T11:00:00.000Z');
const LEVEL = 'high';
/** One distinct level per provider, so a leak between CLIs is visible. */
const PER_PROVIDER: Record<AgentCliProviderId, string> = {
  copilot: 'copilot-effort',
  codex: LEVEL,
  'claude-code': 'claude-effort',
  cursor: 'cursor-effort',
};

/**
 * The only provider that currently spells reasoning effort on its command
 * line. Read from the exported spec data rather than hard-coded, so adding a
 * spec for another CLI does not quietly turn these assertions into no-ops.
 */
const SUPPORTED: AgentCliProviderId = 'codex';
const EFFORT_FLAG_PROVIDERS: readonly AgentCliProviderId[] = ['copilot', 'claude-code'];
const UNSUPPORTED = AGENT_CLI_PROVIDER_IDS.filter(
  (provider) => AGENT_CLI_THINKING_FLAGS[provider] === undefined,
);

/** Every provider's fixed argv, as it must stay when nothing is configured. */
const BASELINE_ARGS: Record<AgentCliProviderId, readonly string[]> = {
  copilot: ['--allow-all-tools', '--no-ask-user', '--silent'],
  codex: ['exec', '--sandbox', 'workspace-write', '-'],
  'claude-code': ['-p', '--permission-mode', 'bypassPermissions', '--output-format', 'text'],
  cursor: ['-p', '--force', '--output-format', 'text'],
};

function cardDocument(card: Card): CardDocument {
  return { columnId: 'col-ready', position: 1000, card };
}

/** A card file with the frontmatter lines given, for parser-level cases. */
function cardFileWith(id: string, ...frontmatterLines: readonly string[]): string {
  return [
    '---',
    `id: ${id}`,
    'title: Thinking card',
    'column: col-ready',
    'position: 1000',
    ...frontmatterLines,
    'createdAt: 1',
    '---',
    '',
    '## Description',
    'Still a valid card.',
    '',
    '## Acceptance criteria',
    '',
    '## Activity',
    '',
  ].join('\n');
}

function target(provider: AgentCliProviderId): AgentCliTarget {
  return {
    provider,
    label: AGENT_CLI_LABELS[provider],
    executable: `${provider}-executable`,
    launcher: 'standalone',
  };
}

function cleanExit(): AgentCliProcessResult {
  return { started: true, cancelled: false, exitCode: 0, signal: null, stdout: 'done', stderr: '' };
}

interface FakeBoard {
  readonly store: {
    reload(): Promise<BoardState>;
    appendActivity(cardId: string, entry: string): Promise<void>;
  };
  mutate(apply: (state: BoardState) => BoardState): void;
  activity(cardId: string): string;
}

function fakeBoard(initial: BoardState): FakeBoard {
  let state = cloneBoard(initial);
  const card = (cardId: string): Card => {
    for (const column of state.columns) {
      const found = column.cards.find((candidate) => candidate.id === cardId);
      if (found) {
        return found;
      }
    }
    throw new Error(`Card ${cardId} not found`);
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
    activity: (cardId) => card(cardId).activity ?? '',
  };
}

function boardWithCard(): { readonly state: BoardState; readonly cardId: string } {
  let state = defaultBoard(['Backlog', 'Ready', 'In Progress', 'Verify', 'Done']);
  state = addCard(state, state.columns[2]!.id, 'Exercise the thinking level');
  const cardId = state.columns[2]!.cards[0]!.id;
  state = setAssignee(state, cardId, { kind: 'ai' });
  state = setDescription(state, cardId, 'Run this card at a specific effort.');
  state = setAcceptanceCriteria(state, cardId, '- [ ] The dispatch uses the card thinking level');
  return { state, cardId };
}

suite('card thinking level: serialization', () => {
  test('round-trips every provider level through parse and serialize', () => {
    const levels: CardThinkingLevels = { ...PER_PROVIDER };
    const card: Card = { id: 'card-1', title: 'Thinking card', createdAt: 1, thinkingLevels: levels };

    const reparsed = parseCard(serializeCard(cardDocument(card)));

    assert.deepEqual(reparsed.card.thinkingLevels, levels);
    // And again, so the second write is identical to the first.
    assert.equal(serializeCard(cardDocument(reparsed.card)), serializeCard(cardDocument(card)));
  });

  test('a card with no thinking levels serializes byte-identically to before the feature', () => {
    const card: Card = { id: 'card-1', title: 'Plain card', createdAt: 1 };

    const serialized = serializeCard(cardDocument(card));

    assert.equal(
      serialized,
      [
        '---',
        'id: card-1',
        'title: Plain card',
        'column: col-ready',
        'position: 1000',
        'createdAt: 1',
        '---',
        '',
        '## Description',
        '',
        '## Acceptance criteria',
        '',
        '## Activity',
        '',
      ].join('\n'),
    );
    assert.equal(serialized.includes('thinkingLevel'), false);
  });

  test('writes one key per named provider, in the fixed provider order, beside the models', () => {
    const card: Card = {
      id: 'card-1',
      title: 'Both axes',
      createdAt: 1,
      preferredModels: { codex: 'gpt-5-codex' },
      thinkingLevels: { cursor: 'cursor-effort', codex: LEVEL },
    };

    const lines = serializeCard(cardDocument(card)).split('\n');

    assert.deepEqual(
      lines.filter((line) => line.startsWith('thinkingLevel.')),
      [`thinkingLevel.codex: ${LEVEL}`, 'thinkingLevel.cursor: cursor-effort'],
    );
    // The model axis is untouched by the level axis.
    assert.ok(lines.includes('preferredModel.codex: gpt-5-codex'));
  });

  test('quotes a level that the scalar rule requires quoting, and reads it back unchanged', () => {
    const awkward = 'effort: very high';
    const card: Card = { id: 'card-1', title: 'Quoted', createdAt: 1, thinkingLevels: { codex: awkward } };

    const serialized = serializeCard(cardDocument(card));

    assert.ok(serialized.includes(`thinkingLevel.codex: ${JSON.stringify(awkward)}`));
    assert.equal(parseCard(serialized).card.thinkingLevels?.codex, awkward);
  });

  test('ignores unknown provider keys and blank values without failing the card', () => {
    const text = cardFileWith(
      'card-1',
      'thinkingLevel.codex: "   "',
      'thinkingLevel.gemini: high',
      'thinkingLevel: high',
      `thinkingLevel.cursor: ${PER_PROVIDER.cursor}`,
    );

    const parsed = parseCard(text);

    // Only the one usable scoped key survives; the bare key is just unknown.
    assert.deepEqual(parsed.card.thinkingLevels, { cursor: PER_PROVIDER.cursor });
  });

  test('drops the property entirely when no provider names a usable level', () => {
    const parsed = parseCard(cardFileWith('card-1', 'thinkingLevel.codex: ""'));

    assert.equal(parsed.card.thinkingLevels, undefined);
    assert.equal(serializeCard(parsed).includes('thinkingLevel'), false);
  });
});

suite('card thinking level: board state', () => {
  test('normalizes a map the way the parser and the mutations both need', () => {
    assert.equal(normalizeThinkingLevel('  high  '), 'high');
    assert.equal(normalizeThinkingLevel('   '), undefined);
    assert.equal(normalizeThinkingLevel('bad\tlevel'), undefined);
    assert.deepEqual(
      normalizeCardThinkingLevels({ codex: ' high ', cursor: '  ' } as CardThinkingLevels),
      { codex: 'high' },
    );
    assert.equal(normalizeCardThinkingLevels({}), undefined);
  });

  test('accepts only a non-empty map of known providers with non-blank values', () => {
    assert.equal(isCardThinkingLevels({ codex: LEVEL }), true);
    assert.equal(isCardThinkingLevels({}), false);
    assert.equal(isCardThinkingLevels({ gemini: LEVEL }), false);
    assert.equal(isCardThinkingLevels({ codex: '  ' }), false);
    assert.equal(isCardThinkingLevels([]), false);
    assert.equal(isCardThinkingLevels(null), false);
  });

  test('sets and clears one provider without disturbing the others or the models', () => {
    const { state, cardId } = boardWithCard();
    let next = setPreferredModel(state, cardId, 'codex', 'gpt-5-codex');
    next = setThinkingLevel(next, cardId, 'codex', LEVEL);
    next = setThinkingLevel(next, cardId, 'cursor', PER_PROVIDER.cursor);

    assert.equal(cardThinkingLevelFor(findCard(next, cardId), 'codex'), LEVEL);
    assert.equal(cardThinkingLevelFor(findCard(next, cardId), 'cursor'), PER_PROVIDER.cursor);

    next = setThinkingLevel(next, cardId, 'codex', '   ');

    assert.equal(cardThinkingLevelFor(findCard(next, cardId), 'codex'), undefined);
    assert.equal(cardThinkingLevelFor(findCard(next, cardId), 'cursor'), PER_PROVIDER.cursor);
    // The model axis is untouched by an edit to the level axis.
    assert.equal(findCard(next, cardId).preferredModels?.codex, 'gpt-5-codex');
  });

  test('removes the property when the last provider is cleared', () => {
    const { state, cardId } = boardWithCard();
    let next = setThinkingLevel(state, cardId, 'codex', LEVEL);
    next = setThinkingLevel(next, cardId, 'codex', '');

    assert.equal(findCard(next, cardId).thinkingLevels, undefined);
  });

  test('accepts the setThinkingLevel message and rejects a malformed one', () => {
    assert.equal(
      isWebviewToHostMessage({ type: 'setThinkingLevel', cardId: 'card-1', provider: 'codex', thinkingLevel: LEVEL }),
      true,
    );
    // Omitted level is the documented "clear it" form.
    assert.equal(isWebviewToHostMessage({ type: 'setThinkingLevel', cardId: 'card-1', provider: 'codex' }), true);
    assert.equal(
      isWebviewToHostMessage({ type: 'setThinkingLevel', cardId: 'card-1', provider: 'gemini', thinkingLevel: LEVEL }),
      false,
    );
    assert.equal(isWebviewToHostMessage({ type: 'setThinkingLevel', provider: 'codex' }), false);
  });
});

suite('card thinking level: settings validation', () => {
  test('reads a per-provider workspace default and drops everything unusable', () => {
    const defaults = readAgentCliThinkingLevels({
      codex: ` ${LEVEL} `,
      cursor: '   ',
      copilot: 42,
      gemini: 'high',
    });

    assert.equal(defaultAgentCliThinkingLevel(defaults, 'codex'), LEVEL);
    assert.equal(defaultAgentCliThinkingLevel(defaults, 'cursor'), undefined);
    assert.equal(defaultAgentCliThinkingLevel(defaults, 'copilot'), undefined);
    assert.deepEqual(Object.keys(defaults), ['codex']);
  });

  test('degrades a malformed workspace default to "not configured" without throwing', () => {
    for (const malformed of [undefined, null, 'high', 7, [], [{ codex: 'high' }]]) {
      assert.deepEqual(readAgentCliThinkingLevels(malformed), EMPTY_AGENT_CLI_THINKING_LEVELS);
    }
  });

  test('reads per-stage rules and drops unknown stages and unusable values', () => {
    const rules = readAgentCliStageThinkingLevels({
      definition: ' low ',
      implementation: '',
      verification: null,
      cleanup: 'high',
    });

    assert.equal(stageAgentCliThinkingLevel(rules, 'definition'), 'low');
    assert.equal(stageAgentCliThinkingLevel(rules, 'implementation'), undefined);
    assert.equal(stageAgentCliThinkingLevel(rules, 'verification'), undefined);
    assert.deepEqual(Object.keys(rules), ['definition']);
  });

  test('degrades malformed per-stage rules to "no rules" without throwing', () => {
    for (const malformed of [undefined, null, 'low', 7, []]) {
      assert.deepEqual(
        readAgentCliStageThinkingLevels(malformed),
        EMPTY_AGENT_CLI_STAGE_THINKING_LEVELS,
      );
    }
  });
});

suite('card thinking level: resolution precedence', () => {
  const defaults = readAgentCliThinkingLevels({ codex: 'workspace-effort' });
  const stageRules = readAgentCliStageThinkingLevels({ implementation: 'stage-effort' });
  const stage = { stage: 'implementation', stageThinkingLevels: stageRules } as const;

  test('escalation beats the card, the stage rule, and the workspace default', () => {
    assert.deepEqual(
      resolveAgentCliThinkingLevel('codex', 'card-effort', defaults, stage, 'escalated-effort'),
      { level: 'escalated-effort', source: 'escalation' },
    );
  });

  test('the card beats the stage rule and the workspace default', () => {
    assert.deepEqual(resolveAgentCliThinkingLevel('codex', 'card-effort', defaults, stage), {
      level: 'card-effort',
      source: 'card',
    });
  });

  test('the stage rule beats the workspace default', () => {
    assert.deepEqual(resolveAgentCliThinkingLevel('codex', undefined, defaults, stage), {
      level: 'stage-effort',
      source: 'stage-rule',
    });
  });

  test('the workspace default applies when nothing more specific does', () => {
    assert.deepEqual(resolveAgentCliThinkingLevel('codex', undefined, defaults), {
      level: 'workspace-effort',
      source: 'workspace-default',
    });
  });

  test('a provider with no workspace default of its own resolves to nothing', () => {
    assert.equal(resolveAgentCliThinkingLevel('cursor', undefined, defaults), undefined);
    assert.equal(resolveAgentCliThinkingLevel('codex', undefined), undefined);
  });

  test('a blank value at one layer falls through to the next rather than winning', () => {
    assert.deepEqual(resolveAgentCliThinkingLevel('codex', '   ', defaults, stage, '  '), {
      level: 'stage-effort',
      source: 'stage-rule',
    });
  });
});

suite('card thinking level: argument shaping', () => {
  test('Copilot and Claude Code receive --effort as separate argv entries', () => {
    for (const provider of EFFORT_FLAG_PROVIDERS) {
      assert.equal(AGENT_CLI_THINKING_FLAGS[provider], '--effort');
      const selection = resolveAgentCliThinkingSelection(provider, LEVEL);
      assert.ok(selection);
      assert.equal(selection.applied, true);
      assert.deepEqual(selection.args, ['--effort', LEVEL]);

      const invocation = buildAgentCliInvocation(
        target(provider),
        'prompt',
        'E:\\workspace',
        undefined,
        selection,
      );
      assert.deepEqual(invocation.args, [...BASELINE_ARGS[provider], '--effort', LEVEL]);
    }
  });

  test('gh copilot passthrough keeps --effort after its -- separator', () => {
    const selection = resolveAgentCliThinkingSelection('copilot', LEVEL);
    assert.ok(selection);

    const invocation = buildAgentCliInvocation(
      { ...target('copilot'), launcher: 'gh-copilot' },
      'prompt',
      'E:\\workspace',
      undefined,
      selection,
    );
    const copilotIndex = invocation.args.indexOf('copilot');
    const separatorIndex = invocation.args.indexOf('--');
    const effortIndex = invocation.args.indexOf('--effort');
    assert.ok(copilotIndex >= 0);
    assert.ok(separatorIndex > copilotIndex);
    assert.ok(effortIndex > separatorIndex);
    assert.equal(invocation.args[effortIndex + 1], LEVEL);
  });

  test('spells the level as the supported provider spells it, as separate argv entries', () => {
    const selection = resolveAgentCliThinkingSelection(SUPPORTED, LEVEL);
    assert.ok(selection);

    assert.equal(selection.applied, true);
    assert.equal(selection.source, 'card');
    assert.deepEqual(selection.args, ['-c', `model_reasoning_effort=${LEVEL}`]);

    const invocation = buildAgentCliInvocation(
      target(SUPPORTED),
      'prompt',
      'E:\\workspace',
      undefined,
      selection,
    );
    // Spliced after `exec` and before the trailing `-` that names stdin.
    assert.deepEqual(invocation.args, [
      'exec',
      '-c',
      `model_reasoning_effort=${LEVEL}`,
      '--sandbox',
      'workspace-write',
      '-',
    ]);
  });

  test('places the model before the level when both target the same index', () => {
    const model = resolveAgentCliModelSelection(SUPPORTED, 'gpt-5-codex');
    const thinking = resolveAgentCliThinkingSelection(SUPPORTED, LEVEL);

    const invocation = buildAgentCliInvocation(
      target(SUPPORTED),
      'prompt',
      'E:\\workspace',
      model,
      thinking,
    );

    assert.deepEqual(invocation.args, [
      'exec',
      '--model',
      'gpt-5-codex',
      '-c',
      `model_reasoning_effort=${LEVEL}`,
      '--sandbox',
      'workspace-write',
      '-',
    ]);
  });

  test('passes a level containing spaces and shell metacharacters as one argument', () => {
    const hostile = 'high" & calc.exe | echo $(whoami) `id`';
    const selection = resolveAgentCliThinkingSelection(SUPPORTED, hostile);
    assert.ok(selection);

    const invocation = buildAgentCliInvocation(
      target(SUPPORTED),
      'prompt',
      'E:\\workspace',
      undefined,
      selection,
    );
    const flagIndex = invocation.args.indexOf('-c');
    assert.notEqual(flagIndex, -1);
    assert.equal(invocation.args[flagIndex + 1], `model_reasoning_effort=${hostile}`);
    assert.equal(invocation.args.filter((arg) => arg.includes('calc.exe')).length, 1);
  });

  test('reports applied: false with a user-facing reason on a provider that accepts no level', () => {
    assert.ok(UNSUPPORTED.length > 0, 'expected at least one provider without a thinking spec');
    for (const provider of UNSUPPORTED) {
      const selection = resolveAgentCliThinkingSelection(provider, LEVEL);
      assert.ok(selection, `${provider} should still resolve a level`);

      assert.equal(selection.applied, false);
      assert.deepEqual(selection.args, []);
      assert.ok(selection.reason?.includes(AGENT_CLI_LABELS[provider]));
      assert.ok(selection.reason?.includes(LEVEL));

      // The run still happens, on that CLI's own default effort.
      const invocation = buildAgentCliInvocation(
        target(provider),
        'prompt',
        'E:\\workspace',
        undefined,
        selection,
      );
      assert.deepEqual(invocation.args, BASELINE_ARGS[provider]);
    }
  });

  test('names the stage in the reason for a stage rule the CLI cannot honor', () => {
    const provider = UNSUPPORTED[0]!;
    const selection = resolveAgentCliThinkingSelection(provider, undefined, {
      stage: 'definition',
      stageThinkingLevels: readAgentCliStageThinkingLevels({ definition: 'low' }),
    });

    assert.equal(selection?.source, 'stage-rule');
    assert.ok(selection?.reason?.includes('for the definition stage'));
  });

  test('injectable flags make the unsupported path reachable for any provider', () => {
    const noFlags = Object.fromEntries(
      AGENT_CLI_PROVIDER_IDS.map((provider) => [provider, undefined]),
    ) as Record<AgentCliProviderId, string | undefined>;

    const selection = resolveAgentCliThinkingSelection(SUPPORTED, LEVEL, { flags: noFlags });

    assert.equal(selection?.applied, false);
    assert.deepEqual(selection?.args, []);
  });

  test('with nothing configured anywhere, every provider keeps its exact argv', () => {
    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      const selection = resolveAgentCliThinkingSelection(provider, undefined, {
        stage: 'implementation',
        thinkingLevels: EMPTY_AGENT_CLI_THINKING_LEVELS,
        stageThinkingLevels: EMPTY_AGENT_CLI_STAGE_THINKING_LEVELS,
      });

      assert.equal(selection, undefined);
      const invocation = buildAgentCliInvocation(
        target(provider),
        'prompt',
        'E:\\workspace',
        undefined,
        selection,
      );
      assert.deepEqual(invocation.args, BASELINE_ARGS[provider]);
      assert.equal(invocation.thinkingSelection, undefined);
    }
  });
});

suite('card thinking level: dispatch', () => {
  test('reads the level from current card state at dispatch and records it on the card', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const invocations: AgentCliInvocation[] = [];

    // Set after the board was built, the way a mid-run card edit would.
    board.mutate((current) => setThinkingLevel(current, cardId, SUPPORTED, LEVEL));

    const result = await runAgentCliCardHandoff(
      {
        kind: 'implementation',
        target: target(SUPPORTED),
        cardId,
        prompt: 'handoff prompt',
        cwd: 'E:\\workspace',
        store: board.store,
        signal: new AbortController().signal,
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

    assert.equal(result.completed, true);
    assert.equal(result.thinkingSelection?.applied, true);
    assert.equal(result.thinkingSelection?.requested, LEVEL);
    assert.deepEqual(invocations[0]?.args, [
      'exec',
      '-c',
      `model_reasoning_effort=${LEVEL}`,
      '--sandbox',
      'workspace-write',
      '-',
    ]);
    assert.ok(board.activity(cardId).includes(`Card thinking level: ${LEVEL}.`));
  });

  test('a provider with no level support still dispatches, and says why the level was skipped', async () => {
    const provider = UNSUPPORTED[0]!;
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const invocations: AgentCliInvocation[] = [];

    board.mutate((current) => setThinkingLevel(current, cardId, provider, LEVEL));

    const result = await runAgentCliCardHandoff(
      {
        kind: 'implementation',
        target: target(provider),
        cardId,
        prompt: 'handoff prompt',
        cwd: 'E:\\workspace',
        store: board.store,
        signal: new AbortController().signal,
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

    // The run is unaffected: it happened, it completed, and argv is untouched.
    assert.equal(result.completed, true);
    assert.equal(result.failure, undefined);
    assert.equal(result.thinkingSelection?.applied, false);
    assert.deepEqual(invocations[0]?.args, BASELINE_ARGS[provider]);
    assert.ok(board.activity(cardId).includes('was not applied'));
    assert.ok(board.activity(cardId).includes(AGENT_CLI_LABELS[provider]));
  });

  test('dispatching on a provider the card names no level for adds no argument', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const invocations: AgentCliInvocation[] = [];

    // The card names a level for Codex only; this dispatch runs Claude Code.
    board.mutate((current) => setThinkingLevel(current, cardId, 'codex', PER_PROVIDER.codex));

    const result = await runAgentCliCardHandoff(
      {
        kind: 'implementation',
        target: target('claude-code'),
        cardId,
        prompt: 'handoff prompt',
        cwd: 'E:\\workspace',
        store: board.store,
        signal: new AbortController().signal,
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

    assert.equal(result.completed, true);
    assert.equal(result.thinkingSelection, undefined);
    assert.deepEqual(invocations[0]?.args, BASELINE_ARGS['claude-code']);
  });

  test('applies the stage rule for the stage actually being dispatched', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const invocations: AgentCliInvocation[] = [];

    const result = await runAgentCliCardHandoff(
      {
        kind: 'definition',
        target: target(SUPPORTED),
        cardId,
        prompt: 'handoff prompt',
        cwd: 'E:\\workspace',
        store: board.store,
        signal: new AbortController().signal,
        stageThinkingLevels: readAgentCliStageThinkingLevels({
          definition: 'low',
          implementation: LEVEL,
        }),
        thinkingLevels: readAgentCliThinkingLevels({ codex: 'workspace-effort' }),
      },
      {
        now: () => NOW,
        runProcess: async (invocation) => {
          invocations.push(invocation);
          board.mutate((current) =>
            setDescription(current, cardId, 'Filled in by the definition stage.'),
          );
          board.mutate((current) =>
            setAcceptanceCriteria(current, cardId, '- [ ] Something verifiable'),
          );
          return cleanExit();
        },
      },
    );

    assert.equal(result.completed, true);
    assert.equal(result.thinkingSelection?.source, 'stage-rule');
    assert.deepEqual(invocations[0]?.args, [
      'exec',
      '-c',
      'model_reasoning_effort=low',
      '--sandbox',
      'workspace-write',
      '-',
    ]);
  });

  test('records both axes in the start entry when both resolve', () => {
    const entry = formatAgentCliStartEntry(
      AGENT_CLI_LABELS[SUPPORTED],
      'implementation',
      NOW,
      resolveAgentCliModelSelection(SUPPORTED, 'gpt-5-codex'),
      resolveAgentCliThinkingSelection(SUPPORTED, LEVEL),
    );

    assert.ok(entry.includes('Card preferred model: gpt-5-codex.'));
    assert.ok(entry.includes(`Card thinking level: ${LEVEL}.`));
  });
});

function findCard(state: BoardState, cardId: string): Card {
  for (const column of state.columns) {
    const found = column.cards.find((candidate) => candidate.id === cardId);
    if (found) {
      return found;
    }
  }
  throw new Error(`Card ${cardId} not found`);
}
