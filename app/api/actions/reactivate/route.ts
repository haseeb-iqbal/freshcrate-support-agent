import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents, transactions } from "@/db/schema";
import { getPlan } from "@/lib/billing/plans";
import { quoteReactivate } from "@/lib/billing/quotes";
import { actionRoute, type ActionBody } from "@/lib/http/action-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReactivateBody extends ActionBody {
  newPlan?: string;
}

/** Reactivates a CANCELLED subscription (optionally switching plan). Free within
 *  the billing period on the same plan; otherwise charges plan price + sign-up
 *  fee. Called by the confirmation prompt, never the model; re-quotes server-side. */
export const POST = actionRoute<ReactivateBody>(async ({ body, customer, now }) => {
  if (customer.subscriptionStatus !== "cancelled") {
    return Response.json({ ok: false, error: "not_cancelled" }, { status: 409 });
  }

  const requestedPlan = body.newPlan?.trim();
  const plan = await getPlan(requestedPlan || customer.plan);
  if (!plan) return Response.json({ ok: false, error: "unknown_plan" }, { status: 400 });

  const quote = quoteReactivate({
    currentPlan: customer.plan,
    billingDate: customer.billingDate,
    plan,
    requestedPlan,
    now,
  });
  const { plan: effectivePlan, plan_changed: planChanged, free, signup_fee_cents: signupFee } = quote;

  await db
    .update(customers)
    .set({
      subscriptionStatus: "active",
      plan: effectivePlan,
      pauseResumeDate: null,
      // Advanced past `now` unless the old date is still ahead — see the note on
      // `next_billing_date` in quotes.ts.
      billingDate: quote.next_billing_date,
    })
    .where(eq(customers.id, customer.id));

  // Status-change audit.
  await db.insert(subscriptionEvents).values({ customerId: customer.id, eventType: "reactivated", metadata: { free, plan: effectivePlan } });
  if (planChanged) {
    await db.insert(subscriptionEvents).values({ customerId: customer.id, eventType: "plan_changed", metadata: { from: customer.plan, to: effectivePlan } });
  }

  // Ledger.
  if (!free) {
    if (signupFee > 0) {
      await db.insert(transactions).values({ customerId: customer.id, type: "signup_fee", amountCents: signupFee, description: "Reactivation sign-up fee" });
    }
    await db.insert(transactions).values({ customerId: customer.id, type: "monthly_billing", amountCents: plan.monthlyCents, description: `Monthly billing — ${effectivePlan}` });
  }

  return Response.json({ ok: true, plan: effectivePlan, total_cents: quote.total_cents, free });
});
