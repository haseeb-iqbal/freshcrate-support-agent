import { beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { lookupOrder } from "@/lib/tools/orders";

// Stable seed UUIDs (db/seed.ts).
const MARCUS = "11111111-1111-1111-1111-111111110002";
const AVA = "11111111-1111-1111-1111-111111110001";

describe("lookup_order (integration, seeded DB)", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required; run `npm run db:reset` first");
  });

  it("resolves position 2 to Marcus's 2nd most recent order (FC1005)", async () => {
    const r = await lookupOrder.handler({ customerId: MARCUS }, { position: 2 });
    expect(r.ok).toBe(true);
    expect((r.data as { order: { order_number: string } }).order.order_number).toBe("FC1005");
  });

  it("filters by status", async () => {
    const r = await lookupOrder.handler({ customerId: MARCUS }, { status: "processing" });
    expect((r.data as { order: { order_number: string } }).order.order_number).toBe("FC1004");
  });

  it("never returns another customer's order (scoping)", async () => {
    // FC1005 belongs to Marcus; Ava must not be able to fetch it.
    const r = await lookupOrder.handler({ customerId: AVA }, { order_number: "FC1005" });
    expect(r.ok).toBe(false);
  });
});
