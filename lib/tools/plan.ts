import { eq } from "drizzle-orm";
import { db } from "../../db";
import { customers } from "../../db/schema";
import { getPlan, listPlans } from "../billing/pricing";
import type { Tool } from "./types";

/** Change the customer's plan — propose-only, with the new monthly price. */
export const changePlan: Tool = {
  definition: {
    name: "change_plan",
    description:
      "Change the current customer's subscription plan (e.g. '2 meals/week', '3 meals/week', '4 meals/week'). Calling this shows a confirmation prompt with the new monthly price; it does NOT change the plan until the customer confirms.",
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
    if (customer?.plan === newPlan) {
      return { ok: true, summary: `Already on ${newPlan}`, data: { status: "noop", message: "The customer is already on this plan — let them know, no change needed." } };
    }
    return {
      ok: true,
      summary: `Proposed plan change to ${newPlan} ($${(plan.monthlyCents / 100).toFixed(2)}/mo)`,
      data: {
        status: "needs_confirmation",
        proposal: {
          plan: newPlan,
          monthly_cents: plan.monthlyCents,
          weekly_cents: plan.weeklyCents,
          current_plan: customer?.plan ?? null,
        },
        message:
          "A confirmation prompt shows the new plan and its monthly price. Ask the customer to confirm the change; do NOT say it's changed until they confirm.",
      },
    };
  },
};
