import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { orders } from "../../db/schema";
import type { Tool } from "./types";

const OPEN_STATUSES = ["processing", "shipped"];
const MAX_HISTORY = 12;

/** Read-only order lookup, scoped to the signed-in customer. Returns the
 *  requested (or most recent) order AND the customer's recent order history,
 *  each flagged with whether it has been refunded — so the agent can answer
 *  history questions and report refund state, and ask the customer to clarify
 *  when more than one order is open (US-6). Orders use short numbers (FC1001). */
export const lookupOrder: Tool = {
  definition: {
    name: "lookup_order",
    description:
      "Look up orders for the current customer. If order_number is omitted, the focus is the most recent order. Returns that order plus the customer's recent order history (with order numbers, status, amount, and whether each has been refunded). Use it for status questions AND for 'show my orders' history questions. If more than one order is open (processing/shipped) and the customer was vague, ask which one. Order numbers look like FC1001.",
    parameters: {
      type: "object",
      properties: {
        order_number: {
          type: "string",
          description: "Optional specific order number (e.g. FC1001). Omit to focus on the most recent order.",
        },
      },
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const orderNumber = args.order_number ? String(args.order_number).trim() : undefined;

    // One scoped query: the customer's orders, newest first.
    const all = await db
      .select()
      .from(orders)
      .where(eq(orders.customerId, ctx.customerId))
      .orderBy(desc(orders.placedAt));

    const focus = orderNumber ? all.find((o) => o.orderNumber === orderNumber) : all[0];

    if (orderNumber && !focus) {
      return { ok: false, summary: `No order ${orderNumber} found for this customer` };
    }
    if (all.length === 0 || !focus) {
      return { ok: false, summary: "This customer has no orders" };
    }

    const view = (o: (typeof all)[number]) => ({
      order_number: o.orderNumber,
      status: o.status,
      total_cents: o.totalCents,
      delivery_date: o.deliveryDate,
      refunded: o.refundedAt !== null,
      refunded_at: o.refundedAt ? o.refundedAt.toISOString().slice(0, 10) : null,
      items: o.items ?? [],
    });

    const openCount = all.filter((o) => OPEN_STATUSES.includes(o.status)).length;

    return {
      ok: true,
      summary:
        `Found order ${focus.orderNumber} (${focus.status}${focus.refundedAt ? ", refunded" : ""})` +
        (openCount > 1 ? ` · ${openCount} open orders` : ""),
      data: {
        order: view(focus),
        orders: all.slice(0, MAX_HISTORY).map(view),
      },
    };
  },
};
