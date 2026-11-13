import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  effectiveAgentCliAllowedProviders,
  isAgentCliProviderAllowed,
  readAgentCliAllowedProviders,
  readAgentCliNoExtraChargesAcknowledged,
  setAgentCliProviderSetting,
} from '../../src/agentCliAccess';
import { listRunWithAiProviderChoices } from '../../src/runWithAi';

suite('agent CLI access settings', () => {
  test('keeps every supported executable allowed when no value is explicitly false', () => {
    assert.deepEqual(readAgentCliAllowedProviders(undefined), [
      'copilot',
      'codex',
      'claude-code',
      'cursor',
    ]);
    assert.deepEqual(readAgentCliAllowedProviders({ codex: 'false' }), [
      'copilot',
      'codex',
      'claude-code',
      'cursor',
    ]);
  });

  test('uses one Cursor executable decision for both Cursor identities', () => {
    const allowed = readAgentCliAllowedProviders({ cursor: false });
    assert.equal(isAgentCliProviderAllowed('cursor', allowed), false);
    assert.equal(isAgentCliProviderAllowed('cursor-other', allowed), false);
    assert.equal(isAgentCliProviderAllowed('codex', allowed), true);
  });

  test('no-extra-charges acknowledgement defaults on and only an explicit false withdraws it', () => {
    assert.equal(readAgentCliNoExtraChargesAcknowledged(undefined), true);
    assert.equal(readAgentCliNoExtraChargesAcknowledged(true), true);
    assert.equal(readAgentCliNoExtraChargesAcknowledged('false'), true);
    assert.equal(readAgentCliNoExtraChargesAcknowledged(false), false);
  });

  test('withdrawing the acknowledgement disables every CLI, including Cursor Other', () => {
    const allowed = readAgentCliAllowedProviders(undefined);
    assert.deepEqual(effectiveAgentCliAllowedProviders(allowed, true), allowed);
    const blocked = effectiveAgentCliAllowedProviders(allowed, false);
    assert.deepEqual(blocked, []);
    assert.equal(isAgentCliProviderAllowed('cursor-other', blocked), false);
    assert.deepEqual(listRunWithAiProviderChoices([], blocked), []);
  });

  test('writes an executable choice without discarding other scope values', () => {
    assert.deepEqual(
      setAgentCliProviderSetting({ copilot: false, future: 'keep' }, 'codex', false),
      { copilot: false, future: 'keep', codex: false },
    );
  });

  test('Run with AI offers only enabled CLIs and omits an empty orchestrator choice', () => {
    const choices = listRunWithAiProviderChoices([], ['codex'], true);
    assert.deepEqual(
      choices.map((choice) => choice.kind === 'cli' ? choice.provider : choice.target.provider),
      ['codex', 'orchestrator'],
    );
    assert.deepEqual(listRunWithAiProviderChoices([], []), []);
  });
});
