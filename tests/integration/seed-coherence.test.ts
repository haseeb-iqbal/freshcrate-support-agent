import { beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { OPEN_STATUSES } from "@/lib/domain/terms";

/**
 * The seeded demo data must be coherent RELATIVE TO NOW, not relative to the day
 * it was written. An open order whose delivery date has already passed is
 * self-contradictory, and the agent resolves that contradiction by telling the
 * customer their box was delivered when it was not.
 */
describe("seed temporal coherence", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required; run `npm run db:reset` first");
  });

  const startOfToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const asDate = (iso: string) => new Date(`${iso}T00:00:00`);

  it("seeds at least one open order to exercise the in-flight path", async () => {
    const open = await db.select().from(orders).where(inArray(orders.status, [...OPEN_STATUSES]));
    expect(open.length).toBeGreaterThan(0);
  });

  it("gives every processing or shipped order a delivery date in the future", async () => {
    const open = await db.select().from(orders).where(inArray(orders.status, [...OPEN_STATUSES]));
    const stale = open
      .filter((o) => o.deliveryDate !== null && asDate(o.deliveryDate) < startOfToday())
      .map((o) => `${o.orderNumber} (${o.status}, due ${o.deliveryDate})`);
    expect(stale).toEqual([]);
  });

  it("gives every delivered order a delivery date in the past", async () => {
    const done = await db.select().from(orders).where(inArray(orders.status, ["delivered"]));
    const impossible = done
      .filter((o) => o.deliveryDate !== null && asDate(o.deliveryDate) > startOfToday())
      .map((o) => `${o.orderNumber} (delivered, due ${o.deliveryDate})`);
    expect(impossible).toEqual([]);
  });

  it("never dates an order's delivery before it was placed", async () => {
    const all = await db.select().from(orders);
    const backwards = all
      .filter((o) => o.deliveryDate !== null && asDate(o.deliveryDate) < new Date(o.placedAt.toDateString()))
      .map((o) => o.orderNumber);
    expect(backwards).toEqual([]);
  });
});
