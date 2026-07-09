import { describe, expect, it } from "vitest";
import { selectOrder, type SelectableOrder } from "./select-order";

const mk = (orderNumber: string, iso: string, over: Partial<SelectableOrder> = {}): SelectableOrder => ({
  orderNumber,
  kind: "subscription",
  status: "delivered",
  placedAt: new Date(iso),
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
});
