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

  it("reports a processing order's date as expected", () => {
    const v = orderView(row({ status: "processing", deliveryDate: "2026-07-25" }));
    expect(v.expected_delivery_date).toBe("2026-07-25");
    expect(v.delivered_on).toBeNull();
  });

  it("reports a delivered order's date as the delivery that happened", () => {
    const v = orderView(row({ status: "delivered", deliveryDate: "2026-07-10" }));
    expect(v.delivered_on).toBe("2026-07-10");
    expect(v.expected_delivery_date).toBeNull();
  });

  it("never reports a delivery for a cancelled order", () => {
    const v = orderView(row({ status: "cancelled", deliveryDate: "2026-07-25" }));
    expect(v.delivered_on).toBeNull();
    expect(v.expected_delivery_date).toBeNull();
  });

  it("keeps expected and actual mutually exclusive for every status", () => {
    for (const status of ["processing", "shipped", "delivered", "cancelled"]) {
      const v = orderView(row({ status }));
      expect(v.delivered_on !== null && v.expected_delivery_date !== null).toBe(false);
    }
  });

  it("still exposes the status verbatim", () => {
    expect(orderView(row({ status: "shipped" })).status).toBe("shipped");
  });

  it("surfaces a refund only once one has happened", () => {
    expect(orderView(row()).refunded).toBe(false);
    expect(orderView(row()).refunded_at).toBeNull();
    const done = orderView(row({ refundedAt: new Date(2026, 6, 10) }));
    expect(done.refunded).toBe(true);
    expect(done.refunded_at).toBe("2026-07-10");
  });

  it("defaults absent add-ons and items to empty arrays", () => {
    const v = orderView(row({ addOns: null, items: null }));
    expect(v.add_ons).toEqual([]);
    expect(v.items).toEqual([]);
  });

  it("reports the charged total and the undiscounted list price separately", () => {
    // A subscription meal is free to the customer but still refunds at list price.
    const v = orderView(row({ kind: "subscription", totalCents: 0, listPriceCents: 1750 }));
    expect(v.charged_cents).toBe(0);
    expect(v.list_price_cents).toBe(1750);
    expect(v.refund_cents).toBe(1750);
  });

  it("surfaces the meal's dietary tags", () => {
    const v = orderView(row({ dietaryTags: ["vegetarian", "gluten-free"] }));
    expect(v.dietary_tags).toEqual(["vegetarian", "gluten-free"]);
  });

  it("treats absent dietary tags as none", () => {
    expect(orderView(row({ dietaryTags: null })).dietary_tags).toEqual([]);
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

  it("treats absent add-ons as none", () => {
    expect(refundAmountCents(row({ addOns: null }))).toBe(1750);
  });
});
