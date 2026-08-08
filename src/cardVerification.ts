/** The explicit verdict appended by an agent after independently verifying a card. */
export type VerificationVerdict =
  | { readonly kind: 'pass' }
  | { readonly kind: 'fail'; readonly reason: string }
  | { readonly kind: 'human'; readonly reason: string };

/**
 * Parse the last verification marker appended after a recorded Activity baseline.
 * Earlier markers are intentionally ignored so they cannot resolve a new run.
 */
export function parseVerificationVerdict(
  activity: string,
  activityBaseline: number,
): VerificationVerdict | undefined {
  if (
    !Number.isInteger(activityBaseline)
    || activityBaseline < 0
    || activityBaseline > activity.length
  ) {
    return undefined;
  }

  const verdictLine = activity
    .slice(activityBaseline)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^VERIFY:/i.test(line))
    .at(-1);

  if (!verdictLine) {
    return undefined;
  }
  if (/^VERIFY:\s*PASS\s*$/i.test(verdictLine)) {
    return { kind: 'pass' };
  }

  const reasonVerdict = /^VERIFY:\s*(FAIL|HUMAN):\s*(.+)$/i.exec(verdictLine);
  const kind = reasonVerdict?.[1]?.toUpperCase();
  const reason = reasonVerdict?.[2]?.trim();
  if (!reason || (kind !== 'FAIL' && kind !== 'HUMAN')) {
    return undefined;
  }

  return kind === 'FAIL'
    ? { kind: 'fail', reason }
    : { kind: 'human', reason };
}
