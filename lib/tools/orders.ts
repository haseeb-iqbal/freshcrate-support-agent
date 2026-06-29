import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { orders } from "../../db/schema";
import type { Tool } from "./types";

const OPEN_STATUSES = ["processing", "shipped"];

/** Read-only order lookup, scoped to the signed-in customer. Returns the
 *  requested (or most recent) order, plus the list of open orders so the agent
 *  can ask the customer to clarify when more than one is in flight (US-6). */
export const lookupOrder: Tool = {
  definition: {
    name: "lookup_order",
    description:
      "Look up an order for the current customer. If order_id is omitted, returns the most recent order. Also returns the customer's currently open (processing/shipped) orders — if there is more than one open order and the customer was vague about which, ask them to clarify before acting.",
    parameters: {
      type: "object",
      properties: {
        order_id: {
          type: "string",
          description: "Optional specific order id. Omit for the most recent order.",
        },
      },
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const orderId = args.order_id ? String(args.order_id) : undefined;

    const requested = orderId
      ? (
          await db
            .select()
            .from(orders)
            .where(and(eq(orders.customerId, ctx.customerId), eq(orders.id, orderId)))
            .limit(1)
        )[0]
      : (
          await db
            .select()
            .from(orders)
            .where(eq(orders.customerId, ctx.customerId))
            .orderBy(desc(orders.placedAt))
            .limit(1)
        )[0];

    if (!requested) {
      return {
        ok: false,
        summary: orderId
          ? `No order ${orderId} found for this customer`
          : "This customer has no orders",
      };
    }

    const open = await db
      .select({ id: orders.id, status: orders.status, deliveryDate: orders.deliveryDate })
      .from(orders)
      .where(and(eq(orders.customerId, ctx.customerId), inArray(orders.status, OPEN_STATUSES)))
      .orderBy(desc(orders.placedAt));

    return {
      ok: true,
      summary: `Found order ${requested.id.slice(0, 8)} (${requested.status})` +
        (open.length > 1 ? ` · ${open.length} open orders` : ""),
      data: {
        order: {
          id: requested.id,
          status: requested.status,
          total_cents: requested.totalCents,
          placed_at: requested.placedAt,
          delivery_date: requested.deliveryDate,
        },
        open_orders: open.map((o) => ({
          id: o.id,
          status: o.status,
          delivery_date: o.deliveryDate,
        })),
      },
    };
  },
};
