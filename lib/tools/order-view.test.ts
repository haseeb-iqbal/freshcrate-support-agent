import { describe, expect, it } from "vitest";
import { orderView, refundAmountCents } from "./order-view";
import type { orders } from "@/db/schema";

type OrderRow = typeof orders.$inferSelect;

const row = (over: Partial<OrderRow> = {}): OrderRow =>
  ({
    id: "00000000-0000-0000-0000-000000000001",
    orderNumber: "FC1005",
    customerId: "11111111-1111-1111-1111-111111110002",
    status: "shipped",
    kind: "subscription",
    totalCents: 0,
    listPriceCents: 1750,
    addOns: [],
    placedAt: new Date(2026, 6, 19),
    deliveryDate: "2026-07-25",
    refundedAt: null,
    items: ["Beef Tacos"],
    dietaryTags: ["standard"],
    ...over,
  }) as OrderRow;

describe("orderView", () => {
  it("reports a shipped order's date as expected, never as delivered", () => {
    const v = orderView(row({ status: "shipped", deliveryDate: "2026-07-25" }));
    expect(v.expected_delivery_date).toBe("2026-07-25");
    expect(v.delivered_on).toBeNull();
  });

  it("surfaces a refund only once one has happened", () => {
    expect(orderView(row()).refunded).toBe(false);
    expect(orderView(row()).refunded_at).toBeNull();
    const done = orderView(row({ refundedAt: new Date(2026, 6, 10) }));
    expect(done.refunded).toBe(true);
    expect(done.refunded_at).toBe("2026-07-10");
  });

});

describe("refundAmountCents", () => {
  it("refunds the undiscounted list price of a free subscription meal", () => {
    expect(refundAmountCents(row({ totalCents: 0, listPriceCents: 1750 }))).toBe(1750);
  });

  it("adds every add-on to the refund", () => {
    const o = row({ listPriceCents: 1750, addOns: [{ name: "Bread", priceCents: 200 }, { name: "Wine", priceCents: 900 }] });
    expect(refundAmountCents(o)).toBe(2850);
  });

});
