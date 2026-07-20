import { describe, expect, it } from "vitest";
import { MEAL_LIST_PRICE_CENTS, holdFeeCents, prorationCents, weeklySavingsCents, weeksUntilDate, withinBillingPeriod } from "./pricing";

const on = (iso: string) => new Date(`${iso}T00:00:00`);

/**
 * Weeks-to-billing is the basis of every money calculation (pause reimbursement,
 * resume charge, plan-change proration), so the boundary is pinned exactly:
 * weeks = floor((days inclusive of today and the billing day) / 7).
 */
describe("weeksUntilDate", () => {
  const billing = "2026-07-27";

  it("counts 7 days out as 1 week", () => {
    expect(weeksUntilDate(billing, on("2026-07-20"))).toBe(1);
  });

  it("counts 6 days out as 1 week (the boundary)", () => {
    expect(weeksUntilDate(billing, on("2026-07-21"))).toBe(1);
  });

  it("counts 5 days out as 0 weeks (just past the boundary)", () => {
    expect(weeksUntilDate(billing, on("2026-07-22"))).toBe(0);
  });

  it("counts the billing day itself as 0 weeks", () => {
    expect(weeksUntilDate(billing, on("2026-07-27"))).toBe(0);
  });

  it("clamps a past billing date to 0", () => {
    expect(weeksUntilDate(billing, on("2026-08-03"))).toBe(0);
  });

  it("counts 13 days out as 2 weeks", () => {
    expect(weeksUntilDate(billing, on("2026-07-14"))).toBe(2);
  });

  it("counts 12 days out as 1 week", () => {
    expect(weeksUntilDate(billing, on("2026-07-15"))).toBe(1);
  });

  it("ignores the time of day", () => {
    expect(weeksUntilDate(billing, new Date("2026-07-21T23:59:00"))).toBe(1);
  });
});

describe("withinBillingPeriod", () => {
  it("is true before the billing date", () => {
    expect(withinBillingPeriod("2026-07-27", on("2026-07-20"))).toBe(true);
  });

  it("is true on the billing date itself", () => {
    expect(withinBillingPeriod("2026-07-27", on("2026-07-27"))).toBe(true);
  });

  it("is false after the billing date", () => {
    expect(withinBillingPeriod("2026-07-27", on("2026-07-28"))).toBe(false);
  });

  it("is false when there is no billing date", () => {
    expect(withinBillingPeriod(null, on("2026-07-20"))).toBe(false);
  });
});

describe("prorationCents", () => {
  it("charges the weekly difference for the weeks remaining", () => {
    expect(prorationCents(3000, 4200, 2)).toBe(2400);
  });

  it("credits when moving to a cheaper plan", () => {
    expect(prorationCents(4200, 3000, 2)).toBe(-2400);
  });

  it("is zero with no weeks remaining", () => {
    expect(prorationCents(3000, 5200, 0)).toBe(0);
  });
});

describe("holdFeeCents", () => {
  it("charges 20% of the skipped boxes' value", () => {
    expect(holdFeeCents(3000, 2)).toBe(1200);
  });
});

describe("weeklySavingsCents", () => {
  it("prices a meal at $17.50 à la carte", () => {
    expect(MEAL_LIST_PRICE_CENTS).toBe(1750);
  });

  it("saves $5/week on the 2-meal plan", () => {
    expect(weeklySavingsCents(2, 3000)).toBe(500);
  });

  it("saves $10.50/week on the 3-meal plan", () => {
    expect(weeklySavingsCents(3, 4200)).toBe(1050);
  });

  it("saves $18/week on the 4-meal plan", () => {
    expect(weeklySavingsCents(4, 5200)).toBe(1800);
  });
});
