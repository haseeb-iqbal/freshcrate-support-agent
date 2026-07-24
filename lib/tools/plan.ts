import { eq } from "drizzle-orm";
import { db } from "../../db";
import { customers } from "../../db/schema";
import { getPlan, listPlans } from "../billing/plans";
import { quotePlanChange } from "../billing/quotes";
import { money } from "../money";
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

    // The same quote /api/actions/change-plan applies on confirm: charge/refund
    // the weekly-rate difference for the weeks left until the billing date. The
    // new plan starts the following week.
    const proposal = quotePlanChange({
      currentPlan: customer ? await getPlan(customer.plan) : null,
      billingDate: customer?.billingDate ?? null,
      plan,
      now: ctx.now,
    });

    return {
      ok: true,
      summary: `Proposed plan change to ${newPlan} (${money(plan.monthlyCents)}/mo, proration ${money(proposal.proration_cents)})`,
      data: {
        status: "needs_confirmation",
        proposal,
        message:
          "A confirmation prompt shows the new plan, its monthly price, and the prorated charge/refund for the weeks left until billing (the new plan starts the following week). Ask the customer to confirm; do NOT say it's changed until they confirm.",
      },
    };
  },
};
