import { toIsoDate } from "@/lib/date";
import type { orders } from "@/db/schema";

type OrderRow = typeof orders.$inferSelect;

export interface OrderView {
  order_number: string;
  kind: string;
  status: string;
  charged_cents: number;
  list_price_cents: number;
  add_ons: { name: string; priceCents: number }[];
  refund_cents: number;
  /** The date the box actually arrived. Non-null ONLY when status is delivered. */
  delivered_on: string | null;
  /** The date the box is due. Non-null ONLY while it is still in flight. */
  expected_delivery_date: string | null;
  refunded: boolean;
  refunded_at: string | null;
  items: string[];
  /** Dietary tracks this meal satisfies, as packed. */
  dietary_tags: string[];
}

const addOnSum = (o: OrderRow) => (o.addOns ?? []).reduce((s, a) => s + a.priceCents, 0);

/** Refund amount for an order: the meal's list (undiscounted) price plus add-ons,
 *  for both subscription and extra meals. */
export const refundAmountCents = (o: OrderRow) => o.listPriceCents + addOnSum(o);

/**
 * The single description of an order, shared by the model, the history card and
 * the account panel.
 *
 * `delivered_on` and `expected_delivery_date` are split deliberately. A single
 * `delivery_date` key meant "arrived on" for a delivered order and "due on" for
 * one still in flight, and nothing in the payload said which - so an open order
 * whose due date had passed read as proof of delivery, and the agent told
 * customers their box had arrived when it had not. Splitting the key makes the
 * claim unambiguous however the dates drift.
 */
export function orderView(o: OrderRow): OrderView {
  const delivered = o.status === "delivered";
  const inFlight = o.status === "processing" || o.status === "shipped";
  return {
    order_number: o.orderNumber,
    kind: o.kind, // subscription | extra
    status: o.status,
    charged_cents: o.totalCents, // 0 for a subscription meal (free)
    list_price_cents: o.listPriceCents, // undiscounted meal price
    add_ons: o.addOns ?? [],
    refund_cents: refundAmountCents(o),
    delivered_on: delivered ? o.deliveryDate : null,
    expected_delivery_date: inFlight ? o.deliveryDate : null,
    refunded: o.refundedAt !== null,
    refunded_at: o.refundedAt ? toIsoDate(o.refundedAt) : null,
    items: o.items ?? [],
    dietary_tags: o.dietaryTags ?? [],
  };
}
