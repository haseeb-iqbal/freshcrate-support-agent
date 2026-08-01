import { afterAll, beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { getSubscription } from "@/lib/tools/subscription";
import { getPlan } from "@/lib/billing/plans";
import { createTestCustomer, purgeCustomer } from "../helpers/db";

// Isolated throwaway customer (88888888-…00NN range), so this doesn't depend on
// seeded Ava's adjustment, which the E2E confirm specs mutate on the shared DB.
const ID = "88888888-8888-8888-8888-888888880031";

interface SubData {
  status: string;
  plan: string;
  plan_monthly_cents: number | null;
  billing_adjustment_cents: number;
  next_bill_cents: number | null;
}

describe("get_subscription (integration, seeded DB)", () => {
  beforeEach(() => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required; run `npm run db:reset` first");
  });
  afterAll(() => purgeCustomer(ID));

  it("returns the plan's monthly price and a next-bill figure so the model can quote it", async () => {
    await createTestCustomer({ id: ID, plan: "2 meals/week", billingAdjustmentCents: 0 });
    const r = await getSubscription.handler({ customerId: ID, now: new Date() }, {});
    expect(r.ok).toBe(true);
    const d = r.data as SubData;
    const plan = await getPlan("2 meals/week");
    expect(d.plan_monthly_cents).toBe(plan!.monthlyCents);
    expect(d.billing_adjustment_cents).toBe(0);
    expect(d.next_bill_cents).toBe(plan!.monthlyCents);
    expect(d.next_bill_cents).toBeGreaterThan(0);
  });

  it("folds a deferred pause credit into next_bill_cents, floored at zero", async () => {
    // A paused customer with a -$30 credit already deferred: the next bill is
    // monthly - 30, not the bare monthly.
    await createTestCustomer({ id: ID, plan: "2 meals/week", subscriptionStatus: "paused", billingAdjustmentCents: -3000 });
    const r = await getSubscription.handler({ customerId: ID, now: new Date() }, {});
    const d = r.data as SubData;
    const plan = await getPlan("2 meals/week");
    expect(d.billing_adjustment_cents).toBe(-3000);
    expect(d.next_bill_cents).toBe(Math.max(0, plan!.monthlyCents - 3000));
  });

  it("floors the next bill at zero when a credit exceeds the monthly", async () => {
    await createTestCustomer({ id: ID, plan: "2 meals/week", subscriptionStatus: "paused", billingAdjustmentCents: -50000 });
    const r = await getSubscription.handler({ customerId: ID, now: new Date() }, {});
    const d = r.data as SubData;
    expect(d.next_bill_cents).toBe(0);
  });
});
