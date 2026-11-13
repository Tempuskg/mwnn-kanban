/**
 * Recognizes a card whose last agent dispatch reported completion but was
 * rejected by the independent outcome gate only because the verification
 * profile was missing or invalid. Such a card can be re-checked under the
 * current profile without sending it back to the agent.
 */

import { parseVerificationVerdict } from './cardVerification';
import { isVerificationProfileFailure } from './outcomeEvidence';
import type { Card } from './types';

export type OutcomeRecheckStage = 'implementation' | 'verification';

/** Written into profile-failure entries so a later re-check can detect edited requirements. */
export const REQUIREMENTS_DIGEST_LABEL = 'Requirements digest:';

const DIRECT_START = /^### \S+ - .+ (implementation|verification|definition|triage) handoff started$/;
const ORCHESTRATED_START = /^### \S+ - Usage Orchestrator dispatch \S+ started$/;
const FAILED = /^### \S+ - .+ handoff failed$/;

function startStage(entry: string): string | undefined {
  const [header = '', ...body] = entry.split(/\r?\n/);
  const direct = DIRECT_START.exec(header.trim());
  if (direct) { return direct[1]; }
  if (ORCHESTRATED_START.test(header.trim())) {
    return /\bStage:\s*([a-z-]+)\./i.exec(body.join('\n'))?.[1]?.toLowerCase();
  }
  return undefined;
}

/**
 * True when the latest agent dispatch for `stage` ended with `STATUS: DONE`
 * (implementation) or `VERIFY: PASS` (verification), every gate failure since
 * then names only the missing/invalid profile, and no failure recorded a
 * requirements digest that differs from `currentRequirementsDigest`. Failure
 * entries written before digests existed carry none and are accepted.
 */
export function isStuckOnVerificationProfile(
  card: Card,
  stage: OutcomeRecheckStage,
  currentRequirementsDigest: string,
): boolean {
  const entries = (card.activity ?? '').split(/\r?\n(?=### )/);
  let lastStart = -1;
  for (const [index, entry] of entries.entries()) {
    if (startStage(entry) !== undefined) { lastStart = index; }
  }
  if (lastStart < 0 || startStage(entries[lastStart] ?? '') !== stage) {
    return false;
  }
  const segment = entries.slice(lastStart + 1);
  const segmentText = segment.join('\n');
  const lines = segmentText.split(/\r?\n/).map((line) => line.trim());
  const completed = stage === 'implementation'
    ? !lines.some((line) => /^STATUS:\s*BLOCKED\b/i.test(line)) && lines.some((line) => /^STATUS:\s*DONE\b/i.test(line))
    : parseVerificationVerdict(segmentText, 0)?.kind === 'pass';
  if (!completed) {
    return false;
  }
  const failures = segment.filter((entry) => FAILED.test((entry.split(/\r?\n/)[0] ?? '').trim()));
  return failures.length > 0 && failures.every((entry) => {
    const body = entry.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean);
    if (!isVerificationProfileFailure(body[0] ?? '')) { return false; }
    const recorded = body.find((line) => line.startsWith(REQUIREMENTS_DIGEST_LABEL));
    return recorded === undefined || recorded.slice(REQUIREMENTS_DIGEST_LABEL.length).trim() === currentRequirementsDigest;
  });
}
