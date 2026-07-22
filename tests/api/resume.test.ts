import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { setClock } from "@/lib/clock";
import { POST } from "@/app/api/actions/resume/route";
import { createTestCustomer, customerOf, eventsOf, purgeCustomer, txnsOf } from "../helpers/db";
import { postJson } from "../helpers/http";

const ID = "88888888-8888-8888-8888-888888880030";
const TODAY = new Date(2026, 6, 20);
const BILLING = "2026-08-17"; // 4 weeks out from TODAY

const paused = () =>
  createTestCustomer({ id: ID, subscriptionStatus: "paused", billingDate: BILLING, pauseResumeDate: "2026-09-01" });

describe("POST /api/actions/resume", () => {
  beforeEach(() => setClock(() => TODAY));
  afterEach(() => setClock(null));
  afterAll(() => purgeCustomer(ID));

  it("resumes on the same plan and charges the weeks left net of the pause fee", async () => {
    await paused();
    const res = await postJson(POST, { customerId: ID });

    // 4 weeks to billing x ($30 - $8) = $88.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, plan: "2 meals/week", plan_changed: false, charge_cents: 8800 });

    const c = await customerOf(ID);
    expect(c.subscriptionStatus).toBe("active");
    expect(c.pauseResumeDate).toBeNull();
    expect(await txnsOf(ID)).toEqual([{ type: "resume_charge", amountCents: 8800 }]);
    expect(await eventsOf(ID)).toEqual(["resumed"]);
  });

  it("charges the NEW plan's weekly rate when resuming onto a different plan", async () => {
    await paused();
    const res = await postJson(POST, { customerId: ID, newPlan: "3 meals/week" });

    // 4 weeks x ($42 - $8) = $136.
    expect(await res.json()).toMatchObject({ plan: "3 meals/week", plan_changed: true, charge_cents: 13600 });
    expect((await customerOf(ID)).plan).toBe("3 meals/week");
    expect(await txnsOf(ID)).toEqual([{ type: "resume_charge", amountCents: 13600 }]);
    expect(await eventsOf(ID)).toEqual(["resumed", "plan_changed"]);
  });

  it("charges nothing when billing is due within the week", async () => {
    await createTestCustomer({ id: ID, subscriptionStatus: "paused", billingDate: "2026-07-24", pauseResumeDate: "2026-09-01" });
    const res = await postJson(POST, { customerId: ID });

    // 5 days out is 0 whole weeks, so there is nothing left to charge for.
    expect(await res.json()).toMatchObject({ charge_cents: 0 });
    expect(await txnsOf(ID)).toEqual([]);
  });

  it("rejects a replayed confirmation because the subscription is no longer paused", async () => {
    await paused();
    const first = await postJson(POST, { customerId: ID });
    const second = await postJson(POST, { customerId: ID });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "not_paused" });
    expect(await txnsOf(ID)).toHaveLength(1);
  });

  it("refuses to resume an active subscription", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    const res = await postJson(POST, { customerId: ID });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "not_paused" });
  });

  it("rejects an unknown plan without touching the subscription", async () => {
    await paused();
    const res = await postJson(POST, { customerId: ID, newPlan: "9 meals/week" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unknown_plan" });
    expect((await customerOf(ID)).subscriptionStatus).toBe("paused");
    expect(await txnsOf(ID)).toEqual([]);
  });

  it("404s an unknown customer", async () => {
    const res = await postJson(POST, { customerId: "88888888-8888-8888-8888-888888880999" });
    expect(res.status).toBe(404);
  });
});
