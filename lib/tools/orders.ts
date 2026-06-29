import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { orders } from "../../db/schema";
import type { Tool } from "./types";

const OPEN_STATUSES = ["processing", "shipped"];

/** Read-only order lookup, scoped to the signed-in customer. Orders are
 *  identified by their short order number (e.g. FC1001). Returns the requested
 *  (or most recent) order plus the customer's open orders so the agent can ask
 *  the customer to clarify when more than one is in flight (US-6). */
export const lookupOrder: Tool = {
  definition: {
    name: "lookup_order",
    description:
      "Look up an order for the current customer. If order_number is omitted, returns the most recent order. Also returns the customer's open (processing/shipped) orders — if there is more than one open order and the customer was vague, ask them which one before acting. Order numbers look like FC1001.",
    parameters: {
      type: "object",
      properties: {
        order_number: {
          type: "string",
          description: "Optional specific order number (e.g. FC1001). Omit for the most recent order.",
        },
      },
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const orderNumber = args.order_number ? String(args.order_number).trim() : undefined;

    const requested = orderNumber
      ? (
          await db
            .select()
            .from(orders)
            .where(and(eq(orders.customerId, ctx.customerId), eq(orders.orderNumber, orderNumber)))
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
        summary: orderNumber
          ? `No order ${orderNumber} found for this customer`
          : "This customer has no orders",
      };
    }

    const open = await db
      .select({ orderNumber: orders.orderNumber, status: orders.status, deliveryDate: orders.deliveryDate })
      .from(orders)
      .where(and(eq(orders.customerId, ctx.customerId), inArray(orders.status, OPEN_STATUSES)))
      .orderBy(desc(orders.placedAt));

    return {
      ok: true,
      summary:
        `Found order ${requested.orderNumber} (${requested.status})` +
        (open.length > 1 ? ` · ${open.length} open orders` : ""),
      data: {
        order: {
          order_number: requested.orderNumber,
          status: requested.status,
          total_cents: requested.totalCents,
          placed_at: requested.placedAt,
          delivery_date: requested.deliveryDate,
        },
        open_orders: open.map((o) => ({
          order_number: o.orderNumber,
          status: o.status,
          delivery_date: o.deliveryDate,
        })),
      },
    };
  },
};
