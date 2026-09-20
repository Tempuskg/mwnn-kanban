import * as assert from 'node:assert/strict';
import * as path from 'node:path/posix';
import { suite, test } from 'node:test';
import {
  AGENT_CLI_LABELS,
  AGENT_CLI_MODEL_FLAGS,
  AGENT_CLI_PROVIDER_IDS,
  buildAgentCliInvocation,
  detectModelRejection,
  formatAgentCliStartEntry,
  prepareAgentCliInvocation,
  resolveAgentCliModelSelection,
  runAgentCliCardHandoff,
  type AgentCliInvocation,
  type AgentCliProcessResult,
  type AgentCliProviderId,
  type AgentCliResolution,
  type AgentCliTarget,
} from '../../src/agentCliHandoff';
import {
  createAgentCliFallbackRunner,
  type AgentCliFallbackDeps,
  type AgentCliSwitchRecord,
} from '../../src/agentCliFallback';
import { withPreferredModelNote, buildCardHandoffPrompt } from '../../src/aiCards';
import { createBoardStore, type BoardStoreDeps, type FileSystemLike } from '../../src/boardStore';
import { parseCard, serializeCard, type CardDocument } from '../../src/serialization';
import {
  isBoardState,
  isCardPreferredModels,
  isWebviewToHostMessage,
  type BoardState,
  type Card,
  type CardPreferredModels,
} from '../../src/types';
import {
  addCard,
  appendActivity,
  cardPreferredModelFor,
  cloneBoard,
  defaultBoard,
  normalizeCardPreferredModels,
  normalizePreferredModel,
  setAcceptanceCriteria,
  setAssignee,
  setDescription,
  setPreferredModel,
} from '../../src/utils';

const NOW = new Date('2026-09-19T09:30:00.000Z');
const MODEL = 'claude-opus-5';
/** One distinct name per provider, so a leak between CLIs is visible. */
const PER_PROVIDER: Record<AgentCliProviderId, string> = {
  copilot: 'gpt-5-copilot',
  codex: 'gpt-5-codex',
  'claude-code': MODEL,
  cursor: 'cursor-fast',
};

