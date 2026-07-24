import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents } from "@/db/schema";
import { actionRoute, type ActionBody } from "@/lib/http/action-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cancels a subscription — called by the cancellation confirmation prompt's
 *  Confirm button, never the model. */
export const POST = actionRoute<ActionBody>(async ({ customer }) => {
  if (customer.subscriptionStatus === "cancelled") {
    // A replayed confirmation must not add a second entry to the status trail.
    return Response.json({ ok: false, error: "already_cancelled" }, { status: 409 });
  }

  await db
    .update(customers)
    .set({ subscriptionStatus: "cancelled", pauseResumeDate: null })
    .where(eq(customers.id, customer.id));
  await db.insert(subscriptionEvents).values({
    customerId: customer.id,
    eventType: "cancelled",
    metadata: { billingDate: customer.billingDate },
  });

  return Response.json({ ok: true });
});
