import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents } from "@/db/schema";
import { getPlan } from "@/lib/billing/plans";
import { quotePause } from "@/lib/billing/quotes";
import type { SubStatus } from "@/lib/billing/reconcile";
import { actionRoute, type ActionBody } from "@/lib/http/action-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PauseBody extends ActionBody {
  weeks?: number;
  resumeDate?: string;
  indefinite?: boolean;
}

/** Applies a subscription pause - called by the pause confirmation prompt's
 *  Confirm button, never the model. Re-quotes the adjustment server-side and
 *  logs the status change + the deferred credit. A cancelled subscription can't
 *  be paused. */
export const POST = actionRoute<PauseBody>(async ({ body, customer, now }) => {
  const indefinite = body.indefinite === true;
  const weeks = indefinite ? null : Math.floor(Number(body.weeks));
  if (!indefinite && (!Number.isFinite(weeks!) || weeks! < 1 || weeks! > 52)) {
    return new Response("weeks must be 1-52 (or indefinite)", { status: 400 });
  }
  if (customer.subscriptionStatus === "cancelled") {
    return Response.json({ ok: false, error: "cancelled" }, { status: 409 });
  }

  // The same quote the pause card was built from, recomputed here rather than
  // trusted from the client. `adjustment_cents` is already zero when the
  // subscription was paused before this call.
  const quote = quotePause({
    status: customer.subscriptionStatus as SubStatus,
    billingDate: customer.billingDate,
    plan: await getPlan(customer.plan),
    indefinite,
    weeks,
    resumeDate: body.resumeDate?.match(/^\d{4}-\d{2}-\d{2}$/) ? body.resumeDate : null,
    now,
  });
  const adjustment = quote.adjustment_cents; // full remaining cycle; 0 if already paused

  await db
    .update(customers)
    .set({
      subscriptionStatus: "paused",
      pauseResumeDate: quote.resume_date,
      billingAdjustmentCents: customer.billingAdjustmentCents - adjustment,
      lastReconciledAt: now,
    })
    .where(eq(customers.id, customer.id));
  await db.insert(subscriptionEvents).values({
    customerId: customer.id,
    eventType: "paused",
    metadata: { weeks, resumeDate: quote.resume_date, indefinite, adjustmentCents: adjustment },
  });

  return Response.json({
    ok: true,
    weeks,
    indefinite,
    resume_date: quote.resume_date,
    net_credit_cents: quote.net_credit_cents,
    adjustment_cents: adjustment,
  });
});
