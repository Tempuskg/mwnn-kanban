/**
 * Reconcile card evidence before retrying an ambiguous stage action.
 *
 * A timeout, crash, or restart does not mean the previous handoff failed. This
 * module re-reads authoritative card state against the checkpointed activity
 * baseline and decides whether the stage already completed, blocked, needs a
 * human, or is safe to retry.
 */

import { cardNeedsDefinition } from './cardDefinition';
import { parseVerificationVerdict } from './cardVerification';
import { parseTerminalCardStatus } from './agentCliHandoff';
import type { AgentCliHandoffKind } from './agentCliStages';
import type { Card } from './types';

export type WorkerReconcileDecision =
  | {
      readonly kind: 'already-complete';
      readonly message: string;
    }
  | {
      readonly kind: 'blocked';
      readonly reason: string;
      readonly message: string;
    }
  | {
      readonly kind: 'needs-human';
      readonly message: string;
    }
  | {
      readonly kind: 'retry';
      readonly message: string;
    };

export interface WorkerReconcileInput {
  readonly stage: AgentCliHandoffKind;
  readonly card: Card;
  /**
   * Activity length when the ambiguous attempt started. Absent means the
   * interruption left no trustworthy baseline — treat as needs-human rather
   * than guessing.
   */
  readonly activityBaseline?: number;
  readonly actionId?: string;
}

/**
 * Decide whether an interrupted or timed-out stage may be retried.
 *
 * Call this *before* launching another CLI for the same stage action.
 */
export function reconcileWorkerStage(input: WorkerReconcileInput): WorkerReconcileDecision {
  const baseline = input.activityBaseline;
  if (baseline === undefined) {
    return {
      kind: 'needs-human',
      message: [
        `Interrupted ${input.stage} has no activity baseline to reconcile`,
        input.actionId ? `(action ${input.actionId})` : undefined,
        '— refusing to retry an ambiguous action automatically.',
      ].filter((part): part is string => part !== undefined).join(' '),
    };
  }

  if (baseline < 0 || baseline > (input.card.activity ?? '').length) {
    return {
      kind: 'needs-human',
      message: [
        `Interrupted ${input.stage} cannot be reconciled because the card Activity`,
        'was replaced or shortened since the attempt started — refusing automatic retry.',
      ].join(' '),
    };
  }

  const evidence = evaluateStageEvidence(input.stage, input.card, baseline);
  // A restart has no live host checker session. Never reconstruct a passing
  // receipt from agent-written Activity or replay a previous attempt's text.
  const requestsAcceptance = input.stage === 'implementation'
    ? parseTerminalCardStatus(input.card.activity ?? '', baseline)
    : undefined;
  const claimsDone = requestsAcceptance?.valid && requestsAcceptance.status.kind === 'done';
  const claimsPass = input.stage === 'verification'
    && parseVerificationVerdict(input.card.activity ?? '', baseline)?.kind === 'pass';
  if (claimsDone || claimsPass) {
    return { kind: 'needs-human', message: 'Interrupted completion requires fresh independent verification of the current inputs and code; terminal text alone cannot complete or automatically retry this action.' };
  }
  if (evidence.kind === 'complete') {
    return {
      kind: 'already-complete',
      message: [
        `Reconciled interrupted ${input.stage}: evidence already present on the card`,
        input.actionId ? `(action ${input.actionId})` : undefined,
        '— skipping duplicate dispatch.',
      ].filter((part): part is string => part !== undefined).join(' '),
    };
  }
  if (evidence.kind === 'blocked') {
    return {
      kind: 'blocked',
      reason: evidence.reason,
      message: [
        `Reconciled interrupted ${input.stage}: card reports BLOCKED`,
        `(${evidence.reason}) — not retrying.`,
      ].join(' '),
    };
  }

  return {
    kind: 'retry',
    message: [
      `Reconciled interrupted ${input.stage}: no completion evidence since the checkpoint`,
      input.actionId ? `(action ${input.actionId})` : undefined,
      '— safe to retry once within bounds.',
    ].filter((part): part is string => part !== undefined).join(' '),
  };
}

type StageEvidence =
  | { readonly kind: 'complete' }
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'incomplete' };

function evaluateStageEvidence(
  stage: AgentCliHandoffKind,
  card: Card,
  activityBaseline: number,
): StageEvidence {
  if (stage === 'definition') {
    return cardNeedsDefinition(card) ? { kind: 'incomplete' } : { kind: 'complete' };
  }
  if (stage === 'triage') {
    return card.assignee ? { kind: 'complete' } : { kind: 'incomplete' };
  }
  if (stage === 'verification') {
    return parseVerificationVerdict(card.activity ?? '', activityBaseline)
      ? { kind: 'complete' }
      : { kind: 'incomplete' };
  }

  const terminal = parseTerminalCardStatus(card.activity ?? '', activityBaseline);
  if (!terminal.valid) {
    return { kind: 'incomplete' };
  }
  if (terminal.status.kind === 'blocked') {
    return { kind: 'blocked', reason: terminal.status.reason };
  }
  return { kind: 'complete' };
}

export function formatWorkerReconcileEntry(
  decision: WorkerReconcileDecision,
  timestamp: Date = new Date(),
): string {
  return [
    `### ${timestamp.toISOString()} - Worker reconcile: ${decision.kind}`,
    decision.message,
  ].join('\n');
}
