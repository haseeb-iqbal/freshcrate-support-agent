import { describe, expect, it } from "vitest";
import { OPEN_STATUSES, ORDER_STATUSES, RULES, refundCeilingCents } from "./terms";
import { refundCeilingCents as policyCeiling } from "@/lib/guardrails/refund-policy";

describe("domain terms", () => {
  it("treats only processing and shipped as open, and only real statuses", () => {
    expect([...OPEN_STATUSES]).toEqual(["processing", "shipped"]);
    OPEN_STATUSES.forEach((s) => expect(ORDER_STATUSES).toContain(s));
  });

  it("re-exports the refund ceiling rather than redefining it", () => {
    // The ceiling has exactly one home; this guards against a second copy
    // drifting away from the policy module. The value itself is tested there.
    expect(refundCeilingCents).toBe(policyCeiling);
  });

  it("exposes non-empty canonical rule sentences", () => {
    for (const key of [
      "scope",
      "subscriptionFree",
      "orderStatus",
      "refundAmount",
      "refundCeiling",
      "feeRefund",
      "injection",
      "offTopic",
    ] as const) {
      expect(RULES[key].length).toBeGreaterThan(10);
    }
  });
});
