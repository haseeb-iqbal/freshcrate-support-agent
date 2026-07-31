import { beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { getSubscription } from "@/lib/tools/subscription";
import { getPlan } from "@/lib/billing/plans";

// Stable seed UUIDs (db/seed.ts).
const AVA = "11111111-1111-1111-1111-111111110001"; // active, 2 meals/week, adjustment 0
const DIEGO = "11111111-1111-1111-1111-111111110004"; // paused, 2 meals/week (seed defers a pause credit)

const ctx = (customerId: string) => ({ customerId, now: new Date() });

interface SubData {
  status: string;
  plan: string;
  plan_monthly_cents: number | null;
  billing_adjustment_cents: number;
  next_bill_cents: number | null;
}

describe("get_subscription (integration, seeded DB)", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required; run `npm run db:reset` first");
  });

  it("returns the plan's monthly price and a next-bill figure so the model can quote it", async () => {
    const r = await getSubscription.handler(ctx(AVA), {});
    expect(r.ok).toBe(true);
    const d = (r.data as SubData);
    const plan = await getPlan(d.plan);
    expect(d.plan_monthly_cents).toBe(plan!.monthlyCents);
    // Ava carries no deferred adjustment, so the next bill is exactly the monthly.
    expect(d.billing_adjustment_cents).toBe(0);
    expect(d.next_bill_cents).toBe(plan!.monthlyCents);
    expect(d.next_bill_cents).toBeGreaterThan(0);
  });

  it("folds a deferred billing adjustment into next_bill_cents, floored at zero", async () => {
    const r = await getSubscription.handler(ctx(DIEGO), {});
    const d = (r.data as SubData);
    const plan = await getPlan(d.plan);
    expect(d.next_bill_cents).toBe(Math.max(0, plan!.monthlyCents + d.billing_adjustment_cents));
    expect(d.next_bill_cents).toBeGreaterThanOrEqual(0);
  });
});
