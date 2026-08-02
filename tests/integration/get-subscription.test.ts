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
    pause_credit_cents: number;
    deferred_charge_cents: number;
    pause_fee_upcoming_cents: number;
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

  it("breaks the bill down and does NOT add a pause fee when the pause resolves by billing", async () => {
    // The screenshot bug: bot invented an "$8/week fee reflected in the total".
    // A 1-week pause resuming on/before billing pays NO pause fee, so the note
    // must say the fee does not apply and the breakdown must expose the credit.
    await createTestCustomer({
      id: ID,
      plan: "2 meals/week",
      subscriptionStatus: "paused",
      billingDate: "2026-08-09",
      pauseResumeDate: "2026-08-09", // resumes on the billing date -> not crossing
      billingAdjustmentCents: -3000,
    });
    const r = await getSubscription.handler({ customerId: ID, now: new Date(2026, 7, 2) }, {});
    const d = r.data as SubData;
    expect(d.next_bill?.monthly_cents).toBe(12000);
    expect(d.next_bill?.pause_credit_cents).toBe(3000);
    expect(d.next_bill?.pause_fee_upcoming_cents).toBe(0);
    expect(d.next_bill?.amount_cents).toBe(9000);
    expect(d.next_bill_note).toMatch(/does not apply|no .*fee/i);
  });

  it("flags an upcoming pause fee only when paused ACROSS the billing date", async () => {
    // Indefinite pause (no resume date) -> stays paused across billing -> an $8/wk
    // fee IS charged then, separately from the deferred monthly figure.
    await createTestCustomer({
      id: ID,
      plan: "2 meals/week",
      subscriptionStatus: "paused",
      billingDate: "2026-08-09",
      pauseResumeDate: null,
      billingAdjustmentCents: -3000,
    });
    const r = await getSubscription.handler({ customerId: ID, now: new Date(2026, 7, 2) }, {});
    const d = r.data as SubData;
    expect(d.next_bill?.pause_fee_upcoming_cents).toBeGreaterThan(0);
    expect(d.next_bill_note).toMatch(/pause fee/i);
  });

  it("floors the next bill at zero when a credit exceeds the monthly", async () => {
    await createTestCustomer({ id: ID, plan: "2 meals/week", subscriptionStatus: "paused", billingAdjustmentCents: -50000 });
    const r = await getSubscription.handler({ customerId: ID, now: new Date() }, {});
    const d = r.data as SubData;
    expect(d.next_bill_cents).toBe(0);
  });
});
