import { describe, expect, it } from "vitest";
import {
  ORDER_KINDS,
  ORDER_STATUSES,
  OPEN_STATUSES,
  RULES,
  refundCeilingCents,
} from "./terms";

describe("domain terms", () => {
  it("defines the two order kinds", () => {
    expect(ORDER_KINDS).toEqual(["subscription", "extra"]);
  });

  it("defines the four order statuses", () => {
    expect(ORDER_STATUSES).toEqual(["processing", "shipped", "delivered", "cancelled"]);
  });

  it("treats only processing/shipped as open", () => {
    expect([...OPEN_STATUSES]).toEqual(["processing", "shipped"]);
    OPEN_STATUSES.forEach((s) => expect(ORDER_STATUSES).toContain(s));
  });

  it("re-exports the refund ceiling (default $10)", () => {
    const prev = process.env.REFUND_CEILING_CENTS;
    delete process.env.REFUND_CEILING_CENTS;
    expect(refundCeilingCents()).toBe(1000);
    if (prev !== undefined) process.env.REFUND_CEILING_CENTS = prev;
  });

  it("exposes non-empty canonical rule sentences", () => {
    for (const key of ["scope", "subscriptionFree", "refundAmount", "refundCeiling", "injection", "offTopic"] as const) {
      expect(RULES[key].length).toBeGreaterThan(10);
    }
  });
});
