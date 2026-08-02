import { describe, expect, it } from "vitest";
import { quotePause, quotePlanChange, quoteReactivate, quoteResume, type PlanRate } from "./quotes";

// 20 July 2026, local midnight. Billing on 2026-08-17 is exactly 4 weeks out.
const TODAY = new Date(2026, 6, 20);
const BILLING = "2026-08-17";

const PLAN_2: PlanRate = { plan: "2 meals/week", mealsPerWeek: 2, weeklyCents: 3000, monthlyCents: 12000 };
const PLAN_3: PlanRate = { plan: "3 meals/week", mealsPerWeek: 3, weeklyCents: 4200, monthlyCents: 16800 };
const PLAN_4: PlanRate = { plan: "4 meals/week", mealsPerWeek: 4, weeklyCents: 5200, monthlyCents: 20800 };

describe("quotePause (paused week billed at $8)", () => {
  const base = { billingDate: BILLING, plan: PLAN_2, now: TODAY } as const;

  it("defers the remaining cycle at (weekly − $8) per week", () => {
    const q = quotePause({ ...base, status: "active", indefinite: true, weeks: null });
    expect(q.adjustment_cents).toBe(8800); // 4 weeks x ($30 − $8)
    expect(q.weeks_to_billing).toBe(4);
    expect(q.weekly_fee_cents).toBe(800);
    expect(q.resume_date).toBeNull();
    expect(q.weeks).toBeNull();
  });

  it("defers the whole remaining cycle for a finite pause too (resume claws the rest back)", () => {
    const q = quotePause({ ...base, status: "active", indefinite: false, weeks: 2 });
    expect(q.adjustment_cents).toBe(8800); // still the whole cycle
  });

  it("defers nothing when the subscription was already paused", () => {
    // Replaying a pause on a paused sub must not discount the already-paused
    // weeks again - the write endpoint enforces this and the proposal agrees.
    const q = quotePause({ ...base, status: "paused", indefinite: true, weeks: null });
    expect(q.adjustment_cents).toBe(0);
    expect(q.already_paused).toBe(true);
  });

  it("derives the resume date from the pause length when none was given", () => {
    const q = quotePause({ ...base, status: "active", indefinite: false, weeks: 2 });
    expect(q.resume_date).toBe("2026-08-03");
  });

  it("keeps an explicit resume date the customer named", () => {
    const q = quotePause({ ...base, status: "active", indefinite: false, weeks: 3, resumeDate: "2026-08-10" });
    expect(q.resume_date).toBe("2026-08-10");
  });

  it("defers nothing when the plan rate is unknown", () => {
    const q = quotePause({ ...base, plan: null, status: "active", indefinite: false, weeks: 2 });
    expect(q.adjustment_cents).toBe(0);
  });
});

describe("quoteResume (returns weeks to the plan rate)", () => {
  const base = { currentPlan: "2 meals/week", billingDate: BILLING, now: TODAY } as const;

  it("adds (weekly − $8) per remaining week back onto the next bill", () => {
    const q = quoteResume({ ...base, plan: PLAN_2 });
    expect(q.charge_cents).toBe(8800); // 4 x ($30 − $8)
    expect(q.monthly_cents).toBe(12000);
    expect(q.next_bill_cents).toBe(20800); // monthly + charge (no prior adjustment)
    expect(q.plan_changed).toBe(false);
  });

  it("charges at the new plan's rate when switching on resume", () => {
    // 4 weeks x ($42 − $8) = $136.
    const q = quoteResume({ ...base, plan: PLAN_3, requestedPlan: "3 meals/week" });
    expect(q.plan_changed).toBe(true);
    expect(q.charge_cents).toBe(13600);
    expect(q.next_bill_cents).toBe(30400); // 16800 + 13600
    expect(q.previous_plan).toBe("2 meals/week");
  });

  it("is not a plan change when the requested plan is the current one", () => {
    const q = quoteResume({ ...base, plan: PLAN_2, requestedPlan: "2 meals/week" });
    expect(q.plan_changed).toBe(false);
  });

  it("charges nothing when billing is due within the week", () => {
    const q = quoteResume({ ...base, billingDate: "2026-07-24", plan: PLAN_2 });
    expect(q.charge_cents).toBe(0);
  });

  it("nets the existing pause reduction into next_bill_cents (resume after a pause)", () => {
    // Paused with a -$22 reduction deferred (one week billed at $8 not $30), then
    // resume with 1 week to billing: charge +$22, so the next bill is
    // monthly - 22 + 22 = $120, back to the full plan.
    const q = quoteResume({ ...base, billingDate: "2026-07-27", plan: PLAN_2, billingAdjustmentCents: -2200 });
    expect(q.charge_cents).toBe(2200); // 1 week x ($30 − $8)
    expect(q.next_bill_cents).toBe(12000);
  });

  it("floors next_bill_cents at zero when a large credit exceeds the bill", () => {
    const q = quoteResume({ ...base, plan: PLAN_2, billingAdjustmentCents: -30000 });
    expect(q.next_bill_cents).toBe(0);
  });
});

