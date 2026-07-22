import { afterAll, beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { createTestCustomer, createTestOrder, customerOf, eventsOf, purgeCustomer, txnsOf } from "../helpers/db";

const ID = "88888888-8888-8888-8888-888888880099";

describe("api test helpers", () => {
  beforeEach(async () => {
    await createTestCustomer({ id: ID, billingDate: "2026-08-17" });
  });
  afterAll(() => purgeCustomer(ID));

  it("creates a customer in the requested state", async () => {
    const c = await customerOf(ID);
    expect(c.subscriptionStatus).toBe("active");
    expect(c.plan).toBe("2 meals/week");
    expect(c.billingDate).toBe("2026-08-17");
  });

  it("honours an overridden status and plan", async () => {
    await createTestCustomer({ id: ID, subscriptionStatus: "paused", plan: "3 meals/week", pauseResumeDate: "2026-09-01" });
    const c = await customerOf(ID);
    expect(c.subscriptionStatus).toBe("paused");
    expect(c.plan).toBe("3 meals/week");
    expect(c.pauseResumeDate).toBe("2026-09-01");
  });

  it("starts each test with no transactions or events", async () => {
    expect(await txnsOf(ID)).toEqual([]);
    expect(await eventsOf(ID)).toEqual([]);
  });

  it("creates an order owned by the customer with a refundable list price", async () => {
    await createTestOrder({ customerId: ID, orderNumber: "TST0099", listPriceCents: 1750 });
    const [row] = await db.select().from(orders).where(eq(orders.orderNumber, "TST0099"));
    expect(row.customerId).toBe(ID);
    expect(row.listPriceCents).toBe(1750);
    expect(row.refundedAt).toBeNull();
  });

  it("purges the customer and its orders together", async () => {
    await createTestOrder({ customerId: ID, orderNumber: "TST0098" });
    await purgeCustomer(ID);
    await expect(customerOf(ID)).rejects.toThrow(/no customer/i);
    expect(await db.select().from(orders).where(eq(orders.orderNumber, "TST0098"))).toEqual([]);
  });
});
