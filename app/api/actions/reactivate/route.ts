import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents, transactions } from "@/db/schema";
import { SIGNUP_FEE_CENTS, getPlan, withinBillingPeriod } from "@/lib/billing/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReactivateBody {
  customerId?: string;
  newPlan?: string;
}

/** Reactivates a CANCELLED subscription (optionally switching plan). Free within
 *  the billing period on the same plan; otherwise charges plan price + sign-up
 *  fee. Called by the confirmation prompt, never the model; recomputes server-side. */
export async function POST(req: NextRequest) {
  let body: ReactivateBody;
  try {
    body = (await req.json()) as ReactivateBody;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { customerId } = body;
  if (!customerId) return new Response("Missing customerId", { status: 400 });

  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return new Response("Unknown customer", { status: 404 });
  if (customer.subscriptionStatus !== "cancelled") {
    return Response.json({ ok: false, error: "not_cancelled" }, { status: 409 });
  }

  const requestedPlan = body.newPlan?.trim();
  const effectivePlan = requestedPlan || customer.plan;
  const plan = await getPlan(effectivePlan);
  if (!plan) return Response.json({ ok: false, error: "unknown_plan" }, { status: 400 });

  const planChanged = !!requestedPlan && requestedPlan !== customer.plan;
  const within = withinBillingPeriod(customer.billingDate);
  const free = within && !planChanged;
  const signupFee = within ? 0 : SIGNUP_FEE_CENTS;
  const total = free ? 0 : plan.monthlyCents + signupFee;

  await db.update(customers).set({ subscriptionStatus: "active", plan: effectivePlan }).where(eq(customers.id, customerId));

  // Status-change audit.
  await db.insert(subscriptionEvents).values({ customerId, eventType: "reactivated", metadata: { free, plan: effectivePlan } });
  if (planChanged) {
    await db.insert(subscriptionEvents).values({ customerId, eventType: "plan_changed", metadata: { from: customer.plan, to: effectivePlan } });
  }

  // Ledger.
  if (!free) {
    if (signupFee > 0) {
      await db.insert(transactions).values({ customerId, type: "signup_fee", amountCents: signupFee, description: "Reactivation sign-up fee" });
    }
    await db.insert(transactions).values({ customerId, type: "monthly_billing", amountCents: plan.monthlyCents, description: `Monthly billing — ${effectivePlan}` });
  }

  return Response.json({ ok: true, plan: effectivePlan, total_cents: total, free });
}
