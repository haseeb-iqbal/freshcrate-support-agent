import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents, transactions } from "@/db/schema";
import { getPlan } from "@/lib/billing/plans";
import { quotePlanChange } from "@/lib/billing/quotes";
import { actionRoute, type ActionBody } from "@/lib/http/action-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChangePlanBody extends ActionBody {
  plan?: string;
}

/** Applies a plan change, records the prorated charge/refund, and logs the
 *  status change. Called by the confirmation prompt, never the model. */
export const POST = actionRoute<ChangePlanBody>(async ({ body, customer, now }) => {
  const newPlan = body.plan;
  if (!newPlan) return new Response("Missing plan", { status: 400 });

  // Checked before the status guards: an unknown plan is a bad request whatever
  // state the subscription is in.
  const plan = await getPlan(newPlan);
  if (!plan) return Response.json({ ok: false, error: "unknown_plan" }, { status: 400 });

  if (customer.subscriptionStatus === "cancelled") {
    return Response.json({ ok: false, error: "cancelled" }, { status: 409 });
  }
  if (customer.subscriptionStatus === "paused") {
    // Plan changes aren't allowed while paused — resume with new_plan instead.
    return Response.json({ ok: false, error: "paused" }, { status: 409 });
  }
  if (customer.plan === newPlan) {
    // Nothing to change — do not log a plan_changed event for a non-change.
    return Response.json({ ok: false, error: "same_plan" }, { status: 409 });
  }

  const quote = quotePlanChange({
    currentPlan: await getPlan(customer.plan),
    billingDate: customer.billingDate,
    plan,
    now,
  });
  const proration = quote.proration_cents;

  await db.update(customers).set({ plan: newPlan }).where(eq(customers.id, customer.id));
  await db.insert(subscriptionEvents).values({
    customerId: customer.id,
    eventType: "plan_changed",
    metadata: { from: customer.plan, to: newPlan },
  });
  if (proration !== 0) {
    await db.insert(transactions).values({
      customerId: customer.id,
      type: "proration",
      amountCents: proration,
      description: proration > 0 ? `Plan upgrade proration → ${newPlan}` : `Plan downgrade credit → ${newPlan}`,
    });
  }

  return Response.json({ ok: true, plan: newPlan, monthly_cents: plan.monthlyCents, proration_cents: proration });
});
