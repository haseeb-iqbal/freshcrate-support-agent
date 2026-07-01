import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { orders, transactions } from "../../db/schema";
import type { Tool } from "./types";

const OPEN_STATUSES = ["processing", "shipped"];

type OrderRow = typeof orders.$inferSelect;

const addOnSum = (o: OrderRow) => (o.addOns ?? []).reduce((s, a) => s + a.priceCents, 0);

/** Refund amount for an order: the meal's list (undiscounted) price plus add-ons,
 *  for both subscription and extra meals. */
export const refundAmountCents = (o: OrderRow) => o.listPriceCents + addOnSum(o);

function view(o: OrderRow) {
  return {
    order_number: o.orderNumber,
    kind: o.kind, // subscription | extra
    status: o.status,
    charged_cents: o.totalCents, // 0 for a subscription meal (free)
    list_price_cents: o.listPriceCents, // undiscounted meal price
    add_ons: o.addOns ?? [],
    refund_cents: refundAmountCents(o),
    delivery_date: o.deliveryDate,
    refunded: o.refundedAt !== null,
    refunded_at: o.refundedAt ? o.refundedAt.toISOString().slice(0, 10) : null,
    items: o.items ?? [],
  };
}

/** Look up ONE order (named or most recent), scoped to the customer. */
export const lookupOrder: Tool = {
  definition: {
    name: "lookup_order",
    description:
      "Look up ONE order for the current customer: pass order_number for a specific order, or omit it for the most recent. Use for questions about a particular order's status, price, or delivery. Do NOT use it to list all orders — use list_orders. If the customer is vague and has more than one open order, the result says so.",
    parameters: {
      type: "object",
      properties: {
        order_number: { type: "string", description: "Specific order number, e.g. FC1001. Omit for the most recent." },
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
        `Order ${focus.orderNumber}: ${focus.kind} meal, ${focus.status}${focus.refundedAt ? ", refunded" : ""}` +
        (!orderNumber && openCount > 1 ? ` · ${openCount} open orders` : ""),
      data: { order: view(focus), open_order_count: openCount },
    };
  },
};

/** List the customer's recent meal orders + money transactions as a unified
 *  history — used ONLY for "show my orders/history" requests. Drives the card. */
export const listOrders: Tool = {
  definition: {
    name: "list_orders",
    description:
      "Show the current customer's order & billing history (meal orders plus payments, fees, and refunds). Use this ONLY when the customer asks to see their orders / order history / transactions. The details are shown to them in a card automatically.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  async handler(ctx) {
    const orderRows = await db
      .select()
      .from(orders)
      .where(eq(orders.customerId, ctx.customerId))
      .orderBy(desc(orders.placedAt));
    const txns = await db
      .select()
      .from(transactions)
      .where(eq(transactions.customerId, ctx.customerId))
      .orderBy(desc(transactions.createdAt));

    return {
      ok: true,
      summary: `${orderRows.length} orders, ${txns.length} transactions`,
      data: {
        orders: orderRows.slice(0, 12).map(view),
        transactions: txns.slice(0, 12).map((t) => ({
          type: t.type,
          amount_cents: t.amountCents,
          description: t.description,
          order_number: t.orderNumber,
          date: t.createdAt.toISOString().slice(0, 10),
        })),
      },
    };
  },
};
