import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents } from "@/db/schema";
import { reconcile } from "@/lib/billing/reconcile";
import { now } from "@/lib/clock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CancelBody {
  customerId?: string;
}

/** Cancels a subscription — called by the cancellation confirmation prompt's
 *  Confirm button, never the model. */
export async function POST(req: NextRequest) {
  let body: CancelBody;
  try {
    body = (await req.json()) as CancelBody;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { customerId } = body;
  if (!customerId) return new Response("Missing customerId", { status: 400 });

  await reconcile(customerId, now());
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return new Response("Unknown customer", { status: 404 });
  if (customer.subscriptionStatus === "cancelled") {
    // A replayed confirmation must not add a second entry to the status trail.
    return Response.json({ ok: false, error: "already_cancelled" }, { status: 409 });
  }

  await db.update(customers).set({ subscriptionStatus: "cancelled", pauseResumeDate: null }).where(eq(customers.id, customerId));
  await db.insert(subscriptionEvents).values({
    customerId,
    eventType: "cancelled",
    metadata: { billingDate: customer.billingDate },
  });

  return Response.json({ ok: true });
}
