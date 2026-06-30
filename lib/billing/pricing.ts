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

/** Whole weeks from today until an ISO date (min 0). */
export function weeksUntilDate(isoDate: string | null | undefined): number {
  if (!isoDate) return 4;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${isoDate}T00:00:00`);
  return Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86_400_000 / 7));
}

/** True if today is on or before the billing date (still within the paid period). */
export function withinBillingPeriod(isoDate: string | null | undefined): boolean {
  if (!isoDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime() <= new Date(`${isoDate}T00:00:00`).getTime();
}

/** Plan-change proration: charge (+) or refund (-) the weekly-rate difference
 *  for the weeks remaining until the billing date. */
export function prorationCents(oldWeekly: number, newWeekly: number, weeksRemaining: number): number {
  return Math.round((newWeekly - oldWeekly) * weeksRemaining);
}
