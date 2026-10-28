import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { customers } from "../../../db/schema";
import { SIGNUP_FEE_CENTS } from "../../billing/pricing";
import { cancelLeadIn } from "../lead-ins";
import type { Tool } from "../types";

/** Cancel an ACTIVE/PAUSED subscription — propose-only, with a resubscription
 *  sign-up-fee warning. */
export const cancelSubscription: Tool = {
  definition: {
    name: "cancel_subscription",
    description:
      "Cancel the current customer's subscription. Call this immediately when the customer asks to cancel — calling it shows the confirmation prompt (which warns that resubscribing after the billing date costs a sign-up fee). It does NOT cancel until they confirm. Don't ask them to confirm before calling.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  async handler(ctx) {
    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };
    if (customer.subscriptionStatus === "cancelled") {
      return { ok: true, summary: "Already cancelled", data: { status: "cancelled", message: "Already cancelled — let the customer know." } };
    }
    return {
      ok: true,
      summary: "Proposed cancellation — awaiting confirmation",
      data: {
        status: "needs_confirmation",
        proposal: { billing_date: customer.billingDate, signup_fee_cents: SIGNUP_FEE_CENTS },
        lead_in: cancelLeadIn({ billing_date: customer.billingDate, signup_fee_cents: SIGNUP_FEE_CENTS }),
        message:
          "A cancellation prompt is shown. The month is already paid, so boxes keep arriving until the billing date and nothing more is charged after it. Resubscribing after the billing date costs a sign-up fee plus the first month (before then, same plan, is free). Briefly relay that and ask them to confirm. Do NOT say it's cancelled until they confirm.",
      },
    };
  },
};
