import { afterEach, describe, expect, it } from "vitest";
import { REFUND_COOLDOWN_DAYS, evaluateRefund, refundCeilingCents } from "./refund-policy";
import { toIsoDate } from "@/lib/date";

const now = new Date("2026-07-20T12:00:00");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("refundCeilingCents", () => {
  afterEach(() => {
    delete process.env.REFUND_CEILING_CENTS;
  });

  it("defaults to $20", () => {
    delete process.env.REFUND_CEILING_CENTS;
    expect(refundCeilingCents()).toBe(2000);
  });

  it("honours the env override", () => {
    process.env.REFUND_CEILING_CENTS = "3500";
    expect(refundCeilingCents()).toBe(3500);
  });
});

describe("evaluateRefund", () => {
  it("proposes a refund under the ceiling with no prior refund", () => {
    expect(evaluateRefund({ totalCents: 1750, now, lastRefundAt: null }).kind).toBe("needs_confirmation");
  });

  it("allows a refund exactly at the ceiling", () => {
    expect(evaluateRefund({ totalCents: 2000, now, lastRefundAt: null }).kind).toBe("needs_confirmation");
  });

  it("escalates a refund above the ceiling", () => {
    expect(evaluateRefund({ totalCents: 2001, now, lastRefundAt: null }).kind).toBe("over_ceiling");
  });

  it("escalates when a refund happened within the cooldown window", () => {
    const d = evaluateRefund({ totalCents: 1750, now, lastRefundAt: daysAgo(10) });
    expect(d.kind).toBe("cooldown");
  });

  it("allows a refund once the full cooldown has elapsed", () => {
    expect(evaluateRefund({ totalCents: 1750, now, lastRefundAt: daysAgo(REFUND_COOLDOWN_DAYS) }).kind).toBe("needs_confirmation");
  });

  it("still in cooldown one day before eligibility", () => {
    expect(evaluateRefund({ totalCents: 1750, now, lastRefundAt: daysAgo(REFUND_COOLDOWN_DAYS - 1) }).kind).toBe("cooldown");
  });

  it("reports when the customer is next eligible", () => {
    const d = evaluateRefund({ totalCents: 1750, now, lastRefundAt: daysAgo(10) });
    if (d.kind !== "cooldown") throw new Error("expected cooldown");
    // last refund 10 days ago + 14-day window = eligible in 4 days.
    expect(toIsoDate(d.nextEligible)).toBe("2026-07-24");
  });

  it("checks the value ceiling before the cooldown", () => {
    // Both gates would trip; the amount-based reason wins for a clearer message.
    expect(evaluateRefund({ totalCents: 5000, now, lastRefundAt: daysAgo(1) }).kind).toBe("over_ceiling");
  });
});
