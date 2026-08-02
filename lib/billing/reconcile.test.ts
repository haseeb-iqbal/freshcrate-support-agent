import { describe, expect, it } from "vitest";
import { computeReconciliation, type ReconInput } from "./reconcile";

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

  it("auto-resumes a finite pause, clawing (weekly − $8) per week back into the adjustment", () => {
    // Paused with a full-cycle −$88 reduction on the account; now is after the
    // billing date, so the auto-resume and the following monthly bill both come
    // due in one catch-up pass.
    const r = computeReconciliation(
      { ...base, status: "paused", pauseResumeDate: "2026-08-25", billingDate: "2026-09-20", billingAdjustmentCents: -8800 },
      at("2026-09-21"),
    );
    expect(r.status).toBe("active");
    expect(r.pauseResumeDate).toBeNull();
    expect(typesOf(r)).not.toContain("resume_charge"); // resume adjusts, never posts a charge
    // weeks to billing on 2026-08-25 from 2026-09-20 = 3 -> claws back 3 x $22 = $66,
    // leaving one paused week: 12000 − 8800 + 6600 = 9800 (= 3 x $30 + 1 x $8).
    expect(typesOf(r)).toEqual(["monthly_billing"]);
    expect(r.transactions[0].amountCents).toBe(9800);
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

  it("bills a fully-paused month at 4 × $8 and pre-loads the next period", () => {
    // Paused indefinitely with the full-period −$88 reduction on the account.
    const r = computeReconciliation(
      { ...base, status: "paused", pauseResumeDate: null, billingDate: "2026-08-15", billingAdjustmentCents: -8800 },
      at("2026-09-01"),
    );
    expect(typesOf(r)).toEqual(["monthly_billing"]);
    expect(r.transactions[0].amountCents).toBe(3200); // 12000 − 8800 = 4 × $8
    expect(r.status).toBe("paused");
    expect(r.billingDate).toBe("2026-09-15");
    expect(r.billingAdjustmentCents).toBe(-8800); // next period pre-loaded
  });

  it("bills $32 at every billing date an indefinite pause spans", () => {
    const r = computeReconciliation(
      { ...base, status: "paused", pauseResumeDate: null, billingDate: "2026-08-20", billingAdjustmentCents: -8800 },
      at("2026-10-01"),
    );
    // Crossings 08-20 and 09-20 are both fully paused → 4 × $8 each.
    expect(typesOf(r)).toEqual(["monthly_billing", "monthly_billing"]);
    expect(r.transactions.map((t) => t.amountCents)).toEqual([3200, 3200]);
    expect(r.status).toBe("paused");
  });

  it("bills only the weeks actually paused when a finite pause ends mid-period", () => {
    // Paused with the full −$88 reduction, resuming 2026-09-05 (2 weeks into the
    // 09-20 period), so that period has 2 paused + 2 active weeks.
    const r = computeReconciliation(
      { ...base, status: "paused", pauseResumeDate: "2026-09-05", billingDate: "2026-09-20", billingAdjustmentCents: -8800 },
      at("2026-09-25"),
    );
    expect(typesOf(r)).toEqual(["monthly_billing"]);
    expect(r.transactions[0].amountCents).toBe(7600); // 2 × $30 + 2 × $8
    expect(r.status).toBe("active");
  });

  it("never bills or resumes a cancelled subscription", () => {
    const r = computeReconciliation({ ...base, status: "cancelled", billingDate: "2026-06-01" }, at("2026-09-01"));
    expect(r.changed).toBe(false);
    expect(r.transactions).toHaveLength(0);
  });

  it("resumes then bills when both events fall in the catch-up window", () => {
    // Paused with the full −$88 reduction, resuming 08-10 with 1 week to the
    // 08-20 billing, so 3 of that period's weeks were paused.
    const r = computeReconciliation(
      { ...base, status: "paused", pauseResumeDate: "2026-08-10", billingDate: "2026-08-20", billingAdjustmentCents: -8800 },
      at("2026-09-25"),
    );
    expect(r.status).toBe("active");
    // resume on 08-10 claws back 1 x $22, leaving −$66: 08-20 bills 12000 − 6600 =
    // 5400 (3 x $8 + 1 x $30), then 09-20 bills the full 12000.
    expect(typesOf(r)).toEqual(["monthly_billing", "monthly_billing"]);
    expect(r.transactions.map((t) => t.amountCents)).toEqual([5400, 12000]);
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
