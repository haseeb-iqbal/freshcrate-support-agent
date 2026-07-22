import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { setClock } from "@/lib/clock";
import { POST as cancelPOST } from "@/app/api/actions/cancel/route";
import { POST as changePlanPOST } from "@/app/api/actions/change-plan/route";
import { createTestCustomer, customerOf, eventsOf, purgeCustomer, txnsOf } from "../helpers/db";
import { postJson } from "../helpers/http";

const ID = "88888888-8888-8888-8888-888888880050";
const TODAY = new Date(2026, 6, 20);
const BILLING = "2026-08-17"; // 4 weeks out from TODAY

describe("POST /api/actions/cancel", () => {
  beforeEach(() => setClock(() => TODAY));
  afterEach(() => setClock(null));
  afterAll(() => purgeCustomer(ID));

  it("cancels a subscription and clears any pause", async () => {
    await createTestCustomer({ id: ID, subscriptionStatus: "paused", billingDate: BILLING, pauseResumeDate: "2026-09-01" });
    const res = await postJson(cancelPOST, { customerId: ID });

    expect(res.status).toBe(200);
    const c = await customerOf(ID);
    expect(c.subscriptionStatus).toBe("cancelled");
    expect(c.pauseResumeDate).toBeNull();
    expect(await eventsOf(ID)).toEqual(["cancelled"]);
  });

  it("rejects a replayed confirmation instead of logging a second cancellation", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    const first = await postJson(cancelPOST, { customerId: ID });
    const second = await postJson(cancelPOST, { customerId: ID });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "already_cancelled" });
    expect(await eventsOf(ID)).toEqual(["cancelled"]);
  });

  it("rejects a missing customerId", async () => {
    expect((await postJson(cancelPOST, {})).status).toBe(400);
  });
});

describe("POST /api/actions/change-plan", () => {
  beforeEach(() => setClock(() => TODAY));
  afterEach(() => setClock(null));
  afterAll(() => purgeCustomer(ID));

  it("upgrades and charges the prorated weekly difference", async () => {
    await createTestCustomer({ id: ID, plan: "2 meals/week", billingDate: BILLING });
    const res = await postJson(changePlanPOST, { customerId: ID, plan: "3 meals/week" });

    // ($42 - $30) x 4 weeks left = $48.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, plan: "3 meals/week", monthly_cents: 16800, proration_cents: 4800 });
    expect((await customerOf(ID)).plan).toBe("3 meals/week");
    expect(await txnsOf(ID)).toEqual([{ type: "proration", amountCents: 4800 }]);
    expect(await eventsOf(ID)).toEqual(["plan_changed"]);
  });

  it("downgrades and credits the difference", async () => {
    await createTestCustomer({ id: ID, plan: "4 meals/week", billingDate: BILLING });
    const res = await postJson(changePlanPOST, { customerId: ID, plan: "2 meals/week" });

    // ($30 - $52) x 4 = -$88.
    expect(await res.json()).toMatchObject({ proration_cents: -8800 });
    expect(await txnsOf(ID)).toEqual([{ type: "proration", amountCents: -8800 }]);
  });

  it("writes no proration row when billing is due within the week", async () => {
    await createTestCustomer({ id: ID, plan: "2 meals/week", billingDate: "2026-07-24" });
    const res = await postJson(changePlanPOST, { customerId: ID, plan: "3 meals/week" });

    expect(await res.json()).toMatchObject({ proration_cents: 0 });
    expect(await txnsOf(ID)).toEqual([]);
  });

  it("rejects a replayed confirmation instead of logging a phantom plan change", async () => {
    await createTestCustomer({ id: ID, plan: "2 meals/week", billingDate: BILLING });
    const first = await postJson(changePlanPOST, { customerId: ID, plan: "3 meals/week" });
    const second = await postJson(changePlanPOST, { customerId: ID, plan: "3 meals/week" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "same_plan" });
    expect(await eventsOf(ID)).toEqual(["plan_changed"]);
    expect(await txnsOf(ID)).toHaveLength(1);
  });

  it("refuses to change the plan of a paused subscription", async () => {
    await createTestCustomer({ id: ID, subscriptionStatus: "paused", billingDate: BILLING });
    const res = await postJson(changePlanPOST, { customerId: ID, plan: "3 meals/week" });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "paused" });
    expect((await customerOf(ID)).plan).toBe("2 meals/week");
  });

  it("refuses to change the plan of a cancelled subscription", async () => {
    await createTestCustomer({ id: ID, subscriptionStatus: "cancelled", billingDate: BILLING });
    const res = await postJson(changePlanPOST, { customerId: ID, plan: "3 meals/week" });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "cancelled" });
  });

  it("rejects an unknown plan", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    const res = await postJson(changePlanPOST, { customerId: ID, plan: "9 meals/week" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unknown_plan" });
  });
});
