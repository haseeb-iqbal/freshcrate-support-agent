import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents, transactions } from "@/db/schema";
import { reconcile } from "@/lib/billing/reconcile";

// Dedicated throwaway customers so we never touch seeded demo data.
const ACTIVE = "99999999-9999-9999-9999-999999990001";
const PAUSED = "99999999-9999-9999-9999-999999990002";

const txnTypes = async (id: string) =>
  (await db.select().from(transactions).where(eq(transactions.customerId, id))).map((t) => t.type).sort();

async function cleanup() {
  for (const id of [ACTIVE, PAUSED]) {
    await db.delete(transactions).where(eq(transactions.customerId, id));
    await db.delete(subscriptionEvents).where(eq(subscriptionEvents.customerId, id));
    await db.delete(customers).where(eq(customers.id, id));
  }
}

describe("reconcile (integration, seeded DB)", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required; run `npm run db:reset` first");
    await cleanup();
    await db.insert(customers).values([
      { id: ACTIVE, name: "Recon Active", email: "recon-active@example.com", subscriptionStatus: "active", plan: "2 meals/week", billingDate: "2026-01-10", lastReconciledAt: new Date("2026-01-10T00:00:00") },
      { id: PAUSED, name: "Recon Paused", email: "recon-paused@example.com", subscriptionStatus: "paused", plan: "2 meals/week", billingDate: "2026-02-20", pauseResumeDate: "2026-02-01", lastReconciledAt: new Date("2026-01-20T00:00:00") },
    ]);
  });
  afterAll(cleanup);

  it("charges every missed monthly billing and advances the billing date", async () => {
    await reconcile(ACTIVE, new Date("2026-03-15T00:00:00"));
    const rows = await db.select().from(transactions).where(and(eq(transactions.customerId, ACTIVE), eq(transactions.type, "monthly_billing")));
    expect(rows).toHaveLength(3); // Jan 10, Feb 10, Mar 10
    const [c] = await db.select().from(customers).where(eq(customers.id, ACTIVE));
    expect(c.billingDate).toBe("2026-04-10");
  });

  it("is idempotent — a second reconcile at the same instant writes nothing new", async () => {
    const before = (await txnTypes(ACTIVE)).length;
    await reconcile(ACTIVE, new Date("2026-03-15T00:00:00"));
    expect((await txnTypes(ACTIVE)).length).toBe(before);
  });

  it("auto-resumes a finite pause and records the resume charge", async () => {
    await reconcile(PAUSED, new Date("2026-03-01T00:00:00"));
    const [c] = await db.select().from(customers).where(eq(customers.id, PAUSED));
    expect(c.subscriptionStatus).toBe("active");
    expect(c.pauseResumeDate).toBeNull();
    const rows = await db.select().from(transactions).where(and(eq(transactions.customerId, PAUSED), eq(transactions.type, "resume_charge")));
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(4400); // 2 weeks to billing × ($30 − $8)
  });
});
