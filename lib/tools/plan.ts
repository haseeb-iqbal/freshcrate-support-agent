import { eq } from "drizzle-orm";
import { db } from "../../db";
import { customers } from "../../db/schema";
import { getPlan, listPlans, prorationCents, weeklySavingsCents, weeksUntilDate } from "../billing/pricing";
import type { Tool } from "./types";

/** Change the customer's plan — propose-only, with the new monthly price. */
export const changePlan: Tool = {
  definition: {
    name: "change_plan",
    description:
      "Change the current customer's subscription plan (e.g. '2 meals/week', '3 meals/week', '4 meals/week'). Call this immediately when the customer asks to switch plans — calling it shows the confirmation prompt with the new price and proration; it does NOT change the plan until they confirm via the prompt. Don't ask them to confirm before calling it.",
    parameters: {
      type: "object",
      properties: {
        new_plan: { type: "string", description: "The plan to switch to, e.g. '3 meals/week'." },
      },
      required: ["new_plan"],
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const newPlan = String(args.new_plan ?? "").trim();
    const plan = await getPlan(newPlan);
    if (!plan) {
      const available = (await listPlans()).map((p) => p.plan).join(", ");
      return {
        ok: false,
        summary: `Unknown plan "${newPlan}"`,
        data: { message: `That plan doesn't exist. Available plans: ${available}. Ask the customer to pick one.` },
      };
    }
    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (customer?.subscriptionStatus === "cancelled") {
      return {
        ok: true,
        summary: "Cancelled — must reactivate before changing plan",
        data: {
          status: "cancelled",
          message:
            "The subscription is cancelled, so the plan can't be changed directly. To start on this plan, call reactivate_subscription with new_plan set to the requested plan — that reactivates and switches plan together.",
        },
      };
    }
    if (customer?.subscriptionStatus === "paused") {
      return {
        ok: true,
        summary: "Paused — must resume to change plan",
        data: {
          status: "paused",
          message:
            "The subscription is paused, so the plan can't be changed while paused. Offer to resume AND switch plan together: call resume_subscription with new_plan set to the requested plan (this resumes the subscription on the new plan). Ask if they'd like to do that.",
        },
      };
    }
    if (customer?.plan === newPlan) {
      return { ok: true, summary: `Already on ${newPlan}`, data: { status: "noop", message: "The customer is already on this plan — let them know, no change needed." } };
    }

    // Proration: charge/refund the weekly-rate difference for the weeks left
    // until the billing date. The new plan starts the following week.
    const currentPlan = customer ? await getPlan(customer.plan) : null;
    const weeksLeft = weeksUntilDate(customer?.billingDate, ctx.now);
    const proration = currentPlan ? prorationCents(currentPlan.weeklyCents, plan.weeklyCents, weeksLeft) : 0;

    return {
      ok: true,
      summary: `Proposed plan change to ${newPlan} ($${(plan.monthlyCents / 100).toFixed(2)}/mo, proration $${(proration / 100).toFixed(2)})`,
      data: {
        status: "needs_confirmation",
        proposal: {
          plan: newPlan,
          monthly_cents: plan.monthlyCents,
          weekly_cents: plan.weeklyCents,
          current_plan: customer?.plan ?? null,
          proration_cents: proration,
          weeks_until_billing: weeksLeft,
          billing_date: customer?.billingDate ?? null,
          weekly_savings_cents: weeklySavingsCents(plan.mealsPerWeek, plan.weeklyCents),
        },
        message:
          "A confirmation prompt shows the new plan, its monthly price, and the prorated charge/refund for the weeks left until billing (the new plan starts the following week). Ask the customer to confirm; do NOT say it's changed until they confirm.",
      },
    };
  },
};
