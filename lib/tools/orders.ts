import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { orders, transactions } from "../../db/schema";
import type { Tool } from "./types";
import { OPEN_STATUSES, ORDER_KINDS, ORDER_STATUSES, type OrderKind, type OrderSelector, type OrderStatus } from "@/lib/domain/terms";
import { selectOrder, type SelectableOrder } from "./select-order";
import { orderView, refundAmountCents } from "./order-view";

type OrderRow = typeof orders.$inferSelect;

// Re-exported so the refund tool and the refund endpoint keep importing the
// refund amount from the same place they always have.
export { refundAmountCents };

/** When this customer last had a confirmed refund (null if never) — drives the
 *  refund-frequency cooldown. Read by both the issue_refund tool and the write
 *  endpoint so the window is enforced consistently. */
export async function latestRefundAt(customerId: string): Promise<Date | null> {
  const [row] = await db
    .select({ refundedAt: orders.refundedAt })
    .from(orders)
    .where(and(eq(orders.customerId, customerId), isNotNull(orders.refundedAt)))
    .orderBy(desc(orders.refundedAt))
    .limit(1);
  return row?.refundedAt ?? null;
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
      data: { order: orderView(focus), open_order_count: openCount },
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
        orders: orderRows.slice(0, 12).map(orderView),
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
