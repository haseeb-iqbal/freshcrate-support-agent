import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { setClock } from "@/lib/clock";
import { POST } from "@/app/api/actions/pause/route";
import { createTestCustomer, customerOf, eventsOf, purgeCustomer, txnsOf } from "../helpers/db";
import { postJson } from "../helpers/http";

const ID = "88888888-8888-8888-8888-888888880020";
const TODAY = new Date(2026, 6, 20);
// weeksUntilDate("2026-08-17", 2026-07-20) = 4.
const BILLING = "2026-08-17";

describe("POST /api/actions/pause", () => {
  beforeEach(() => setClock(() => TODAY));
  afterEach(() => setClock(null));
  afterAll(() => purgeCustomer(ID));

  it("rejects a missing customerId", async () => {
    const res = await postJson(POST, { weeks: 2 });
    expect(res.status).toBe(400);
  });

  it("rejects a week count outside 1-52", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    expect((await postJson(POST, { customerId: ID, weeks: 0 })).status).toBe(400);
    expect((await postJson(POST, { customerId: ID, weeks: 53 })).status).toBe(400);
    expect(await txnsOf(ID)).toEqual([]);
    expect((await customerOf(ID)).billingAdjustmentCents).toBe(0); // nothing deferred on a rejected call
  });

  it("pauses for a finite term, defers the reduction to the next bill, and sets the resume date", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    const res = await postJson(POST, { customerId: ID, weeks: 2 });

    expect(res.status).toBe(200);
    // stored adjustment = whole cycle at (weekly − $8): 4 x $22 = $88.
    expect(await res.json()).toMatchObject({ ok: true, weeks: 2, adjustment_cents: 8800, weekly_fee_cents: 800, resume_date: "2026-08-03" });

    const c = await customerOf(ID);
    expect(c.subscriptionStatus).toBe("paused");
    expect(c.pauseResumeDate).toBe("2026-08-03");
    expect(c.billingAdjustmentCents).toBe(-8800);
    expect(await txnsOf(ID)).toEqual([]); // deferred, not an immediate transaction
    expect(await eventsOf(ID)).toEqual(["paused"]);
  });

  it("defers the whole cycle for an indefinite pause and stores no resume date", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    const res = await postJson(POST, { customerId: ID, indefinite: true });

    expect(await res.json()).toMatchObject({ indefinite: true, adjustment_cents: 8800, resume_date: null });
    const c = await customerOf(ID);
    expect(c.pauseResumeDate).toBeNull();
    expect(c.billingAdjustmentCents).toBe(-8800);
    expect(await txnsOf(ID)).toEqual([]);
  });

  it("defers at most once: a replayed confirmation does not double-defer", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    await postJson(POST, { customerId: ID, weeks: 2 });
    const second = await postJson(POST, { customerId: ID, weeks: 2 });

    expect(second.status).toBe(200);
    expect((await customerOf(ID)).billingAdjustmentCents).toBe(-8800); // not doubled
  });

  it("lets an already-paused customer extend the pause without a second deferral", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    await postJson(POST, { customerId: ID, weeks: 2 });
    const extend = await postJson(POST, { customerId: ID, weeks: 4 });

    expect(extend.status).toBe(200);
    expect((await customerOf(ID)).pauseResumeDate).toBe("2026-08-17");
    expect((await customerOf(ID)).billingAdjustmentCents).toBe(-8800); // unchanged by the extension
    expect(await eventsOf(ID)).toEqual(["paused", "paused"]);
  });

  it("refuses to pause a cancelled subscription", async () => {
    await createTestCustomer({ id: ID, subscriptionStatus: "cancelled", billingDate: BILLING });
    const res = await postJson(POST, { customerId: ID, weeks: 2 });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "cancelled" });
    expect(await txnsOf(ID)).toEqual([]);
  });

  it("404s an unknown customer", async () => {
    const res = await postJson(POST, { customerId: "88888888-8888-8888-8888-888888880999", weeks: 2 });
    expect(res.status).toBe(404);
  });
});
