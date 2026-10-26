import { describe, expect, it } from "vitest";
import { timeWindow } from "./time-window";

const NOW = new Date(2026, 9, 26, 10, 0, 0); // 26 October 2026, local

describe("timeWindow", () => {
  it("reads 'last week' as the 7 days up to today", () => {
    expect(timeWindow("my order from last week was damaged", NOW)).toEqual({ from: "2026-10-19", to: "2026-10-26", phrase: "last week" });
  });

  it("reads 'yesterday' as that single day", () => {
    expect(timeWindow("the box from yesterday leaked", NOW)).toEqual({ from: "2026-10-25", to: "2026-10-25", phrase: "yesterday" });
  });

  it("returns null when the customer pinned no time", () => {
    expect(timeWindow("my box was damaged", NOW)).toBeNull();
  });
});
