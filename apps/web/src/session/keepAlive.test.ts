import { beforeEach, describe, expect, it, vi } from "vitest";

const touch = vi.fn(() => Promise.resolve({ expiresAt: "", idleExpiresAt: "" }));
vi.mock("../api/client", () => ({ api: { touch: () => touch() } }));
const { createKeepAlive, KEEP_ALIVE_THROTTLE_MS } = await import("./keepAlive");

describe("sessionKeepAlive (R2.md §4)", () => {
  let t = 0;
  beforeEach(() => { t = 1_000_000; touch.mockClear(); });

  it("touches only after trusted input, at most once a minute, never on its own", () => {
    const k = createKeepAlive(() => t);
    k.onInput({ isTrusted: true });
    expect(touch).not.toHaveBeenCalled(); // an activity call (login) just happened
    t += KEEP_ALIVE_THROTTLE_MS;
    k.onInput({ isTrusted: false });
    expect(touch).not.toHaveBeenCalled(); // synthetic events don't count
    k.onInput({ isTrusted: true });
    k.onInput({ isTrusted: true });
    expect(touch).toHaveBeenCalledTimes(1);
    t += KEEP_ALIVE_THROTTLE_MS - 1;
    k.onInput({ isTrusted: true });
    expect(touch).toHaveBeenCalledTimes(1);
  });

  it("an Ans sync (activity call) resets the throttle", () => {
    const k = createKeepAlive(() => t);
    t += KEEP_ALIVE_THROTTLE_MS;
    k.noteActivity();
    k.onInput({ isTrusted: true });
    expect(touch).not.toHaveBeenCalled();
  });
});