/** A card file with the frontmatter lines given, for parser-level cases. */
function cardFileWith(id: string, ...frontmatterLines: readonly string[]): string {
  return [
    '---',
    `id: ${id}`,
    'title: Model card',
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

function cardDocument(card: Card): CardDocument {
  return { columnId: 'col-ready', position: 1000, card };
}

function target(provider: AgentCliProviderId): AgentCliTarget {
  return {
    provider,
    label: AGENT_CLI_LABELS[provider],
    executable: `${provider}-executable`,
    launcher: 'standalone',
  };
}

suite('card preferred model: card file contract', () => {
  test('round-trips one, several, and all providers through serialize and parse', () => {
    const maps: readonly CardPreferredModels[] = [
      { codex: PER_PROVIDER.codex },
      { codex: PER_PROVIDER.codex, cursor: PER_PROVIDER.cursor },
      { ...PER_PROVIDER },
    ];

    for (const preferredModels of maps) {
      const document = cardDocument({
        id: 'card-model',
        title: 'Run me on the right model per CLI',
        createdAt: 1719360000000,
        updatedAt: 1719363600000,
        assignee: { kind: 'ai' },
        preferredModels,
        description: 'Work that deserves a named model.',
        acceptanceCriteria: '- [ ] Done well',
      });

      const text = serializeCard(document);
      for (const [provider, model] of Object.entries(preferredModels)) {
        assert.ok(
          text.includes(`preferredModel.${provider}: ${model}`),
          `missing scoped key for ${provider}`,
        );
      }
      // The pre-scoping bare key is never written again.
      assert.ok(!/^preferredModel: /m.test(text));
      assert.deepEqual(parseCard(text), document);
      // Re-serializing the parsed card is byte-stable.
      assert.equal(serializeCard(parseCard(text)), text);
    }
  });

  test('JSON-quotes a model name that needs quoting and reads it back verbatim', () => {
    const quoted = 'openai/gpt-5: preview';
    const text = serializeCard(cardDocument({
      id: 'card-quoted',
      title: 'Quoted model',
      createdAt: 1,
      preferredModels: { codex: quoted, cursor: 'plain-model' },
    }));

    assert.ok(text.includes('preferredModel.codex: "openai/gpt-5: preview"'));
    // Only the value that needs it is quoted; the key never is.
    assert.ok(text.includes('preferredModel.cursor: plain-model'));
    assert.equal(parseCard(text).card.preferredModels?.codex, quoted);
  });

  test('omits the key entirely for a card with no preferred model', () => {
    const document = cardDocument({ id: 'card-plain', title: 'Plain', createdAt: 1 });
    const text = serializeCard(document);

    assert.ok(!text.includes('preferredModel'));
    const parsed = parseCard(text);
    assert.equal('preferredModels' in parsed.card, false);
    assert.deepEqual(parsed, document);
  });

  test('writes no key for an empty or all-blank map', () => {
    for (const preferredModels of [{}, { codex: '', cursor: '   ' }] as CardPreferredModels[]) {
      const text = serializeCard(cardDocument({
        id: 'card-empty-map',
        title: 'Empty map',
        createdAt: 1,
        preferredModels,
      }));

      assert.ok(!text.includes('preferredModel'), 'an unusable map must write no key');
      assert.equal('preferredModels' in parseCard(text).card, false);
    }
  });

  test('treats a blank, whitespace-only, or unusable scoped value as absent without skipping the card', () => {
    for (const value of ['', '   ', '""', 'a\tb']) {
      const text = cardFileWith(
        'card-blank',
        `preferredModel.codex: ${value}`,
        `preferredModel.cursor: ${PER_PROVIDER.cursor}`,
      );

      const parsed = parseCard(text);
      assert.equal(parsed.card.id, 'card-blank', `card with codex model "${value}" was not parsed`);
      assert.equal(
        parsed.card.preferredModels?.codex,
        undefined,
        `codex model "${value}" should have been dropped, not stored`,
      );
      // The usable sibling entry is untouched.
      assert.equal(parsed.card.preferredModels?.cursor, PER_PROVIDER.cursor);
    }
  });

  test('ignores an unknown provider key rather than storing it', () => {
    const parsed = parseCard(
      cardFileWith(
        'card-unknown-provider',
        'preferredModel.gemini: gemini-9',
        `preferredModel.codex: ${PER_PROVIDER.codex}`,
      ),
    );

    assert.deepEqual(parsed.card.preferredModels, { codex: PER_PROVIDER.codex });
    assert.ok(!serializeCard(parsed).includes('gemini'));
  });

  test('the legacy bare scalar applies to every provider it does not scope, and migrates on write', () => {
    const legacy = parseCard(cardFileWith('card-legacy', `preferredModel: ${MODEL}`));

    // Rule: the pre-scoping value is the card's model for every CLI, so an
    // existing card dispatches exactly as it did before scoping.
    assert.deepEqual(legacy.card.preferredModels, {
      copilot: MODEL,
      codex: MODEL,
      'claude-code': MODEL,
      cursor: MODEL,
    });

    // A scoped key wins over the legacy scalar for its own provider only.
    const mixed = parseCard(
      cardFileWith(
        'card-mixed',
        `preferredModel: ${MODEL}`,
        `preferredModel.codex: ${PER_PROVIDER.codex}`,
      ),
    );
    assert.equal(mixed.card.preferredModels?.codex, PER_PROVIDER.codex);
    assert.equal(mixed.card.preferredModels?.cursor, MODEL);

    // Migration on write: the next save emits the scoped keys and drops the
    // bare one, and the migrated file parses back to the same card.
    const migrated = serializeCard(legacy);
    assert.ok(!/^preferredModel: /m.test(migrated));
    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      assert.ok(migrated.includes(`preferredModel.${provider}: ${MODEL}`));
    }
    assert.deepEqual(parseCard(migrated), legacy);
  });

  test('a blank legacy scalar is absent rather than applied to every provider', () => {
    const parsed = parseCard(cardFileWith('card-legacy-blank', 'preferredModel:    '));
    assert.equal('preferredModels' in parsed.card, false);
  });

  test('normalizes the free-form value without validating it against a model list', () => {
    assert.equal(normalizePreferredModel('  gpt-5-codex  '), 'gpt-5-codex');
    assert.equal(normalizePreferredModel('anything-at-all/v9'), 'anything-at-all/v9');
    assert.equal(normalizePreferredModel(''), undefined);
    assert.equal(normalizePreferredModel('   '), undefined);
    assert.equal(normalizePreferredModel(undefined), undefined);
    assert.equal(normalizePreferredModel('two\nlines'), undefined);

    assert.deepEqual(normalizeCardPreferredModels({ codex: '  gpt-5-codex  ' }), {
      codex: 'gpt-5-codex',
    });
    assert.equal(normalizeCardPreferredModels({ codex: '   ' }), undefined);
    assert.equal(normalizeCardPreferredModels({}), undefined);
    assert.equal(normalizeCardPreferredModels(undefined), undefined);
    assert.deepEqual(
      normalizeCardPreferredModels({ gemini: 'x', codex: 'y' } as CardPreferredModels),
      { codex: 'y' },
    );
  });
});

suite('card preferred model: board model and protocol', () => {
  test('the card type guard accepts a per-provider map and rejects unknown keys and blank values', () => {
    const board = (card: Record<string, unknown>): unknown => ({
      version: 2,
      columns: [{ id: 'col-1', title: 'Ready', cards: [card] }],
    });
    const base = { id: 'card-1', title: 'Task', createdAt: 1 };

    assert.equal(isBoardState(board(base)), true);
    assert.equal(isBoardState(board({ ...base, preferredModels: { codex: MODEL } })), true);
    assert.equal(isBoardState(board({ ...base, preferredModels: { ...PER_PROVIDER } })), true);
    assert.equal(isBoardState(board({ ...base, preferredModels: undefined })), true);

    // Nothing unusable is ever stored in board state.
    assert.equal(isBoardState(board({ ...base, preferredModels: {} })), false);
    assert.equal(isBoardState(board({ ...base, preferredModels: { gemini: MODEL } })), false);
    assert.equal(isBoardState(board({ ...base, preferredModels: { codex: '  ' } })), false);
    assert.equal(isBoardState(board({ ...base, preferredModels: { codex: 7 } })), false);
    assert.equal(isBoardState(board({ ...base, preferredModels: MODEL })), false);
    assert.equal(isBoardState(board({ ...base, preferredModels: null })), false);

    assert.equal(isCardPreferredModels({ cursor: 'cursor-fast' }), true);
    assert.equal(isCardPreferredModels([]), false);
  });

  test('the webview protocol scopes setting and clearing to one provider, and rejects malformed ones', () => {
    assert.equal(
      isWebviewToHostMessage({
        type: 'setPreferredModel',
        cardId: 'card-1',
        provider: 'codex',
        preferredModel: MODEL,
      }),
      true,
    );
    // Clearing one provider's model.
    assert.equal(
      isWebviewToHostMessage({ type: 'setPreferredModel', cardId: 'card-1', provider: 'cursor' }),
      true,
    );
    assert.equal(
      isWebviewToHostMessage({
        type: 'setPreferredModel',
        cardId: 'card-1',
        provider: 'cursor',
        preferredModel: undefined,
      }),
      true,
    );
    assert.equal(
      isWebviewToHostMessage({
        type: 'setPreferredModel',
        cardId: 'card-1',
        provider: 'codex',
        preferredModel: 42,
      }),
      false,
    );
    // A message with no provider can no longer say which CLI it meant.
    assert.equal(
      isWebviewToHostMessage({ type: 'setPreferredModel', cardId: 'card-1', preferredModel: MODEL }),
      false,
    );
    assert.equal(
      isWebviewToHostMessage({
        type: 'setPreferredModel',
        cardId: 'card-1',
        provider: 'gemini',
        preferredModel: MODEL,
      }),
      false,
    );
    assert.equal(
      isWebviewToHostMessage({ type: 'setPreferredModel', provider: 'codex', preferredModel: MODEL }),
      false,
    );
  });

  test('setting and clearing one provider leaves the others alone and drops an emptied map', () => {
    let state = defaultBoard(['Backlog', 'Ready', 'Done']);
    state = addCard(state, state.columns[1]!.id, 'Task');
    const cardId = state.columns[1]!.cards[0]!.id;
    const card = (): Card => state.columns[1]!.cards[0]!;

    state = setPreferredModel(state, cardId, 'codex', `  ${PER_PROVIDER.codex}  `);
    state = setPreferredModel(state, cardId, 'cursor', PER_PROVIDER.cursor);
    assert.deepEqual(card().preferredModels, {
      codex: PER_PROVIDER.codex,
      cursor: PER_PROVIDER.cursor,
    });

    // Clearing one provider keeps the other.
    state = setPreferredModel(state, cardId, 'codex', '   ');
    assert.deepEqual(card().preferredModels, { cursor: PER_PROVIDER.cursor });

    // Clearing the last one removes the property entirely.
    state = setPreferredModel(state, cardId, 'cursor', undefined);
    assert.equal('preferredModels' in card(), false);
  });

  test('the card is read per provider, so an unnamed CLI resolves nothing', () => {
    const card: Card = {
      id: 'card-1',
      title: 'Task',
      createdAt: 1,
      preferredModels: { codex: PER_PROVIDER.codex },
    };

    assert.equal(cardPreferredModelFor(card, 'codex'), PER_PROVIDER.codex);
    assert.equal(cardPreferredModelFor(card, 'copilot'), undefined);
    assert.equal(cardPreferredModelFor({}, 'codex'), undefined);
  });
});

suite('card preferred model: board store round trip', () => {
  test('persists, reloads, and clears the model, and never writes an empty key', async () => {
    const fileSystem = createFakeFileSystem();
    const deps: BoardStoreDeps = {
      fileSystem,
      boardFolder: '.mwnn',
      defaultColumns: ['Backlog', 'Ready', 'Done'],
      defaultReadyReverseWip: 3,
    };
    const store = await createBoardStore(deps);
    const readyId = store.getState().columns[1]!.id;
    await store.addCard(readyId, 'Task');
    const cardId = store.getState().columns[1]!.cards[0]!.id;

    // A card saved without a model gains no key at all.
    assert.ok(!cardFileFor(fileSystem, cardId).includes('preferredModel'));

    await store.setPreferredModel(cardId, 'codex', PER_PROVIDER.codex);
    await store.setPreferredModel(cardId, 'claude-code', PER_PROVIDER['claude-code']);
    const written = cardFileFor(fileSystem, cardId);
    assert.ok(written.includes(`preferredModel.codex: ${PER_PROVIDER.codex}`));
    assert.ok(written.includes(`preferredModel.claude-code: ${PER_PROVIDER['claude-code']}`));

    // Re-read from the files a separate store would see.
    const reader = await createBoardStore(deps);
    assert.deepEqual(findCard(reader.getState(), cardId)?.preferredModels, {
      codex: PER_PROVIDER.codex,
      'claude-code': PER_PROVIDER['claude-code'],
    });

    // Clearing one provider rewrites only that key.
    await store.setPreferredModel(cardId, 'codex', '');
    assert.ok(!cardFileFor(fileSystem, cardId).includes('preferredModel.codex'));
    assert.ok(cardFileFor(fileSystem, cardId).includes('preferredModel.claude-code'));

    await store.setPreferredModel(cardId, 'claude-code', undefined);
    assert.ok(!cardFileFor(fileSystem, cardId).includes('preferredModel'));
    assert.equal('preferredModels' in (findCard(store.getState(), cardId) ?? {}), false);
  });
});

suite('card preferred model: provider argument mapping', () => {
  test('maps the card model onto each provider own model argument', () => {
    const expected: Record<AgentCliProviderId, readonly string[]> = {
      copilot: ['--allow-all-tools', '--no-ask-user', '--silent', '--model', MODEL],
      // Inserted after `exec` so the trailing `-` still names stdin.
      codex: ['exec', '--model', MODEL, '--sandbox', 'workspace-write', '-'],
      'claude-code': [
        '-p',
        '--permission-mode',
        'bypassPermissions',
        '--output-format',
        'text',
        '--model',
        MODEL,
      ],
      cursor: ['-p', '--force', '--output-format', 'text', '--model', MODEL],
    };

    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      const selection = resolveAgentCliModelSelection(provider, MODEL);
      assert.ok(selection, `${provider} should resolve a selection`);
      assert.equal(selection.applied, true);
      const invocation = buildAgentCliInvocation(target(provider), 'prompt body', 'E:\\workspace', selection);
      assert.deepEqual(invocation.args, expected[provider], `${provider} model argv`);
      // The prompt still travels over stdin, never on argv.
      assert.equal(invocation.stdin, 'prompt body');
      assert.ok(!invocation.args.includes('prompt body'));
    }
  });

  test('adds no argument at all when the card names no model', () => {
    const unset: Record<AgentCliProviderId, readonly string[]> = {
      copilot: ['--allow-all-tools', '--no-ask-user', '--silent'],
      codex: ['exec', '--sandbox', 'workspace-write', '-'],
      'claude-code': ['-p', '--permission-mode', 'bypassPermissions', '--output-format', 'text'],
      cursor: ['-p', '--force', '--output-format', 'text'],
    };

    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      for (const value of [undefined, '', '   ']) {
        assert.equal(
          resolveAgentCliModelSelection(provider, value),
          undefined,
          `${provider} should resolve nothing for ${JSON.stringify(value)}`,
        );
      }
      const invocation = buildAgentCliInvocation(target(provider), 'prompt', 'E:\\workspace');
      assert.deepEqual(invocation.args, unset[provider], `${provider} unset argv`);
      assert.equal(invocation.modelSelection, undefined);
    }
  });

  test('each provider gets its own entry, and a provider the card skips gets no argument', () => {
    const card: Card = {
      id: 'card-scoped',
      title: 'Scoped models',
      createdAt: 1,
      // Deliberately silent about cursor.
      preferredModels: {
        copilot: PER_PROVIDER.copilot,
        codex: PER_PROVIDER.codex,
        'claude-code': PER_PROVIDER['claude-code'],
      },
    };

    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      const selection = resolveAgentCliModelSelection(
        provider,
        cardPreferredModelFor(card, provider),
      );
      const invocation = buildAgentCliInvocation(target(provider), 'prompt', 'E:\\workspace', selection);

      if (provider === 'cursor') {
        assert.equal(selection, undefined, 'cursor names no model on this card');
        assert.ok(!invocation.args.includes('--model'));
        continue;
      }

      assert.ok(selection, `${provider} should resolve its own entry`);
      assert.equal(selection.source, 'card');
      assert.equal(selection.requested, card.preferredModels?.[provider]);
      const flagIndex = invocation.args.indexOf('--model');
      assert.equal(invocation.args[flagIndex + 1], card.preferredModels?.[provider]);
      // No other provider's name leaks onto this command line.
      for (const other of AGENT_CLI_PROVIDER_IDS) {
        if (other !== provider && card.preferredModels?.[other] !== undefined) {
          assert.ok(
            !invocation.args.includes(card.preferredModels[other]),
            `${provider} argv must not carry the ${other} model`,
          );
        }
      }
    }
  });

  test('keeps the gh copilot passthrough and the Cursor prompt-file launch valid with a model', async () => {
    const selection = resolveAgentCliModelSelection('copilot', MODEL);
    assert.ok(selection);
    const gh = buildAgentCliInvocation(
      { ...target('copilot'), executable: 'gh.exe', launcher: 'gh-copilot' },
      'prompt',
      'E:\\workspace',
      selection,
    );
    assert.deepEqual(gh.args, [
      'copilot',
      '--',
      '--allow-all-tools',
      '--no-ask-user',
      '--silent',
      '--model',
      MODEL,
    ]);

    const cursorSelection = resolveAgentCliModelSelection('cursor', MODEL);
    assert.ok(cursorSelection);
    const prepared = await prepareAgentCliInvocation(
      { ...target('cursor'), executable: 'C:\\npm\\cursor-agent.cmd' },
      'multi\nline prompt',
      'E:\\workspace',
      { platform: 'win32', modelSelection: cursorSelection },
    );
    try {
      const args = prepared.invocation.args;
      // The model flag stays with the other options; the prompt pointer is the
      // positional argument and must remain last.
      assert.deepEqual(args.slice(0, 6), [
        '-p',
        '--force',
        '--output-format',
        'text',
        '--model',
        MODEL,
      ]);
      assert.equal(args.length, 7);
      assert.ok(args[6]?.includes('Read the UTF-8 file at'));
    } finally {
      await prepared.cleanup?.();
    }
  });

  test('runs on the provider default, with a stated reason, when the provider takes no model selection', () => {
    const selection = resolveAgentCliModelSelection('cursor', MODEL, {
      flags: { ...AGENT_CLI_MODEL_FLAGS, cursor: undefined },
    });

    assert.ok(selection);
    assert.equal(selection.applied, false);
    assert.deepEqual(selection.args, []);
    assert.equal(selection.requested, MODEL);
    assert.ok(selection.reason?.includes(AGENT_CLI_LABELS.cursor));
    assert.ok(selection.reason?.includes(MODEL));

    // Nothing is added to argv, so the run still uses the CLI's own default.
    assert.deepEqual(
      buildAgentCliInvocation(target('cursor'), 'prompt', 'E:\\workspace', selection).args,
      ['-p', '--force', '--output-format', 'text'],
    );
    // Every provider shipped today does accept a model.
    for (const provider of AGENT_CLI_PROVIDER_IDS) {
      assert.equal(AGENT_CLI_MODEL_FLAGS[provider], '--model');
    }
  });

  test('passes a model containing spaces, quotes, and shell metacharacters as one argument', () => {
    const hostile = 'my model" & calc.exe | echo $(whoami) `id` %PATH%';
    const selection = resolveAgentCliModelSelection('claude-code', hostile);
    assert.ok(selection);

    const invocation = buildAgentCliInvocation(target('claude-code'), 'prompt', 'E:\\workspace', selection);
    const flagIndex = invocation.args.indexOf('--model');
    assert.notEqual(flagIndex, -1);
    // Exactly one argv entry holds the whole value, and nothing was split off it.
    assert.equal(invocation.args[flagIndex + 1], hostile);
    assert.equal(invocation.args.length, 7);
    assert.equal(invocation.args.filter((arg) => arg.includes('calc.exe')).length, 1);
  });
});

