import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { orders, subscriptionEvents } from "../../db/schema";
import type { Tool } from "./types";

/**
 * Write tool: issue a (simulated) refund for one of the customer's orders by
 * logging a refund event. Scoped — the order must belong to the signed-in
 * customer. The human-in-the-loop confirmation and refund ceiling are added in
 * Phase 4; in Phase 3 the tool performs the write directly.
 */
export const issueRefund: Tool = {
  definition: {
    name: "issue_refund",
    description:
      "Issue a refund for a specific order belonging to the current customer (e.g. a damaged or undelivered box). Requires the order_id and a brief reason. If you don't have the order_id, look it up first.",
    parameters: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "The order to refund." },
        reason: { type: "string", description: "Why the refund is being issued." },
      },
      required: ["order_id", "reason"],
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const orderId = String(args.order_id ?? "").trim();
    const reason = String(args.reason ?? "").trim() || "No reason given";
    if (!orderId) return { ok: false, summary: "An order_id is required to refund." };

    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.customerId, ctx.customerId)))
      .limit(1);

    if (!order) {
      return { ok: false, summary: `No order ${orderId} found for this customer` };
    }

    await db.insert(subscriptionEvents).values({
      customerId: ctx.customerId,
      eventType: "refund",
      metadata: { orderId, reason, amountCents: order.totalCents },
    });

    return {
      ok: true,
      summary: `Refunded $${(order.totalCents / 100).toFixed(2)} for order ${orderId.slice(0, 8)}`,
      data: { order_id: orderId, amount_cents: order.totalCents, reason },
    };
  },
};
