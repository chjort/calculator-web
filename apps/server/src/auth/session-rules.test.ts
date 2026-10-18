import { describe, expect, it } from "vitest";
import { classifySession, retryAfterSeconds, sessionInfo } from "./session-rules";

const t0 = new Date("2026-10-18T08:00:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const s = { lastSeenAt: t0, expiresAt: at(12 * 60) };

describe("session rules (ADR 0003)", () => {
  it("active within 30 min; last_seen_at written at most once a minute", () => {
    expect(classifySession(s, at(0.5))).toEqual({ kind: "active", touch: false });
    expect(classifySession(s, at(1.01))).toEqual({ kind: "active", touch: true });
    expect(classifySession(s, at(30))).toEqual({ kind: "active", touch: true });
  });
  it("idle > 30 min ends with timeout at last_seen_at + 30 min", () => {
    expect(classifySession(s, at(30.01))).toEqual({ kind: "ended", reason: "timeout", endedAt: at(30) });
  });
  it("12 h cap ends with expired at expires_at, checked first", () => {
    expect(classifySession({ lastSeenAt: at(12 * 60 - 1), expiresAt: s.expiresAt }, at(12 * 60))).toEqual({ kind: "ended", reason: "expired", endedAt: s.expiresAt });
  });
  it("idle before the 12 h cap but first seen after it: timeout at last_seen_at + 30 min", () => {
    const idled = { lastSeenAt: at(60), expiresAt: s.expiresAt };
    expect(classifySession(idled, at(13 * 60))).toEqual({ kind: "ended", reason: "timeout", endedAt: at(90) });
  });
  it("SessionInfo exposes both deadlines", () => {
    expect(sessionInfo(s)).toEqual({ expiresAt: "2026-10-18T20:00:00.000Z", idleExpiresAt: "2026-10-18T08:30:00.000Z" });
  });
  it("throttle: Retry-After counts down from the oldest failure in the window (ADR 0005)", () => {
    expect(retryAfterSeconds([at(0), at(1), at(2), at(3)], at(4))).toBeNull();
    expect(retryAfterSeconds([at(0), at(1), at(2), at(3), at(4)], at(5))).toBe(10 * 60);
  });
});
