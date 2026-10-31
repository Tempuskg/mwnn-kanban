import { createOutcomeEvidenceFactory, criterionTexts, type OutcomeEvidenceFactory } from '../../src/outcomeEvidence';

/** Host checker double; provider tests do not launch real project check commands. */
export const fakeOutcomeEvidence: OutcomeEvidenceFactory = async (input) => {
  let id = 0;
  return createOutcomeEvidenceFactory({
    snapshot: async () => ({ root: input.cwd, head: 'fixture-head', digest: 'fixture-code' }),
    readText: async (file) => {
      if (file.endsWith('verification.json')) {
        return JSON.stringify({ version: 1, criteria: criterionTexts(input.card)
          .map((text) => ({ text, checks: ['tests'] })) });
      }
      if (file.endsWith('package.json')) {
        return JSON.stringify({ scripts: { 'compile-tests': 'fixture', compile: 'fixture',
          test: 'fixture', lint: 'fixture' } });
      }
      return 'fixture instructions';
    },
    run: async () => ({ started: true, cancelled: false, exitCode: 0,
      stdout: '# tests 1\n# pass 1\n# fail 0\n# cancelled 0', stderr: '' }),
    persist: async () => '/fixture/host-receipt.json',
    now: () => new Date('2026-10-26T17:00:00Z'), id: () => `fixture-${++id}`,
  })(input);
};
