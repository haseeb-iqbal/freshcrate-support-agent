import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents } from "@/db/schema";
import { SIGNUP_FEE_CENTS, getPlan, withinBillingPeriod } from "@/lib/billing/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReactivateBody {
  customerId?: string;
}

/** Reactivates a CANCELLED subscription, charging the plan price plus a sign-up
 *  fee — UNLESS the customer is still within their billing period (then the fee
 *  is waived). Called by the confirmation prompt's Confirm button, never the
 *  model; recomputes the fee server-side. */
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

  const plan = await getPlan(customer.plan);
  const monthly = plan?.monthlyCents ?? 0;
  const signupFee = withinBillingPeriod(customer.billingDate) ? 0 : SIGNUP_FEE_CENTS;
  const total = monthly + signupFee;

  await db.update(customers).set({ subscriptionStatus: "active" }).where(eq(customers.id, customerId));
  await db.insert(subscriptionEvents).values({
    customerId,
    eventType: "reactivated",
    metadata: { signupFeeCents: signupFee, monthlyCents: monthly, totalCents: total },
  });

  return Response.json({ ok: true, signup_fee_cents: signupFee, total_cents: total });
}