suite('card preferred model: dispatch', () => {
  test('reads the model from current card state at dispatch and records it on the card', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const invocations: AgentCliInvocation[] = [];

    // Set after the board was built, the way a mid-run card edit would.
    board.mutate((current) => setPreferredModel(current, cardId, 'codex', MODEL));

    const result = await runAgentCliCardHandoff(
      {
        kind: 'implementation',
        target: target('codex'),
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
    assert.equal(result.modelSelection?.applied, true);
    assert.equal(result.modelSelection?.requested, MODEL);
    assert.deepEqual(invocations[0]?.args, ['exec', '--model', MODEL, '--sandbox', 'workspace-write', '-']);
    assert.ok(board.activity(cardId).includes(`Card preferred model: ${MODEL}.`));
  });

  test('dispatching on a provider the card does not name adds no model argument', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const invocations: AgentCliInvocation[] = [];

    // The card names a model for Codex only; this dispatch runs Claude Code.
    board.mutate((current) => setPreferredModel(current, cardId, 'codex', PER_PROVIDER.codex));

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
    assert.equal(result.modelSelection, undefined);
    assert.deepEqual(invocations[0]?.args, [
      '-p',
      '--permission-mode',
      'bypassPermissions',
      '--output-format',
      'text',
    ]);
    assert.ok(!board.activity(cardId).includes(PER_PROVIDER.codex));
  });

  test('records why an unapplied model was skipped without failing the dispatch', () => {
    const entry = formatAgentCliStartEntry(AGENT_CLI_LABELS.cursor, 'verification', NOW, {
      requested: MODEL,
      source: 'card',
      applied: false,
      args: [],
      reason: 'Cursor Agent CLI does not accept a model selection.',
    });

    assert.ok(entry.includes(`Card preferred model "${MODEL}" was not applied`));
    assert.ok(entry.includes('does not accept a model selection'));
  });

  test('a rejected model fails the dispatch, names the value and provider, and is not credit exhaustion', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    board.mutate((current) => setPreferredModel(current, cardId, 'claude-code', 'gpt-nonexistent'));

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
        runProcess: async () => failedProcess('Error: unknown model "gpt-nonexistent".'),
      },
    );

    assert.equal(result.completed, false);
    assert.equal(result.cancelled, false);
    assert.equal(result.creditExhaustion, undefined, 'a refused model is not a spent allowance');
    assert.ok(result.reason?.includes('gpt-nonexistent'));
    assert.ok(result.reason?.includes(AGENT_CLI_LABELS['claude-code']));
    // The card was not advanced: no terminal status was accepted.
    assert.equal(result.terminalStatus, undefined);
  });

  test('classifies model rejections only for runs that actually passed a model', () => {
    const selection = resolveAgentCliModelSelection('codex', MODEL);
    assert.ok(selection);

    for (const message of [
      'Error: unknown model gpt-nope',
      'invalid model requested',
      'model "x" is not supported by this account',
      'model_not_found',
      'No such model available.',
    ]) {
      assert.ok(
        detectModelRejection(failedProcess(message), selection),
        `expected a rejection for: ${message}`,
      );
    }

    assert.equal(
      detectModelRejection(failedProcess('Error: unknown model gpt-nope'), undefined),
      undefined,
      'a card without a model cannot have its model rejected',
    );
    assert.equal(
      detectModelRejection(failedProcess('HTTP 401 Unauthorized'), selection),
      undefined,
    );
    assert.equal(detectModelRejection(cleanExit(), selection), undefined);
  });
});

