import { describe, expect, it } from "vitest";
import { namesOrder, timeWindow } from "./time-window";

describe("namesOrder", () => {
  it("matches the order number as a whole word, in any case", () => {
    expect(namesOrder("FC1008 from last week was damaged", "FC1008")).toBe(true);
    expect(namesOrder("order fc1008, please", "FC1008")).toBe(true);
  });

  it("does not match a longer number that merely contains it", () => {
    expect(namesOrder("FC10089 was damaged", "FC1008")).toBe(false);
    expect(namesOrder("my order from last week", "FC1008")).toBe(false);
  });
});

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
