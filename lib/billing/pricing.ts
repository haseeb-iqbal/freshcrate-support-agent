import { eq } from "drizzle-orm";
import { db } from "../../db";
import { plans } from "../../db/schema";

/** One-time fee to reactivate a cancelled subscription. */
export const SIGNUP_FEE_CENTS = Number(process.env.SIGNUP_FEE_CENTS ?? 1500); // $15

const HOLD_FEE_RATE = 0.2; // pause hold fee = 20% of the skipped boxes' value

export async function getPlan(plan: string) {
  const [row] = await db.select().from(plans).where(eq(plans.plan, plan)).limit(1);
  return row ?? null;
}

export async function listPlans() {
  return db.select().from(plans).orderBy(plans.weeklyCents);
}

/** Pause hold fee: keeps the customer's plan reserved while paused. */
export function holdFeeCents(weeklyCents: number, weeks: number): number {
  return Math.round(weeklyCents * weeks * HOLD_FEE_RATE);
}