suite('card preferred model: chat handoff prompt', () => {
  test('states only the model for the hand-off provider, not the whole map', () => {
    const card: Card = {
      id: 'card-1',
      title: 'Chat me',
      createdAt: 1,
      description: 'Work',
      acceptanceCriteria: '- [ ] Done',
      preferredModels: { ...PER_PROVIDER },
    };
    const base = buildCardHandoffPrompt(card, '.mwnn/cards/card-1.md');

    // A chat hand-off goes to exactly one agent, so it carries exactly one name.
    const withNote = withPreferredModelNote(base, cardPreferredModelFor(card, 'claude-code'));
    assert.ok(withNote.startsWith(base), 'the existing prompt must be left intact');
    assert.ok(withNote.includes('## Preferred model'));
    assert.ok(withNote.includes(MODEL));
    for (const other of ['copilot', 'codex', 'cursor'] as const) {
      assert.ok(
        !withNote.includes(PER_PROVIDER[other]),
        `the ${other} model must stay out of a Claude Code hand-off`,
      );
    }

    // A card that names no model for this provider leaves the prompt identical.
    const unnamed: Card = { ...card, preferredModels: { codex: PER_PROVIDER.codex } };
    assert.equal(
      withPreferredModelNote(base, cardPreferredModelFor(unnamed, 'copilot')),
      base,
    );
    // A card with no entries at all leaves the prompt byte-identical.
    assert.equal(withPreferredModelNote(base, undefined), base);
    assert.equal(withPreferredModelNote(base, '   '), base);
  });
});

