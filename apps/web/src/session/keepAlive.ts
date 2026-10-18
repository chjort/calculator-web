import { api } from "../api/client";

export const KEEP_ALIVE_THROTTLE_MS = 60_000;

/**
 * sessionKeepAlive (R2.md §4): after real input (trusted keydown/pointerdown), send one touch
 * unless an activity call succeeded in the last 60 s. No timers, no background pings.
 */
export function createKeepAlive(now: () => number = Date.now) {
  let last = now();
  return {
    /** Any successful activity call (touch or Ans sync) resets the throttle. */
    noteActivity() { last = now(); },
    onInput(e: { isTrusted: boolean }) {
      if (!e.isTrusted || now() - last < KEEP_ALIVE_THROTTLE_MS) return;
      last = now();
      api.touch().catch(() => {}); // a 401 is handled by the API client
    },
  };
}
