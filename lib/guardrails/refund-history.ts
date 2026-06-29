import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { subscriptionEvents } from "../../db/schema";

/**
 * True if this customer already has a refund logged for the given order number.
 * Used to block a second automatic refund on the same order — repeat refunds
 * must go through a human (PRD-adjacent safeguard).
 */
export async function orderAlreadyRefunded(
  customerId: string,
  orderNumber: string,
): Promise<boolean> {
  const events = await db
    .select({ metadata: subscriptionEvents.metadata })
    .from(subscriptionEvents)
    .where(
      and(
        eq(subscriptionEvents.customerId, customerId),
        eq(subscriptionEvents.eventType, "refund"),
      ),
    );
  return events.some(
    (e) => (e.metadata as { orderNumber?: string } | null)?.orderNumber === orderNumber,
  );
}
