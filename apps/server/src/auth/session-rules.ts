// Pure session lifetime rules (ADR 0003 + R2 amendment, R2.md §2).

export const IDLE_MS = 30 * 60_000;
export const ABSOLUTE_MS = 12 * 60 * 60_000;
/** `last_seen_at` is written at most once a minute by ordinary requests. */
export const LAST_SEEN_THROTTLE_MS = 60_000;

export type SessionTimes = { lastSeenAt: Date; expiresAt: Date };

export type SessionVerdict =
  | { kind: "active"; touch: boolean }
  | { kind: "ended"; reason: "expired" | "timeout"; endedAt: Date };

/** Records whichever deadline passed first (Architect, PR #26): idle timeout before the 12 h cap is `timeout`. */
export function classifySession(s: SessionTimes, now: Date): SessionVerdict {
  const idleDeadline = s.lastSeenAt.getTime() + IDLE_MS;
  const idleFirst = idleDeadline < s.expiresAt.getTime();
  if (idleFirst && now.getTime() > idleDeadline) return { kind: "ended", reason: "timeout", endedAt: new Date(idleDeadline) };
  if (now.getTime() >= s.expiresAt.getTime()) return { kind: "ended", reason: "expired", endedAt: s.expiresAt };
  return { kind: "active", touch: now.getTime() - s.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS };
}

export function sessionInfo(s: SessionTimes): { expiresAt: string; idleExpiresAt: string } {
  return { expiresAt: s.expiresAt.toISOString(), idleExpiresAt: new Date(s.lastSeenAt.getTime() + IDLE_MS).toISOString() };
}

export const loginExpiry = (now: Date) => new Date(now.getTime() + ABSOLUTE_MS);

// Login throttling (ADR 0005): 5 failures per email in a rolling 15 min window.
export const FAILURE_WINDOW_MS = 15 * 60_000;
export const MAX_FAILURES = 5;

/** Seconds until the oldest failure in the window rolls out, given the failures in the window. */
export function retryAfterSeconds(failuresInWindow: Date[], now: Date): number | null {
  if (failuresInWindow.length < MAX_FAILURES) return null;
  const oldest = Math.min(...failuresInWindow.map((d) => d.getTime()));
  return Math.max(1, Math.ceil((oldest + FAILURE_WINDOW_MS - now.getTime()) / 1000));
}
