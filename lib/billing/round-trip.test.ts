import { describe, expect, it } from "vitest";
import { quotePause, quoteResume } from "./quotes";

const plan = { plan: "2 meals/week", mealsPerWeek: 2, weeklyCents: 3000, monthlyCents: 12000 };
const three = { plan: "3 meals/week", mealsPerWeek: 3, weeklyCents: 4200, monthlyCents: 16800 };
const now = new Date("2026-07-20T00:00:00");
const billing = "2026-08-17"; // 4 weeks out

describe("pause/resume round-trip", () => {
  it("nets to zero for an immediate pause then resume", () => {
    const pause = quotePause({ status: "active", billingDate: billing, plan, indefinite: true, weeks: null, now });
    const resume = quoteResume({ currentPlan: plan.plan, billingDate: billing, plan, now });
    // pause debits adjustment_cents, resume credits charge_cents, at the same rate.
    expect(pause.adjustment_cents).toBe(resume.charge_cents);
    expect(-pause.adjustment_cents + resume.charge_cents).toBe(0);
  });

  it("nets a finite pause to the weeks actually skipped", () => {
    // Pause 1 week with 4 to billing, then resume 1 week later (3 to billing).
    const later = new Date("2026-07-27T00:00:00");
    const pause = quotePause({ status: "active", billingDate: billing, plan, indefinite: false, weeks: 1, now });
    const resume = quoteResume({ currentPlan: plan.plan, billingDate: billing, plan, now: later });
    // net on the bill = -adjustment(at pause) + charge(at resume) = -(4x30) + (3x30) = -1x30.
    expect(-pause.adjustment_cents + resume.charge_cents).toBe(-3000);
    expect(pause.net_credit_cents).toBe(3000); // display: 1 week skipped x $30
  });

  it("charges the new plan's rate when switching on resume", () => {
    const resume = quoteResume({ currentPlan: plan.plan, billingDate: billing, plan: three, requestedPlan: three.plan, now });
    expect(resume.charge_cents).toBe(16800); // 4 x $42
  });
});