describe("quoteReactivate", () => {
  const base = { currentPlan: "2 meals/week", now: TODAY } as const;

  it("is free within the billing period on the same plan", () => {
    const q = quoteReactivate({ ...base, billingDate: BILLING, plan: PLAN_2 });
    expect(q.free).toBe(true);
    expect(q.total_cents).toBe(0);
    expect(q.signup_fee_cents).toBe(0);
  });

  it("charges the plan price plus the sign-up fee once the period has lapsed", () => {
    // $120 monthly + $40 sign-up.
    const q = quoteReactivate({ ...base, billingDate: "2026-07-01", plan: PLAN_2 });
    expect(q.free).toBe(false);
    expect(q.signup_fee_cents).toBe(4000);
    expect(q.total_cents).toBe(16000);
  });

  it("is not free when switching plan, even inside the billing period", () => {
    const q = quoteReactivate({ ...base, billingDate: BILLING, plan: PLAN_3, requestedPlan: "3 meals/week" });
    expect(q.free).toBe(false);
    expect(q.plan_changed).toBe(true);
    // Still inside the period, so no sign-up fee - just the new plan's price.
    expect(q.signup_fee_cents).toBe(0);
    expect(q.total_cents).toBe(16800);
  });

  it("keeps a billing date that is still ahead", () => {
    const q = quoteReactivate({ ...base, billingDate: BILLING, plan: PLAN_2 });
    expect(q.next_billing_date).toBe(BILLING);
  });

  it("advances a stale billing date a month out so reconcile cannot back-bill", () => {
    // Cancelled in the past: handing 2026-07-01 back to an active subscription
    // would bill for every month spent cancelled.
    const q = quoteReactivate({ ...base, billingDate: "2026-07-01", plan: PLAN_2 });
    expect(q.next_billing_date).toBe("2026-08-20");
  });
});

describe("quotePlanChange", () => {
  const base = { billingDate: BILLING, now: TODAY } as const;

  it("charges the prorated difference on an upgrade", () => {
    // ($42 - $30) x 4 weeks left = $48.
    const q = quotePlanChange({ ...base, currentPlan: PLAN_2, plan: PLAN_3 });
    expect(q.proration_cents).toBe(4800);
    expect(q.weeks_until_billing).toBe(4);
  });

  it("refunds the prorated difference on a downgrade", () => {
    // ($30 - $52) x 4 = -$88.
    const q = quotePlanChange({ ...base, currentPlan: PLAN_4, plan: PLAN_2 });
    expect(q.proration_cents).toBe(-8800);
  });

  it("prorates nothing when billing is due within the week", () => {
    const q = quotePlanChange({ ...base, billingDate: "2026-07-24", currentPlan: PLAN_2, plan: PLAN_3 });
    expect(q.proration_cents).toBe(0);
  });

  it("prorates nothing when the current plan rate is unknown", () => {
    const q = quotePlanChange({ ...base, currentPlan: null, plan: PLAN_3 });
    expect(q.proration_cents).toBe(0);
    expect(q.current_plan).toBeNull();
  });

  it("reports the weekly saving against buying the meals a la carte", () => {
    // 2 meals at $17.50 = $35 vs $30 a week.
    expect(quotePlanChange({ ...base, currentPlan: PLAN_2, plan: PLAN_2 }).weekly_savings_cents).toBe(500);
    // 4 meals at $17.50 = $70 vs $52 a week.
    expect(quotePlanChange({ ...base, currentPlan: PLAN_2, plan: PLAN_4 }).weekly_savings_cents).toBe(1800);
  });
});
