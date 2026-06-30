import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents } from "@/db/schema";

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

  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return new Response("Unknown customer", { status: 404 });

  await db.update(customers).set({ subscriptionStatus: "cancelled" }).where(eq(customers.id, customerId));
  await db.insert(subscriptionEvents).values({
    customerId,
    eventType: "cancelled",
    metadata: { billingDate: customer.billingDate },
  });

  return Response.json({ ok: true });
}
