import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents } from "@/db/schema";
import { SIGNUP_FEE_CENTS } from "@/lib/billing/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReactivateBody {
  customerId?: string;
}

/** Reactivates a CANCELLED subscription and charges the sign-up fee — called by
 *  the reactivation confirmation prompt's Confirm button, never the model. */
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

  await db.update(customers).set({ subscriptionStatus: "active" }).where(eq(customers.id, customerId));
  await db.insert(subscriptionEvents).values({
    customerId,
    eventType: "reactivated",
    metadata: { signupFeeCents: SIGNUP_FEE_CENTS },
  });

  return Response.json({ ok: true, signup_fee_cents: SIGNUP_FEE_CENTS });
}
