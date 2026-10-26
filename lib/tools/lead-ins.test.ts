import { describe, expect, it } from "vitest";
import { cancelLeadIn, dietLeadIn, pauseLeadIn, planChangeLeadIn, reactivateLeadIn, refundLeadIn, resumeLeadIn } from "./lead-ins";

const plan3 = { plan: "3 meals/week", monthly_cents: 16800, weekly_cents: 4200, current_plan: "2 meals/week", weeks_until_billing: 1, billing_date: "2026-11-04", weekly_savings_cents: 1050 };

/** One lead-in per card kind and variant, as the tools build them. */
const ALL = {
  refund: refundLeadIn({ order_number: "FC1008", amount_cents: 1750 }),
  pause: pauseLeadIn({ indefinite: false, weeks: 2, resume_date: "2026-11-13", adjustment_cents: 2200, weekly_fee_cents: 800, weeks_to_billing: 1, already_paused: false }),
  pauseIndefinite: pauseLeadIn({ indefinite: true, weeks: null, resume_date: null, adjustment_cents: 2200, weekly_fee_cents: 800, weeks_to_billing: 1, already_paused: false }),
  resume: resumeLeadIn({ plan: "2 meals/week", previous_plan: "2 meals/week", plan_changed: false, weekly_cents: 3000, monthly_cents: 12000, charge_cents: 4400, next_bill_cents: 12000, weeks_to_billing: 2, billing_date: "2026-11-06" }),
  reactivateFree: reactivateLeadIn({ plan: "2 meals/week", previous_plan: "2 meals/week", plan_changed: false, monthly_cents: 12000, signup_fee_cents: 0, total_cents: 0, free: true, within_billing: true, billing_date: "2026-10-29", next_billing_date: "2026-10-29" }),
  reactivatePaid: reactivateLeadIn({ plan: "3 meals/week", previous_plan: "2 meals/week", plan_changed: true, monthly_cents: 16800, signup_fee_cents: 4000, total_cents: 20800, free: false, within_billing: true, billing_date: "2026-10-29", next_billing_date: "2026-11-26" }),
  planUp: planChangeLeadIn({ ...plan3, proration_cents: 1200, paused: false }),
  planDown: planChangeLeadIn({ ...plan3, proration_cents: -1200, paused: false }),
  planPaused: planChangeLeadIn({ ...plan3, proration_cents: 0, paused: true }),
  cancel: cancelLeadIn({ billing_date: "2026-11-01", signup_fee_cents: 4000 }),
  diet: dietLeadIn({ new_track: "vegetarian", effective_from: "2026-10-30" }),
};

describe("card lead-ins", () => {
  it("each points at the card and never claims the action happened", () => {
    for (const [kind, text] of Object.entries(ALL)) {
      expect(text, kind).toMatch(/^Here's /);
      expect(text, kind).toMatch(/confirm below/);
      expect(text, kind).not.toMatch(/initiated|has been|is now|I've|done/i);
    }
  });

  it("states the figures the customer is agreeing to", () => {
    expect(ALL.refund).toContain("$17.50");
    expect(ALL.refund).toContain("FC1008");
    expect(ALL.pause).toContain("13th November 2026");
    expect(ALL.pause).toContain("$8/week");
    expect(ALL.resume).toContain("$120");
    expect(ALL.reactivateFree).toContain("free");
    expect(ALL.reactivatePaid).toMatch(/\$168.*\$40.*\$208/);
    expect(ALL.planUp).toContain("charged $12");
    expect(ALL.planDown).toContain("refunded $12");
    expect(ALL.planPaused).toMatch(/stays paused/);
    expect(ALL.cancel).toContain("1st November 2026");
    expect(ALL.cancel).toContain("$40");
    expect(ALL.diet).toContain("vegetarian");
  });
});