suite('card preferred model: credit fallback interaction', () => {
  test('the replacement provider uses its own entry, never the exhausted CLI model', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    board.mutate((current) => setPreferredModel(current, cardId, 'codex', PER_PROVIDER.codex));
    board.mutate((current) =>
      setPreferredModel(current, cardId, 'claude-code', PER_PROVIDER['claude-code']),
    );
    const invocations: AgentCliInvocation[] = [];
    const switches: AgentCliSwitchRecord[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['claude-code'] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
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
      buildPrompt: (card) => `prompt for ${card.title}`,
    });

    assert.equal(outcome.kind, 'ran');
    assert.ok(outcome.kind === 'ran' && outcome.result.completed);
    assert.equal(switches.length, 1);
    assert.equal(switches[0]?.to.provider, 'claude-code');

    // Each provider received its own entry, shaped for its own command line.
    assert.deepEqual(invocations[0]?.args, [
      'exec',
      '--model',
      PER_PROVIDER.codex,
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
      PER_PROVIDER['claude-code'],
    ]);
    // The exhausted CLI's model never reaches the replacement.
    assert.ok(!invocations[1]?.args.includes(PER_PROVIDER.codex));
    assert.equal(switches[0]?.toModel?.model, PER_PROVIDER['claude-code']);

    // Both the substitution and the model each CLI ran on are on the card.
    const activity = board.activity(cardId);
    assert.ok(activity.includes('Switched from OpenAI Codex CLI to Anthropic Claude Code CLI'));
    assert.ok(activity.includes(`Card preferred model: ${PER_PROVIDER.codex}.`));
    assert.ok(activity.includes(`Card preferred model: ${PER_PROVIDER['claude-code']}.`));
  });

  test('a replacement the card names no model for runs on its own default', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    // Only the exhausted CLI is named; Cursor is not.
    board.mutate((current) => setPreferredModel(current, cardId, 'codex', PER_PROVIDER.codex));
    const invocations: AgentCliInvocation[] = [];
    const switches: AgentCliSwitchRecord[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['cursor'] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
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

    const outcome = await runner.run({
      kind: 'implementation',
      card: board.card(cardId),
      buildPrompt: () => 'prompt',
    });

    assert.ok(outcome.kind === 'ran' && outcome.result.completed);
    assert.deepEqual(invocations[0]?.args, [
      'exec',
      '--model',
      PER_PROVIDER.codex,
      '--sandbox',
      'workspace-write',
      '-',
    ]);
    // Cursor runs on its own default: no model argument, and nothing inherited.
    assert.deepEqual(invocations[1]?.args, ['-p', '--force', '--output-format', 'text']);
    assert.equal(switches[0]?.toModel, undefined);
  });

  test('a card with no model leaves both the original and replacement argv untouched', async () => {
    const { state, cardId } = boardWithCard();
    const board = fakeBoard(state);
    const invocations: AgentCliInvocation[] = [];

    const runner = createAgentCliFallbackRunner({
      initialTarget: target('codex'),
      settings: { enabled: true, providers: ['cursor'] },
      configuredPaths: {},
      cwd: 'E:\\workspace',
      store: board.store,
      signal: new AbortController().signal,
      now: () => NOW,
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

    assert.deepEqual(invocations[0]?.args, ['exec', '--sandbox', 'workspace-write', '-']);
    assert.deepEqual(invocations[1]?.args, ['-p', '--force', '--output-format', 'text']);
    assert.ok(!board.activity(cardId).includes('Card preferred model'));
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
  state = addCard(state, state.columns[2]!.id, 'Exercise the card model');
  const cardId = state.columns[2]!.cards[0]!.id;
  state = setAssignee(state, cardId, { kind: 'ai' });
  state = setDescription(state, cardId, 'Run this card on a specific model.');
  state = setAcceptanceCriteria(state, cardId, '- [ ] The dispatch uses the card model');
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

function cardFileFor(fileSystem: ReturnType<typeof createFakeFileSystem>, cardId: string): string {
  return fileSystem.snapshot().get(`.mwnn/cards/${cardId}.md`) ?? '';
}

function createFakeFileSystem(
  initialFiles: Record<string, string> = {},
): FileSystemLike & { snapshot(): Map<string, string> } {
  const files = new Map<string, string>(Object.entries(initialFiles));
  const directories = new Set<string>(['.']);

  const normalizePath = (targetPath: string): string => {
    const normalized = path.normalize(targetPath);
    return normalized === '' ? '.' : normalized;
  };

  const ensureDirectory = (directory: string): void => {
    const normalized = normalizePath(directory);
    if (normalized === '.') {
      directories.add(normalized);
      return;
    }
    const parent = path.dirname(normalized);
    if (parent !== normalized) {
      ensureDirectory(parent);
    }
    directories.add(normalized);
  };

  for (const filePath of files.keys()) {
    ensureDirectory(path.dirname(normalizePath(filePath)));
  }

  return {
    async exists(targetPath: string): Promise<boolean> {
      const normalized = normalizePath(targetPath);
      return files.has(normalized) || directories.has(normalized);
    },
    async readFile(targetPath: string): Promise<string> {
      const file = files.get(normalizePath(targetPath));
      if (file === undefined) {
        throw new Error(`Missing file: ${targetPath}`);
      }
      return file;
    },
    async writeFile(targetPath: string, content: string): Promise<void> {
      const normalized = normalizePath(targetPath);
      ensureDirectory(path.dirname(normalized));
      files.set(normalized, content);
    },
    async deleteFile(targetPath: string): Promise<void> {
      files.delete(normalizePath(targetPath));
    },
    async readDirectory(targetPath: string): Promise<readonly string[]> {
      const normalized = normalizePath(targetPath);
      if (!directories.has(normalized)) {
        throw new Error(`Missing directory: ${targetPath}`);
      }
      const entries = new Set<string>();
      for (const filePath of files.keys()) {
        if (filePath.startsWith(`${normalized}/`)) {
          const remainder = filePath.slice(normalized.length + 1);
          if (!remainder.includes('/')) {
            entries.add(remainder);
          }
        }
      }
      for (const directory of directories) {
        if (directory !== normalized && directory.startsWith(`${normalized}/`)) {
          const remainder = directory.slice(normalized.length + 1);
          if (!remainder.includes('/')) {
            entries.add(remainder);
          }
        }
      }
      return [...entries];
    },
    async createDirectory(targetPath: string): Promise<void> {
      ensureDirectory(targetPath);
    },
    snapshot(): Map<string, string> {
      return new Map(files);
    },
  };
}
