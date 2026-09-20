/**
 * Recognize "this CLI has no allowance left" failures in agent-CLI output.
 *
 * The AI loop only swaps providers for exhausted credits or a spent usage /
 * session quota, because that is the one failure another CLI can actually
 * recover from. Authentication problems, network failures, transient rate
 * limits, and plain nonzero exits stay with the active CLI: switching would
 * hide a problem the user still has to fix.
 *
 * The module is pure and free of `vscode`/`node:child_process` imports so both
 * the handoff layer and the tests can classify raw process output directly.
 */

/** The parts of a finished CLI process this classifier looks at. */
export interface CreditFailureInput {
  readonly started: boolean;
  readonly cancelled: boolean;
  readonly exitCode: number | null;
  /** Accepted so a whole `AgentCliProcessResult` can be classified directly. */
  readonly signal?: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}

export interface CreditExhaustionSignal {
  /** The matched output line, trimmed, shortened, and stripped of secrets. */
  readonly detail: string;
}

/**
 * Phrases that name a spent allowance specifically enough that no
 * authentication, connectivity, or retry-after message can match them.
 */
const EXHAUSTION_PATTERNS: readonly RegExp[] = [
  /credit balance is too low/i,
  /\b(?:out of|no more|no remaining|ran out of|run out of)\s+credits?\b/i,
  /\binsufficient[\s_-]?(?:credit|credits|balance|quota|funds)\b/i,
  /\bcredits?\b[^.\n]{0,40}\b(?:exhausted|depleted|used up|ran out|run out)\b/i,
  /\bquota\b[^.\n]{0,40}\b(?:exceeded|exhausted|depleted|reached)\b/i,
  /\b(?:usage|session|plan|subscription|monthly|weekly|daily|premium|token|message|request)\b[^.\n]{0,40}\blimits?\b[^.\n]{0,40}\b(?:reached|exceeded|exhausted|hit|used up)\b/i,
  /\b(?:reached|exceeded|hit|exhausted)\b[^.\n]{0,40}\b(?:usage|session|plan|subscription|monthly|weekly|daily|premium|token|message|request)\b[^.\n]{0,20}\blimits?\b/i,
  /\bexceeded your (?:current )?(?:quota|usage|plan|allowance|balance)\b/i,
  /\bbilling (?:hard )?limit (?:reached|exceeded)\b/i,
  /\b(?:insufficient_quota|quota_exceeded|credit_balance_too_low|usage_limit_reached|out_of_credits|billing_hard_limit_reached)\b/i,
];

/**
 * A matched line that also advertises its own recovery is a transient backoff,
 * not a spent allowance. Swapping CLIs there would abandon a run the active
 * CLI was about to retry by itself.
 */
const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /\bretry(?:ing)?\b/i,
  /\btemporar(?:y|ily)\b/i,
  /\bplease (?:wait|try again)\b/i,
  /\bbackoff\b/i,
];

const MAX_DETAIL_LENGTH = 300;

/**
 * Secrets that CLIs sometimes echo next to a billing error. Card Activity is
 * committed to the workspace, so credentials never reach it.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{8,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|secret|authorization)\b\s*[:=]\s*"?[^\s"',]{4,}"?/gi,
];

/** Replace anything that looks like a credential with a fixed placeholder. */
export function redactSecrets(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      const separator = /[:=]/.exec(match);
      if (separator?.index !== undefined && !/^Bearer/i.test(match)) {
        return `${match.slice(0, separator.index + 1)} [redacted]`;
      }
      return '[redacted]';
    });
  }
  return redacted;
}

/**
 * Classify one finished CLI process. Returns a signal only for a process that
 * actually ran, failed, and named a spent allowance; everything else — a
 * cancelled run, a process that never started, a clean exit, or an unrelated
 * error — returns undefined so the existing single-CLI failure path applies.
 */
export function detectCreditExhaustion(input: CreditFailureInput): CreditExhaustionSignal | undefined {
  if (!input.started || input.cancelled) {
    return undefined;
  }
  const failed = input.exitCode !== 0 || Boolean(input.error);
  if (!failed) {
    return undefined;
  }

  const lines = `${input.stderr}\n${input.stdout}\n${input.error ?? ''}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    if (!EXHAUSTION_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }
    if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }
    return { detail: redactSecrets(line).slice(0, MAX_DETAIL_LENGTH) };
  }
  return undefined;
}
