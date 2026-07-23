import { beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { OPEN_STATUSES } from "@/lib/domain/terms";
import { addOnsForTrack, isDietaryTrack, mealByName, type DietaryTrack } from "@/lib/domain/menu";

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

/**
 * A customer's box must match the diet they are on. A vegetarian receiving a
 * beef meal is not a cosmetic seeding slip: it is the exact contradiction the
 * agent would then have to explain to them.
 */
describe("seed dietary coherence", () => {
  const rows = () =>
    db
      .select({
        orderNumber: orders.orderNumber,
        items: orders.items,
        addOns: orders.addOns,
        dietaryTags: orders.dietaryTags,
        track: customers.dietaryTrack,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id));

  it("puts every customer on one of the four tracks", async () => {
    const all = await db.select({ id: customers.id, track: customers.dietaryTrack }).from(customers);
    const unknown = all.filter((c) => !isDietaryTrack(c.track)).map((c) => `${c.id} (${c.track})`);
    expect(unknown).toEqual([]);
  });

  it("gives every order a meal from its customer's track", async () => {
    const wrong = (await rows())
      .filter((r) => mealByName((r.items ?? [])[0] ?? "")?.track !== r.track)
      .map((r) => `${r.orderNumber}: "${(r.items ?? [])[0]}" is not on the ${r.track} menu`);
    expect(wrong).toEqual([]);
  });

  it("gives every order add-ons from its customer's track", async () => {
    const wrong: string[] = [];
    for (const r of await rows()) {
      const allowed = new Set(addOnsForTrack(r.track as DietaryTrack).map((a) => a.name));
      for (const a of r.addOns ?? []) {
        if (!allowed.has(a.name)) wrong.push(`${r.orderNumber}: "${a.name}" is not on the ${r.track} menu`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("tags every order with its meal's catalogue tags", async () => {
    const wrong = (await rows())
      .filter((r) => {
        const meal = mealByName((r.items ?? [])[0] ?? "");
        return !meal || JSON.stringify(r.dietaryTags ?? []) !== JSON.stringify(meal.tags);
      })
      .map((r) => `${r.orderNumber}: tags ${JSON.stringify(r.dietaryTags)}`);
    expect(wrong).toEqual([]);
  });

  it("keeps the three seeded refund demos at their required amounts", async () => {
    const demos = await db
      .select({ orderNumber: orders.orderNumber, listPriceCents: orders.listPriceCents, addOns: orders.addOns })
      .from(orders)
      .where(inArray(orders.orderNumber, ["FC1008", "FC1015", "FC1020"]));
    const refund = (n: string) => {
      const o = demos.find((d) => d.orderNumber === n)!;
      return o.listPriceCents + (o.addOns ?? []).reduce((s, a) => s + a.priceCents, 0);
    };
    expect(refund("FC1008")).toBe(1750); // confirmable, and the E2E spec asserts "$17.50"
    expect(refund("FC1015")).toBe(1750); // refundable, so Tom's 14-day cooldown fires
    expect(refund("FC1020")).toBeGreaterThan(2000); // must escalate past the ceiling
  });
});
