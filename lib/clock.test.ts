import { afterEach, describe, expect, it } from "vitest";
import { now, setClock } from "./clock";

afterEach(() => setClock(null));

describe("clock", () => {
  it("returns real time when no clock is set", () => {
    const before = Date.now();
    const t = now().getTime();
    expect(t).toBeGreaterThanOrEqual(before);
  });

  it("returns the pinned instant when a clock is set", () => {
    const pinned = new Date("2026-07-22T09:00:00");
    setClock(() => pinned);
    expect(now().getTime()).toBe(pinned.getTime());
  });

  it("restores real time when the clock is cleared", () => {
    setClock(() => new Date("2020-01-01T00:00:00"));
    setClock(null);
    expect(now().getFullYear()).toBeGreaterThan(2020);
  });
});
