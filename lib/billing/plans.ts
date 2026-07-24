import { eq } from "drizzle-orm";
import { db } from "../../db";
import { plans } from "../../db/schema";

/**
 * Plan-rate lookups. These are the only database-touching part of billing, and
 * they live apart from `pricing.ts` and `quotes.ts` deliberately: those two are
 * pure arithmetic, and importing `db` from them would drag a live
 * `DATABASE_URL` into every unit test that only wanted to check a formula.
 */

export async function getPlan(plan: string) {
  const [row] = await db.select().from(plans).where(eq(plans.plan, plan)).limit(1);
  return row ?? null;
}

export async function listPlans() {
  return db.select().from(plans).orderBy(plans.weeklyCents);
}
