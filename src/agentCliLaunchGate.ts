/**
 * Durable launch admission seam. MWNN Kanban Pro registers a gate that
 * reserves every card-work CLI launch in its shared budget journal before the
 * process starts and settles it after the process ends. Without a registered
 * gate, dispatch behaves exactly as it does without Pro.
 */
import { randomUUID } from 'node:crypto';

/**
 * Host-owned permission envelope revision. Every launch runs each enabled CLI
 * with its current permissions, so fallback and escalation share this value;
 * Pro refuses a card run whose envelope changes midway.
 */
export const AGENT_CLI_LAUNCH_AUTHORITY = 'mwnn-kanban/cli-current-permissions/v1';

/** Model recorded when no model argument is passed and the CLI uses its own default. */
export const AGENT_CLI_DEFAULT_MODEL = 'cli-default';

/**
 * One run's identity. Every launch in a run (fallback, escalation, model
 * recovery and waits) carries the same scope so the per-stage launch count
 * cannot be evaded by switching provider or model.
 */
export interface AgentCliLaunchScope {
  readonly runId: string;
  /** A recovered durable card run keeps this id across portfolio sessions. */
  readonly cardRunId: string;
}

export interface AgentCliLaunchRequest {
  /** Canonical workspace root the CLI works in; also the destination. */
  readonly root: string;
  readonly cardId: string;
  readonly stage: string;
  readonly provider: string;
  readonly model: string;
  readonly runId: string;
  readonly cardRunId: string;
  readonly authority: string;
}

export type AgentCliLaunchAdmission =
  | { readonly allowed: true; readonly reservationId: string }
  | { readonly allowed: false; readonly reason: string };

export interface AgentCliLaunchGate {
  reserve(request: AgentCliLaunchRequest): Promise<AgentCliLaunchAdmission>;
  /** `not-started` only when no process was spawned; otherwise `ended`. */
  settle(reservationId: string, outcome: 'ended' | 'not-started'): Promise<void>;
}

/** A fresh scope for one run, or for a single launch no caller scoped. */
export function createAgentCliLaunchScope(cardId?: string): AgentCliLaunchScope {
  const runId = randomUUID();
  return { runId, cardRunId: cardId === undefined ? runId : `${runId}:${cardId}` };
}

/** Pro-side failures never reach a CLI: a throwing gate refuses the launch. */
export async function reserveAgentCliLaunch(
  gate: AgentCliLaunchGate,
  request: AgentCliLaunchRequest,
): Promise<AgentCliLaunchAdmission> {
  try {
    const admission = await gate.reserve(request);
    if (admission.allowed && typeof admission.reservationId === 'string' && admission.reservationId.length > 0) {
      return admission;
    }
    return {
      allowed: false,
      reason: admission.allowed === false && typeof admission.reason === 'string' && admission.reason.length > 0
        ? admission.reason
        : 'Launch budget admission returned no reservation.',
    };
  } catch {
    return { allowed: false, reason: 'Launch budget accounting is unavailable; reconcile before retrying.' };
  }
}

/** Settlement is best effort: an unsettled reservation stays counted, never refunded. */
export async function settleAgentCliLaunch(
  gate: AgentCliLaunchGate,
  reservationId: string,
  outcome: 'ended' | 'not-started',
): Promise<void> {
  try {
    await gate.settle(reservationId, outcome);
  } catch {
    // The journal keeps the reservation counted; nothing to undo here.
  }
}

/** Holds the one gate Pro registered; a stale unregister never clears a newer gate. */
export function createAgentCliLaunchGateRegistry(): {
  current(): AgentCliLaunchGate | undefined;
  register(gate: AgentCliLaunchGate): () => void;
} {
  let active: AgentCliLaunchGate | undefined;
  return {
    current: () => active,
    register: (gate) => {
      active = gate;
      return () => {
        if (active === gate) {
          active = undefined;
        }
      };
    },
  };
}
