import { describe, expect, it } from "vitest";
import { PAUSE_FEE_MONTHLY_CENTS, computeReconciliation, type ReconInput } from "./reconcile";

const base: ReconInput = {
  status: "active",
  billingDate: "2026-09-15",
  pauseResumeDate: null,
  weeklyCents: 3000,
  monthlyCents: 12000,
  billingAdjustmentCents: 0,
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

  it("auto-resumes a finite pause by crediting the adjustment, not posting a charge", () => {
    // now is after the billing date, so both the auto-resume and the following
    // monthly billing come due in this one catch-up pass.
    const r = computeReconciliation(
      { ...base, status: "paused", pauseResumeDate: "2026-08-25", billingDate: "2026-09-20" },
      at("2026-09-21"),
    );
    expect(r.status).toBe("active");
    expect(r.pauseResumeDate).toBeNull();
    // No resume_charge transaction; the resume adds weeks-to-billing x weekly to the adjustment.
    expect(typesOf(r)).not.toContain("resume_charge");
    // weeks to billing on 2026-08-25 from 2026-09-20 = 3 -> 3 x $30 = $90.
    // Then billing 2026-09-20 <= now: monthly + adjustment = 12000 + 9000 = 21000, adjustment cleared.
    expect(typesOf(r)).toEqual(["monthly_billing"]);
    expect(r.transactions[0].amountCents).toBe(21000);
    expect(r.billingAdjustmentCents).toBe(0);
    expect(r.events.map((e) => e.eventType)).toContain("resumed");
  });

  it("applies a stored credit to the next monthly bill and clears it", () => {
    const r = computeReconciliation(
      { ...base, billingDate: "2026-08-20", billingAdjustmentCents: -6000 },
      at("2026-09-01"),
    );
    expect(typesOf(r)).toEqual(["monthly_billing"]);
    expect(r.transactions[0].amountCents).toBe(6000); // 12000 - 6000
    expect(r.billingAdjustmentCents).toBe(0);
  });

  it("clamps a bill to zero when the credit exceeds one month, carrying no residual", () => {
    const r = computeReconciliation(
      { ...base, billingDate: "2026-08-20", billingAdjustmentCents: -20000 },
      at("2026-09-01"),
    );
    expect(r.transactions[0].amountCents).toBe(0);
    expect(r.billingAdjustmentCents).toBe(0);
  });

  it("applies the adjustment only to the first billing when several are due", () => {
    const r = computeReconciliation(
      { ...base, billingDate: "2026-07-15", billingAdjustmentCents: -3000 },
      at("2026-09-16"),
    );
    // Three crossings: first is 12000-3000=9000, the rest full 12000.
    expect(r.transactions.map((t) => t.amountCents)).toEqual([9000, 12000, 12000]);
    expect(r.billingAdjustmentCents).toBe(0);
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
    // resume on 08-10 (1 week to 08-20 billing -> $30 added to the adjustment),
    // then two monthly bills: 08-20 (12000 + 3000 adjustment = 15000), 09-20 (12000).
    expect(typesOf(r)).toEqual(["monthly_billing", "monthly_billing"]);
    expect(r.transactions.map((t) => t.amountCents)).toEqual([15000, 12000]);
    expect(r.billingDate).toBe("2026-10-20");
    expect(r.billingAdjustmentCents).toBe(0);
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
