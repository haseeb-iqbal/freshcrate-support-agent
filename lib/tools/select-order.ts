import type { OrderKind, OrderSelector, OrderStatus } from "@/lib/domain/terms";

/** Minimal shape `selectOrder` needs — a subset of the orders row. */
export interface SelectableOrder {
  orderNumber: string;
  kind: OrderKind;
  status: OrderStatus;
  placedAt: Date;
}

/**
 * Resolve a selector to exactly ONE order (or null), deterministically:
 *   1. order_number wins if given (exact match or null).
 *   2. filter by kind and/or status when present.
 *   3. sort by placedAt descending (most recent first).
 *   4. pick 1-based `position` (default 1); null if out of range.
 */
export function selectOrder<T extends SelectableOrder>(orders: T[], sel: OrderSelector): T | null {
  if (sel.orderNumber) {
    return orders.find((o) => o.orderNumber === sel.orderNumber) ?? null;
  }
  let pool = orders;
  if (sel.kind) pool = pool.filter((o) => o.kind === sel.kind);
  if (sel.status) pool = pool.filter((o) => o.status === sel.status);
  const sorted = [...pool].sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime());
  const pos = sel.position ?? 1;
  if (pos < 1 || pos > sorted.length) return null;
  return sorted[pos - 1];
}
