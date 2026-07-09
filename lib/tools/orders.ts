import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { orders, transactions } from "../../db/schema";
import type { Tool } from "./types";
import { OPEN_STATUSES, ORDER_KINDS, ORDER_STATUSES, type OrderKind, type OrderSelector, type OrderStatus } from "@/lib/domain/terms";
import { selectOrder, type SelectableOrder } from "./select-order";

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

/** Look up ONE order for the current customer, by number, position, kind, or status. */
export const lookupOrder: Tool = {
  definition: {
    name: "lookup_order",
    description:
      "Look up ONE order for the current customer. Use order_number for a specific order (e.g. FC1002); use position for a relative one (1 = most recent, 2 = 2nd most recent, …); narrow with kind (subscription|extra) and/or status. Omit everything for the most recent order. Use this — NOT list_orders — whenever the customer means a single order, including 'my last order', 'my 2nd last order', or 'my most recent extra meal'. list_orders is only for showing the full history.",
    parameters: {
      type: "object",
      properties: {
        order_number: { type: "string", description: "Specific order number, e.g. FC1001." },
        position: { type: "integer", minimum: 1, description: "1 = most recent, 2 = 2nd most recent, …" },
        kind: { type: "string", enum: [...ORDER_KINDS], description: "subscription (plan meal) or extra." },
        status: { type: "string", enum: [...ORDER_STATUSES], description: "Filter to this status." },
      },
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const all = await db
      .select()
      .from(orders)
      .where(eq(orders.customerId, ctx.customerId))
      .orderBy(desc(orders.placedAt));

    const posRaw = args.position;
    const sel: OrderSelector = {
      orderNumber: args.order_number ? String(args.order_number).trim() : undefined,
      position: posRaw === undefined || posRaw === null ? undefined : Number(posRaw),
      kind: (ORDER_KINDS as readonly string[]).includes(String(args.kind)) ? (args.kind as OrderKind) : undefined,
      status: (ORDER_STATUSES as readonly string[]).includes(String(args.status)) ? (args.status as OrderStatus) : undefined,
    };

    const focus = selectOrder(all as unknown as SelectableOrder[], sel) as OrderRow | null;
    if (!focus) {
      return { ok: false, summary: "No matching order found for this customer" };
    }
    const openCount = all.filter((o) => (OPEN_STATUSES as readonly string[]).includes(o.status)).length;
    return {
      ok: true,
      summary: `Order ${focus.orderNumber}: ${focus.kind} meal, ${focus.status}${focus.refundedAt ? ", refunded" : ""}`,
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
