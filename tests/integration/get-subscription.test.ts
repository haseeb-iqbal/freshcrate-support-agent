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
  next_bill_note?: string;
  next_bill?: {
    amount_cents: number;
    monthly_cents: number;
    pause_fee_per_week_cents: number;
    paused_weeks_billed: number;
  };
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

  it("folds a deferred pause reduction into next_bill_cents, floored at zero", async () => {
    // A paused customer with a -$30 reduction already deferred: the next bill is
    // monthly - 30, not the bare monthly.
    await createTestCustomer({ id: ID, plan: "2 meals/week", subscriptionStatus: "paused", billingAdjustmentCents: -3000 });
    const r = await getSubscription.handler({ customerId: ID, now: new Date() }, {});
    const d = r.data as SubData;
    const plan = await getPlan("2 meals/week");
    expect(d.billing_adjustment_cents).toBe(-3000);
    expect(d.next_bill_cents).toBe(Math.max(0, plan!.monthlyCents - 3000));
  });

  it("bills a one-week pause at $8, not a full-weekly credit ($98, not $90)", async () => {
    // A 1-week pause resuming on the billing date: 3 weeks at $30 + 1 week at $8.
    // The reduction is (weekly - $8) = $22, so the next bill is $98.
    await createTestCustomer({
      id: ID,
      plan: "2 meals/week",
      subscriptionStatus: "paused",
      billingDate: "2026-08-09",
      pauseResumeDate: "2026-08-09",
      billingAdjustmentCents: -2200,
    });
    const r = await getSubscription.handler({ customerId: ID, now: new Date(2026, 7, 2) }, {});
    const d = r.data as SubData;
    expect(d.next_bill?.monthly_cents).toBe(12000);
    expect(d.next_bill?.amount_cents).toBe(9800); // $98
    expect(d.next_bill?.paused_weeks_billed).toBe(1);
    expect(d.next_bill?.pause_fee_per_week_cents).toBe(800);
    expect(d.next_bill_note).toMatch(/\$8\/week/);
    expect(d.next_bill_note).not.toMatch(/credit/i);
  });

  it("bills a fully-paused month at 4 x $8 = $32", async () => {
    await createTestCustomer({
      id: ID,
      plan: "2 meals/week",
      subscriptionStatus: "paused",
      billingDate: "2026-08-30",
      pauseResumeDate: null,
      billingAdjustmentCents: -8800,
    });
    const r = await getSubscription.handler({ customerId: ID, now: new Date(2026, 7, 2) }, {});
    const d = r.data as SubData;
    expect(d.next_bill?.amount_cents).toBe(3200); // $32
    expect(d.next_bill?.paused_weeks_billed).toBe(4);
  });

  it("floors the next bill at zero when a reduction exceeds the monthly", async () => {
    await createTestCustomer({ id: ID, plan: "2 meals/week", subscriptionStatus: "paused", billingAdjustmentCents: -50000 });
    const r = await getSubscription.handler({ customerId: ID, now: new Date() }, {});
    const d = r.data as SubData;
    expect(d.next_bill_cents).toBe(0);
  });
});
