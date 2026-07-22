import { afterEach, describe, expect, it } from "vitest";
import { now, setClock } from "./clock";

afterEach(() => setClock(null));

describe("clock", () => {
  it("returns real time when no clock is set", () => {
    const before = Date.now();
    const t = now().getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
  });

  it("returns the pinned instant when a clock is set", () => {
    const pinned = new Date(2026, 6, 22, 9, 0, 0);
    setClock(() => pinned);
    expect(now().getTime()).toBe(pinned.getTime());
  });

  it("returns to real time when the clock is cleared", () => {
    const pinned = new Date(2020, 0, 1);
    setClock(() => pinned);
    setClock(null);
    // Asserting proximity to real time, not merely "after 2020" - that older
    // assertion would have passed forever regardless of correctness.
    expect(now().getTime()).not.toBe(pinned.getTime());
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });
});
