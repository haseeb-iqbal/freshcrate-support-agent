import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { customers } from "../../../db/schema";
import { getPlan } from "../../billing/plans";
import { quoteResume } from "../../billing/quotes";
import { money } from "../../money";
import { resumeLeadIn } from "../lead-ins";
import type { Tool } from "../types";
import { PAUSE_FEE_PER_WEEK } from "./fee";

/**
 * Resume is propose-only. Optionally switch plan at the same time (new_plan).
 * Resuming returns the weeks left to billing to the plan's weekly rate (they no
 * longer bill at the $8 pause fee), which is deferred to the next monthly bill;
 * the plan resumes from next week. Applied via /api/actions/resume on confirm.
 */
export const resumeSubscription: Tool = {
  definition: {
    name: "resume_subscription",
    description:
      "Resume the current customer's PAUSED subscription. Optionally pass new_plan (e.g. '3 meals/week') to resume AND switch plan in one step. Calling this shows a confirmation prompt with the resume charge; it does NOT resume or charge until they confirm. NOT for a cancelled subscription — that needs reactivate_subscription. Don't ask them to confirm before calling. Call this ONLY when the customer is asking to resume (or resume-and-switch). Do NOT call it to answer a QUESTION about resuming or about their next bill while paused - answer that in words, using get_subscription for any figure.",
    parameters: {
      type: "object",
      properties: {
        new_plan: { type: "string", description: "Optional plan to switch to while resuming (e.g. '3 meals/week')." },
      },
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };
    if (customer.subscriptionStatus === "cancelled") {
      return { ok: true, summary: "Cancelled — needs reactivation", data: { status: "cancelled", redirect_to: "reactivate_subscription", message: "The subscription is cancelled, not paused. Use reactivate_subscription instead." } };
    }
    if (customer.subscriptionStatus !== "paused") {
      return { ok: true, summary: `Already ${customer.subscriptionStatus}`, data: { status: customer.subscriptionStatus, message: "Nothing to resume — tell the customer their current status." } };
    }

    const requestedPlan = args.new_plan ? String(args.new_plan).trim() : undefined;
    const plan = await getPlan(requestedPlan || customer.plan);
    if (!plan) return { ok: false, summary: `Unknown plan "${requestedPlan}"`, data: { message: "That plan doesn't exist — ask the customer to pick 2, 3, or 4 meals/week." } };

    // The same quote /api/actions/resume applies on confirm.
    const proposal = quoteResume({
      currentPlan: customer.plan,
      billingDate: customer.billingDate,
      plan,
      requestedPlan,
      billingAdjustmentCents: customer.billingAdjustmentCents,
      now: ctx.now,
    });
    const charge = money(proposal.charge_cents);
    const nextBill = money(proposal.next_bill_cents);

    return {
      ok: true,
      summary: proposal.plan_changed
        ? `Proposed resume on ${proposal.plan} - next bill ${nextBill}`
        : `Proposed resume - next bill ${nextBill}`,
      data: {
        status: "needs_confirmation",
        proposal,
        lead_in: resumeLeadIn(proposal),
        message:
          `A confirmation prompt shows the resume. Nothing is charged now: resuming returns the weeks left until billing to the normal weekly rate (they stop billing at the ${PAUSE_FEE_PER_WEEK} pause fee), which adds ${charge}, so their next monthly bill will be exactly ${nextBill}. The plan resumes from next week. The card shows the exact ${nextBill} figure - do NOT state a different amount in your reply; keep it to a short lead-in and ask them to confirm. Do NOT say it's resumed until they confirm.`,
      },
    };
  },
};
