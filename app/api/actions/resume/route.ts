import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents, transactions } from "@/db/schema";
import { getPlan, resumeChargeCents, weeksUntilDate } from "@/lib/billing/pricing";
import { reconcile } from "@/lib/billing/reconcile";
import { now } from "@/lib/clock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResumeBody {
  customerId?: string;
  newPlan?: string;
}

/** Resumes a PAUSED subscription — called by the resume confirmation prompt's
 *  Confirm button, never the model. Recomputes the resume charge server-side
 *  (weeks to billing at the resulting plan's weekly rate, net of the $8/week
 *  pause fee), optionally switches plan, and logs the charge. */
export async function POST(req: NextRequest) {
  let body: ResumeBody;
  try {
    body = (await req.json()) as ResumeBody;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { customerId } = body;
  if (!customerId) return new Response("Missing customerId", { status: 400 });

  await reconcile(customerId, now());
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return new Response("Unknown customer", { status: 404 });
  if (customer.subscriptionStatus !== "paused") {
    return Response.json({ ok: false, error: "not_paused" }, { status: 409 });
  }

  const requestedPlan = body.newPlan?.trim();
  const effectivePlan = requestedPlan || customer.plan;
  const plan = await getPlan(effectivePlan);
  if (!plan) return Response.json({ ok: false, error: "unknown_plan" }, { status: 400 });

  const planChanged = !!requestedPlan && requestedPlan !== customer.plan;
  const charge = resumeChargeCents(plan.weeklyCents, weeksUntilDate(customer.billingDate, now()));

  await db
    .update(customers)
    .set({ subscriptionStatus: "active", plan: effectivePlan, pauseResumeDate: null })
    .where(eq(customers.id, customerId));
  await db.insert(subscriptionEvents).values({
    customerId,
    eventType: "resumed",
    metadata: planChanged ? { newPlan: effectivePlan, chargeCents: charge } : { chargeCents: charge },
  });
  if (planChanged) {
    await db.insert(subscriptionEvents).values({
      customerId,
      eventType: "plan_changed",
      metadata: { from: customer.plan, to: effectivePlan, viaResume: true },
    });
  }
  if (charge > 0) {
    await db.insert(transactions).values({
      customerId,
      type: "resume_charge",
      amountCents: charge,
      description: planChanged ? `Resume charge (switched to ${effectivePlan})` : "Resume charge",
    });
  }

  return Response.json({ ok: true, plan: effectivePlan, plan_changed: planChanged, charge_cents: charge });
}
