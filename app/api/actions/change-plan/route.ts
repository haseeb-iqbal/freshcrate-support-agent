import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents, transactions } from "@/db/schema";
import { getPlan, prorationCents, weeksUntilDate } from "@/lib/billing/pricing";
import { reconcile } from "@/lib/billing/reconcile";
import { now } from "@/lib/clock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChangePlanBody {
  customerId?: string;
  plan?: string;
}

/** Applies a plan change, records the prorated charge/refund, and logs the
 *  status change. Called by the confirmation prompt, never the model. */
export async function POST(req: NextRequest) {
  let body: ChangePlanBody;
  try {
    body = (await req.json()) as ChangePlanBody;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { customerId, plan: newPlan } = body;
  if (!customerId || !newPlan) return new Response("Missing customerId or plan", { status: 400 });

  const plan = await getPlan(newPlan);
  if (!plan) return Response.json({ ok: false, error: "unknown_plan" }, { status: 400 });

  await reconcile(customerId, now());
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return new Response("Unknown customer", { status: 404 });
  if (customer.subscriptionStatus === "cancelled") {
    return Response.json({ ok: false, error: "cancelled" }, { status: 409 });
  }
  if (customer.subscriptionStatus === "paused") {
    // Plan changes aren't allowed while paused — resume with new_plan instead.
    return Response.json({ ok: false, error: "paused" }, { status: 409 });
  }

  const currentPlan = await getPlan(customer.plan);
  const weeksLeft = weeksUntilDate(customer.billingDate, now());
  const proration = currentPlan ? prorationCents(currentPlan.weeklyCents, plan.weeklyCents, weeksLeft) : 0;

  await db.update(customers).set({ plan: newPlan }).where(eq(customers.id, customerId));
  await db.insert(subscriptionEvents).values({
    customerId,
    eventType: "plan_changed",
    metadata: { from: customer.plan, to: newPlan },
  });
  if (proration !== 0) {
    await db.insert(transactions).values({
      customerId,
      type: "proration",
      amountCents: proration,
      description: proration > 0 ? `Plan upgrade proration → ${newPlan}` : `Plan downgrade credit → ${newPlan}`,
    });
  }

  return Response.json({ ok: true, plan: newPlan, monthly_cents: plan.monthlyCents, proration_cents: proration });
}
