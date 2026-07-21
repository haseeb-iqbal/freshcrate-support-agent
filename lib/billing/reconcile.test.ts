import { describe, expect, it } from "vitest";
import { PAUSE_FEE_MONTHLY_CENTS, computeReconciliation, type ReconInput } from "./reconcile";

const base: ReconInput = {
  status: "active",
  billingDate: "2026-09-15",
  pauseResumeDate: null,
  weeklyCents: 3000,
  monthlyCents: 12000,
};
const at = (iso: string) => new Date(`${iso}T00:00:00`);
const typesOf = (r: { transactions: { type: string }[] }) => r.transactions.map((t) => t.type);

describe("computeReconciliation", () => {
  it("is a no-op when the next billing date is still in the future", () => {
    const r = computeReconciliation(base, at("2026-09-01"));
    expect(r.changed).toBe(false);
    expect(r.transactions).toHaveLength(0);
    expect(r.billingDate).toBe("2026-09-15");
  });

  it("charges one month of billing when a single billing date has passed", () => {
    const r = computeReconciliation({ ...base, billingDate: "2026-08-20" }, at("2026-09-01"));
    expect(typesOf(r)).toEqual(["monthly_billing"]);
    expect(r.transactions[0].amountCents).toBe(12000);
    expect(r.billingDate).toBe("2026-09-20");
    expect(r.changed).toBe(true);
  });

  it("loops to charge every missed month, not just one", () => {
    const r = computeReconciliation({ ...base, billingDate: "2026-06-10" }, at("2026-09-01"));
    expect(typesOf(r)).toEqual(["monthly_billing", "monthly_billing", "monthly_billing"]);
    expect(r.billingDate).toBe("2026-09-10");
  });

  it("auto-resumes a finite pause once its resume date passes, charging the resume fee", () => {
    const r = computeReconciliation(
      { ...base, status: "paused", pauseResumeDate: "2026-08-25", billingDate: "2026-09-20" },
      at("2026-09-01"),
    );
    expect(r.status).toBe("active");
    expect(r.pauseResumeDate).toBeNull();
    expect(typesOf(r)).toEqual(["resume_charge"]);
    // weeks to billing on 2026-08-25 from 2026-09-20 = 3 → 3 × ($30 − $8) = $66.
    expect(r.transactions[0].amountCents).toBe(6600);
    expect(r.events.map((e) => e.eventType)).toContain("resumed");
  });

  it("charges the monthly pause fee for an indefinite pause and stays paused", () => {
    const r = computeReconciliation(
      { ...base, status: "paused", pauseResumeDate: null, billingDate: "2026-08-15" },
      at("2026-09-01"),
    );
    expect(typesOf(r)).toEqual(["pause_fee"]);
    expect(r.transactions[0].amountCents).toBe(PAUSE_FEE_MONTHLY_CENTS);
    expect(r.status).toBe("paused");
    expect(r.billingDate).toBe("2026-09-15");
  });

  it("charges the pause fee at every billing date a FINITE pause spans", () => {
    const r = computeReconciliation(
      { ...base, status: "paused", pauseResumeDate: "2026-11-15", billingDate: "2026-08-20" },
      at("2026-10-01"),
    );
    // Crossings 08-20 and 09-20 are both fully inside the pause → 4 × $8 each.
    expect(typesOf(r)).toEqual(["pause_fee", "pause_fee"]);
    expect(r.transactions.map((t) => t.amountCents)).toEqual([3200, 3200]);
    expect(r.status).toBe("paused");
  });

  it("charges only the weeks actually paused when a finite pause ends mid-period", () => {
    const r = computeReconciliation(
      { ...base, status: "paused", pauseResumeDate: "2026-09-05", billingDate: "2026-08-20" },
      at("2026-08-25"),
    );
    // 2026-08-20 → 2026-09-05 is 2 weeks of pause in that period → 2 × $8.
    expect(typesOf(r)).toEqual(["pause_fee"]);
    expect(r.transactions[0].amountCents).toBe(1600);
  });

  it("never bills or resumes a cancelled subscription", () => {
    const r = computeReconciliation({ ...base, status: "cancelled", billingDate: "2026-06-01" }, at("2026-09-01"));
    expect(r.changed).toBe(false);
    expect(r.transactions).toHaveLength(0);
  });

  it("resumes then bills when both events fall in the catch-up window", () => {
    const r = computeReconciliation(
      { ...base, status: "paused", pauseResumeDate: "2026-08-10", billingDate: "2026-08-20" },
      at("2026-09-25"),
    );
    expect(r.status).toBe("active");
    // resume on 08-10 (1 week to 08-20 billing → $22), then two monthly bills (08-20, 09-20).
    expect(typesOf(r)).toEqual(["resume_charge", "monthly_billing", "monthly_billing"]);
    expect(r.transactions[0].amountCents).toBe(2200);
    expect(r.billingDate).toBe("2026-10-20");
  });

  it("is idempotent: re-running on its own result changes nothing", () => {
    const first = computeReconciliation({ ...base, billingDate: "2026-06-10" }, at("2026-09-01"));
    const second = computeReconciliation(
      { ...base, status: first.status, billingDate: first.billingDate, pauseResumeDate: first.pauseResumeDate },
      at("2026-09-01"),
    );
    expect(second.changed).toBe(false);
    expect(second.transactions).toHaveLength(0);
  });
});
