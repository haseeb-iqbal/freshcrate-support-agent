import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { orders } from "../../db/schema";
import type { Tool } from "./types";

const OPEN_STATUSES = ["processing", "shipped"];

type OrderRow = typeof orders.$inferSelect;

function view(o: OrderRow) {
  return {
    order_number: o.orderNumber,
    status: o.status,
    total_cents: o.totalCents,
    delivery_date: o.deliveryDate,
    refunded: o.refundedAt !== null,
    refunded_at: o.refundedAt ? o.refundedAt.toISOString().slice(0, 10) : null,
    items: o.items ?? [],
  };
}

/** Look up ONE order (the named one, or the most recent), scoped to the
 *  customer. Returns just that order — not the whole history — so status
 *  questions stay focused. Notes how many orders are open for the clarify case. */
export const lookupOrder: Tool = {
  definition: {
    name: "lookup_order",
    description:
      "Look up ONE order for the current customer: pass order_number for a specific order, or omit it for the most recent. Use this for questions about a particular order's status or delivery. Do NOT use it to list all orders — use list_orders for that. If the customer is vague and has more than one open order, the result says so, so you can ask which one they mean.",
    parameters: {
      type: "object",
      properties: {
        order_number: {
          type: "string",
          description: "Specific order number, e.g. FC1001. Omit for the most recent order.",
        },
      },
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const orderNumber = args.order_number ? String(args.order_number).trim() : undefined;
    const all = await db
      .select()
      .from(orders)
      .where(eq(orders.customerId, ctx.customerId))
      .orderBy(desc(orders.placedAt));

    const focus = orderNumber ? all.find((o) => o.orderNumber === orderNumber) : all[0];
    if (orderNumber && !focus) return { ok: false, summary: `No order ${orderNumber} found for this customer` };
    if (!focus) return { ok: false, summary: "This customer has no orders" };

    const openCount = all.filter((o) => OPEN_STATUSES.includes(o.status)).length;
    return {
      ok: true,
      summary:
        `Order ${focus.orderNumber}: ${focus.status}${focus.refundedAt ? ", refunded" : ""}` +
        (!orderNumber && openCount > 1 ? ` · ${openCount} open orders` : ""),
      data: { order: view(focus), open_order_count: openCount },
    };
  },
};

/** List the customer's recent order history — used ONLY for "show my orders"
 *  requests. Drives the order-history card in the UI. */
export const listOrders: Tool = {
  definition: {
    name: "list_orders",
    description:
      "List the current customer's recent order history. Use this ONLY when the customer asks to see their orders / order history (not for a single order — use lookup_order for that). The orders are shown to the customer automatically in a card.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  async handler(ctx) {
    const all = await db
      .select()
      .from(orders)
      .where(eq(orders.customerId, ctx.customerId))
      .orderBy(desc(orders.placedAt));
    return {
      ok: true,
      summary: all.length === 0 ? "No orders" : `${all.length} orders`,
      data: { orders: all.slice(0, 12).map(view) },
    };
  },
};
