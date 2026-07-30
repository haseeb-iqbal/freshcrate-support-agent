import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents } from "@/db/schema";
import { getPlan } from "@/lib/billing/plans";
import { quoteResume } from "@/lib/billing/quotes";
import { actionRoute, type ActionBody } from "@/lib/http/action-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResumeBody extends ActionBody {
  newPlan?: string;
}

/** Resumes a PAUSED subscription - called by the resume confirmation prompt's
 *  Confirm button, never the model. Re-quotes the resume charge server-side
 *  (weeks to billing at the resulting plan's full weekly rate), optionally
 *  switches plan, and defers the charge to the next monthly bill. */
export const POST = actionRoute<ResumeBody>(async ({ body, customer, now }) => {
  if (customer.subscriptionStatus !== "paused") {
    return Response.json({ ok: false, error: "not_paused" }, { status: 409 });
  }

  const requestedPlan = body.newPlan?.trim();
  const plan = await getPlan(requestedPlan || customer.plan);
  if (!plan) return Response.json({ ok: false, error: "unknown_plan" }, { status: 400 });

  const quote = quoteResume({
    currentPlan: customer.plan,
    billingDate: customer.billingDate,
    plan,
    requestedPlan,
    now,
  });
  const { plan: effectivePlan, plan_changed: planChanged, charge_cents: charge } = quote;

  await db
    .update(customers)
    .set({
      subscriptionStatus: "active",
      plan: effectivePlan,
      pauseResumeDate: null,
      billingAdjustmentCents: customer.billingAdjustmentCents + quote.charge_cents,
    })
    .where(eq(customers.id, customer.id));
  await db.insert(subscriptionEvents).values({
    customerId: customer.id,
    eventType: "resumed",
    metadata: planChanged ? { newPlan: effectivePlan, chargeCents: charge } : { chargeCents: charge },
  });
  if (planChanged) {
    await db.insert(subscriptionEvents).values({
      customerId: customer.id,
      eventType: "plan_changed",
      metadata: { from: customer.plan, to: effectivePlan, viaResume: true },
    });
  }

  return Response.json({ ok: true, plan: effectivePlan, plan_changed: planChanged, charge_cents: quote.charge_cents, next_bill_cents: quote.next_bill_cents });
});
