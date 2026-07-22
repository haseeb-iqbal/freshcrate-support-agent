import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { setClock } from "@/lib/clock";
import { POST } from "@/app/api/actions/refund/route";
import { createTestCustomer, createTestOrder, purgeCustomer, txnsOf } from "../helpers/db";
import { postJson } from "../helpers/http";

const OWNER = "88888888-8888-8888-8888-888888880010";
const OTHER = "88888888-8888-8888-8888-888888880011";
const TODAY = new Date(2026, 6, 20); // 20 July 2026, local midnight
const daysBefore = (n: number) => new Date(TODAY.getTime() - n * 86_400_000);

describe("POST /api/actions/refund", () => {
  beforeEach(async () => {
    setClock(() => TODAY);
    await createTestCustomer({ id: OWNER, billingDate: "2026-08-17" });
    await createTestCustomer({ id: OTHER, billingDate: "2026-08-17" });
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await purgeCustomer(OWNER);
    await purgeCustomer(OTHER);
  });

  it("rejects a request with no order number", async () => {
    const res = await postJson(POST, { customerId: OWNER });
    expect(res.status).toBe(400);
  });

  it("refunds a plain box under the ceiling and writes one ledger row", async () => {
    await createTestOrder({ customerId: OWNER, orderNumber: "TST1001", listPriceCents: 1750 });
    const res = await postJson(POST, { customerId: OWNER, orderNumber: "TST1001", reason: "damaged" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, amount_cents: 1750 });
    expect(await txnsOf(OWNER)).toEqual([{ type: "refund", amountCents: -1750 }]);

    const [row] = await db.select().from(orders).where(eq(orders.orderNumber, "TST1001"));
    expect(row.refundedAt).not.toBeNull();
  });

  it("refunds list price plus add-ons, not the charged total", async () => {
    // A subscription meal is charged 0 but refunds at its undiscounted value.
    await createTestOrder({
      customerId: OWNER,
      orderNumber: "TST1002",
      listPriceCents: 1750,
      totalCents: 0,
      addOns: [{ name: "Garlic bread", priceCents: 200 }],
    });
    const res = await postJson(POST, { customerId: OWNER, orderNumber: "TST1002", reason: "damaged" });

    expect(await res.json()).toMatchObject({ amount_cents: 1950 });
    expect(await txnsOf(OWNER)).toEqual([{ type: "refund", amountCents: -1950 }]);
  });

  it("is idempotent: a replayed confirmation does not refund twice", async () => {
    await createTestOrder({ customerId: OWNER, orderNumber: "TST1003", listPriceCents: 1750 });
    const first = await postJson(POST, { customerId: OWNER, orderNumber: "TST1003", reason: "damaged" });
    const second = await postJson(POST, { customerId: OWNER, orderNumber: "TST1003", reason: "damaged" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "already_refunded" });
    expect(await txnsOf(OWNER)).toHaveLength(1);
  });

  it("re-checks the ceiling server-side and refuses an oversized refund", async () => {
    // 1750 + 900 = 2650, above the 2000 ceiling.
    await createTestOrder({
      customerId: OWNER,
      orderNumber: "TST1004",
      listPriceCents: 1750,
      addOns: [{ name: "Wine pairing", priceCents: 900 }],
    });
    const res = await postJson(POST, { customerId: OWNER, orderNumber: "TST1004", reason: "damaged" });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "over_ceiling", ceiling_cents: 2000 });
    expect(await txnsOf(OWNER)).toEqual([]);
  });

  it("re-checks the cooldown server-side and refuses a second refund inside it", async () => {
    await createTestOrder({ customerId: OWNER, orderNumber: "TST1005", refundedAt: daysBefore(5) });
    await createTestOrder({ customerId: OWNER, orderNumber: "TST1006", listPriceCents: 1750 });
    const res = await postJson(POST, { customerId: OWNER, orderNumber: "TST1006", reason: "damaged" });

    expect(res.status).toBe(403);
    // Last refund 5 days ago + 14-day window = eligible again on 2026-07-29.
    expect(await res.json()).toMatchObject({ error: "refund_cooldown", next_eligible: "2026-07-29" });
    expect(await txnsOf(OWNER)).toEqual([]);
  });

  it("allows a refund once the cooldown has fully elapsed", async () => {
    await createTestOrder({ customerId: OWNER, orderNumber: "TST1007", refundedAt: daysBefore(14) });
    await createTestOrder({ customerId: OWNER, orderNumber: "TST1008", listPriceCents: 1750 });
    const res = await postJson(POST, { customerId: OWNER, orderNumber: "TST1008", reason: "damaged" });

    expect(res.status).toBe(200);
  });

  it("never refunds another customer's order", async () => {
    await createTestOrder({ customerId: OWNER, orderNumber: "TST1009", listPriceCents: 1750 });
    const res = await postJson(POST, { customerId: OTHER, orderNumber: "TST1009", reason: "damaged" });

    expect(res.status).toBe(404);
    expect(await txnsOf(OTHER)).toEqual([]);
    expect(await txnsOf(OWNER)).toEqual([]);
  });
});
