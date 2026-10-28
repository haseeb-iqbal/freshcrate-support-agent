import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "./pricing";

describe("estimateCostUsd", () => {
  it("prices gpt-4o-mini input and output tokens separately", () => {
    // 10,000 in at $0.15/M + 500 out at $0.60/M = $0.0015 + $0.0003.
    expect(estimateCostUsd("gpt-4o-mini", 10_000, 500)).toBeCloseTo(0.0018, 10);
  });

  it("is zero for a model with no listed price rather than a guess", () => {
    expect(estimateCostUsd("some-other-model", 10_000, 500)).toBe(0);
  });
});
