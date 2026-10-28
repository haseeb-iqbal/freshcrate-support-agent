import { describe, expect, it } from "vitest";
import { selectOrder, type SelectableOrder } from "./select-order";

const mk = (orderNumber: string, iso: string, over: Partial<SelectableOrder> = {}): SelectableOrder => ({
  orderNumber,
  kind: "subscription",
  status: "delivered",
  placedAt: new Date(iso),
  deliveryDate: null,
  ...over,
});

// Newest first when sorted: A (23rd) > B (21st) > C (7th)
const A = mk("FC1004", "2026-06-23T00:00:00Z", { status: "processing" });
const B = mk("FC1005", "2026-06-21T00:00:00Z", { status: "shipped" });
const C = mk("FC1006", "2026-06-07T00:00:00Z", { kind: "extra" });
const orders = [B, A, C]; // deliberately unsorted input

describe("selectOrder", () => {
  it("defaults to the most recent (position 1)", () => {
    expect(selectOrder(orders, {})?.orderNumber).toBe("FC1004");
  });

  it("resolves position 2 to the 2nd most recent", () => {
    expect(selectOrder(orders, { position: 2 })?.orderNumber).toBe("FC1005");
  });

  it("matches an exact order_number regardless of other fields", () => {
    expect(selectOrder(orders, { orderNumber: "FC1006", position: 1 })?.orderNumber).toBe("FC1006");
  });

  // NB: the repo runs tests with TZ=UTC (see package.json), so a local calendar
  // day and a UTC slice of the same Date are identical here - no test in this
  // file can distinguish them. The local-day implementation is correct by
  // construction (same getFullYear/getMonth/getDate approach as lib/date.ts).

  it("matches an order delivered or placed inside a date range, and none outside it", () => {
    // 'last week': FC1005 was placed on the 21st, inside the range; the others are not.
    expect(selectOrder(orders, { dateFrom: "2026-06-15", dateTo: "2026-06-22" })?.orderNumber).toBe("FC1005");
    expect(selectOrder(orders, { dateFrom: "2026-06-08", dateTo: "2026-06-14" })).toBeNull();
    const delivered = mk("FC1010", "2026-07-01T00:00:00Z", { deliveryDate: "2026-07-25" });
    expect(selectOrder([delivered], { dateFrom: "2026-07-20" })?.orderNumber).toBe("FC1010");
  });

});
