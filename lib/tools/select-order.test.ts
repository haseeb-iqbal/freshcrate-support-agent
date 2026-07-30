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

  it("returns null for an out-of-range position", () => {
    expect(selectOrder(orders, { position: 9 })).toBeNull();
  });

  it("filters by kind before positioning", () => {
    expect(selectOrder(orders, { kind: "extra" })?.orderNumber).toBe("FC1006");
  });

  it("filters by status before positioning", () => {
    expect(selectOrder(orders, { status: "shipped" })?.orderNumber).toBe("FC1005");
  });

  it("matches an exact order_number regardless of other fields", () => {
    expect(selectOrder(orders, { orderNumber: "FC1006", position: 1 })?.orderNumber).toBe("FC1006");
  });

  it("returns null for an unknown order_number", () => {
    expect(selectOrder(orders, { orderNumber: "FC9999" })).toBeNull();
  });

  it("returns null on an empty list", () => {
    expect(selectOrder([], { position: 1 })).toBeNull();
  });

  // NB: the repo runs tests with TZ=UTC (see package.json), so a local calendar
  // day and a UTC slice of the same Date are identical here - no test in this
  // file can distinguish them. The local-day implementation is correct by
  // construction (same getFullYear/getMonth/getDate approach as lib/date.ts).

  it("matches an order by its delivery date", () => {
    // The matching order is the OLDER of the two by placedAt, so this only
    // passes if the deliveryDate filter actually ran - the position-1
    // default would otherwise pick the newer, non-matching order.
    const newer = mk("FC1099", "2026-07-20T00:00:00Z");
    const older = mk("FC1010", "2026-07-01T00:00:00Z", { deliveryDate: "2026-07-25" });
    expect(selectOrder([newer, older], { date: "2026-07-25" })?.orderNumber).toBe("FC1010");
  });

  it("matches an order by the calendar day it was placed", () => {
    // B (21st) is NOT position 1 in `orders` (A, the 23rd, is), so this only
    // passes if the placed-day filter actually ran.
    expect(selectOrder(orders, { date: "2026-06-21" })?.orderNumber).toBe("FC1005");
  });

  it("returns null when no order is on that date", () => {
    expect(selectOrder(orders, { date: "2020-01-01" })).toBeNull();
  });

  it("prefers order_number over date", () => {
    expect(selectOrder(orders, { orderNumber: "FC1006", date: "2026-06-23" })?.orderNumber).toBe("FC1006");
  });
});
