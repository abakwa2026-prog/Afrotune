/**
 * Minimal Phase 1 moderation: a small denylist check on free-text fields
 * before a song request can proceed to payment/generation. This is
 * intentionally conservative and simple - the spec calls for respecting an
 * existing moderation foundation, which was not accessible when this was
 * written. Replace/extend with the founder's actual policy and, ideally, a
 * proper moderation API before relying on this in production.
 */
const DENYLIST_PATTERNS: RegExp[] = [
  /\b(kill|assassinat\w*)\b/i,
  /\bterroris\w*\b/i,
  /\bsuicide\b/i,
];

export function needsModeration(text: string | null | undefined): { flagged: boolean; reason?: string } {
  if (!text) return { flagged: false };
  for (const pattern of DENYLIST_PATTERNS) {
    if (pattern.test(text)) {
      return { flagged: true, reason: `matched denylist pattern: ${pattern}` };
    }
  }
  return { flagged: false };
}
