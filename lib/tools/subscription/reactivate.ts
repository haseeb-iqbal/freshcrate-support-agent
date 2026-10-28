import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { customers } from "../../../db/schema";
import { getPlan } from "../../billing/plans";
import { quoteReactivate } from "../../billing/quotes";
import { money } from "../../money";
import { reactivateLeadIn } from "../lead-ins";
import type { Tool } from "../types";

/**
 * Reactivate a CANCELLED subscription — propose-only. Optionally switch plan at
 * the same time. Within the billing period on the same plan it's FREE (no fee,
 * no charge); otherwise the first charge is the plan price + a sign-up fee.
 */
export const reactivateSubscription: Tool = {
  definition: {
    name: "reactivate_subscription",
    description:
      "Reactivate a CANCELLED subscription. Call this immediately when a cancelled customer wants to start again. Optionally pass new_plan (e.g. '3 meals/week') to reactivate AND switch plan in one step. Shows a confirmation prompt with the cost; it does NOT reactivate or charge until they confirm. Don't ask them to confirm before calling.",
    parameters: {
      type: "object",
      properties: {
        new_plan: { type: "string", description: "Optional plan to switch to while reactivating (e.g. '3 meals/week')." },
      },
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };
    if (customer.subscriptionStatus !== "cancelled") {
      return {
        ok: true,
        summary: `${customer.subscriptionStatus}, not cancelled`,
        data: {
          status: customer.subscriptionStatus,
          ...(customer.subscriptionStatus === "paused" ? { redirect_to: args.new_plan ? "change_plan" : "resume_subscription" } : {}),
          message:
            customer.subscriptionStatus === "paused" && args.new_plan
              ? "Paused, not cancelled - no reactivation needed. To switch plan, call change_plan with that plan now: it switches the plan and keeps the subscription paused. Use resume_subscription with new_plan only if they also asked to resume."
              : "Not cancelled — no reactivation needed. If paused, use resume_subscription to restart it.",
        },
      };
    }

    const requestedPlan = args.new_plan ? String(args.new_plan).trim() : undefined;
    const plan = await getPlan(requestedPlan || customer.plan);
    if (!plan) return { ok: false, summary: `Unknown plan "${requestedPlan}"`, data: { message: "That plan doesn't exist — ask the customer to pick 2, 3, or 4 meals/week." } };

    // The same quote /api/actions/reactivate applies on confirm.
    const proposal = quoteReactivate({
      currentPlan: customer.plan,
      billingDate: customer.billingDate,
      plan,
      requestedPlan,
      now: ctx.now,
    });
    const free = proposal.free;

    return {
      ok: true,
      summary: free
        ? "Proposed reactivation — free (within billing period, same plan)"
        : `Proposed reactivation on ${proposal.plan} — first charge ${money(proposal.total_cents)}`,
      data: {
        status: "needs_confirmation",
        proposal,
        lead_in: reactivateLeadIn(proposal),
        message: free
          ? "The customer is within their billing period on the same plan, so reactivation is FREE (no charge). Ask them to confirm; do NOT say it's done until they confirm."
          : "A confirmation prompt shows the first charge (plan price plus sign-up fee where it applies). Ask them to confirm before it's charged; do NOT say it's reactivated until they confirm.",
      },
    };
  },
};
