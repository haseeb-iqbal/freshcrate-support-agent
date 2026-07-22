import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { setClock } from "@/lib/clock";
import { POST } from "@/app/api/actions/reactivate/route";
import { createTestCustomer, customerOf, eventsOf, purgeCustomer, txnsOf } from "../helpers/db";
import { postJson } from "../helpers/http";

const ID = "88888888-8888-8888-8888-888888880040";
const TODAY = new Date(2026, 6, 20);

const cancelled = (billingDate: string) =>
  createTestCustomer({ id: ID, subscriptionStatus: "cancelled", billingDate });

describe("POST /api/actions/reactivate", () => {
  beforeEach(() => setClock(() => TODAY));
  afterEach(() => setClock(null));
  afterAll(() => purgeCustomer(ID));

  it("is free within the billing period on the same plan", async () => {
    await cancelled("2026-08-17");
    const res = await postJson(POST, { customerId: ID });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, free: true, total_cents: 0 });
    expect((await customerOf(ID)).subscriptionStatus).toBe("active");
    expect(await txnsOf(ID)).toEqual([]);
    expect(await eventsOf(ID)).toEqual(["reactivated"]);
  });

  it("charges the new plan but no sign-up fee when switching plan inside the billing period", async () => {
    await cancelled("2026-08-17");
    const res = await postJson(POST, { customerId: ID, newPlan: "3 meals/week" });

    expect(await res.json()).toMatchObject({ free: false, plan: "3 meals/week", total_cents: 16800 });
    expect(await txnsOf(ID)).toEqual([{ type: "monthly_billing", amountCents: 16800 }]);
    expect(await eventsOf(ID)).toEqual(["reactivated", "plan_changed"]);
  });

  it("charges the plan price plus the sign-up fee once the billing period has passed", async () => {
    await cancelled("2026-06-15");
    const res = await postJson(POST, { customerId: ID });

    // $120 monthly + $40 sign-up.
    expect(await res.json()).toMatchObject({ free: false, total_cents: 16000 });
    expect(await txnsOf(ID)).toEqual([
      { type: "signup_fee", amountCents: 4000 },
      { type: "monthly_billing", amountCents: 12000 },
    ]);
  });

  it("advances a stale billing date so the customer is not back-billed for the cancelled months", async () => {
    // Cancelled with billing stuck at 2026-06-15, reactivating on 2026-07-20.
    // Leaving that date behind hands reconcile an active subscription that is
    // two months overdue, and it bills for months the customer was cancelled.
    await cancelled("2026-06-15");
    await postJson(POST, { customerId: ID });

    expect((await customerOf(ID)).billingDate).toBe("2026-08-20");
  });

  it("leaves a billing date that is still in the future alone", async () => {
    await cancelled("2026-08-17");
    await postJson(POST, { customerId: ID, newPlan: "3 meals/week" });

    expect((await customerOf(ID)).billingDate).toBe("2026-08-17");
  });

  it("rejects a replayed confirmation, and reconcile adds nothing on the way through", async () => {
    await cancelled("2026-06-15");
    const first = await postJson(POST, { customerId: ID });
    const second = await postJson(POST, { customerId: ID });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "not_cancelled" });
    // Exactly the sign-up fee and the one month just paid for - nothing else.
    expect(await txnsOf(ID)).toEqual([
      { type: "signup_fee", amountCents: 4000 },
      { type: "monthly_billing", amountCents: 12000 },
    ]);
  });

  it("refuses to reactivate a paused subscription", async () => {
    await createTestCustomer({ id: ID, subscriptionStatus: "paused", billingDate: "2026-08-17" });
    const res = await postJson(POST, { customerId: ID });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "not_cancelled" });
  });

  it("rejects an unknown plan without touching the subscription", async () => {
    await cancelled("2026-08-17");
    const res = await postJson(POST, { customerId: ID, newPlan: "9 meals/week" });

    expect(res.status).toBe(400);
    expect((await customerOf(ID)).subscriptionStatus).toBe("cancelled");
    expect(await txnsOf(ID)).toEqual([]);
  });
});
