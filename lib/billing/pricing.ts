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

/** Local midnight of the given instant. */
function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Whole days from `today` to an ISO date (negative once the date has passed). */
function daysUntil(isoDate: string, today: Date): number {
  const target = new Date(`${isoDate}T00:00:00`);
  return Math.round((target.getTime() - startOfDay(today).getTime()) / 86_400_000);
}

/**
 * Weeks remaining until the billing date - the basis of every money calculation
 * (pause reimbursement, resume charge, plan-change proration).
 *
 * Counted INCLUSIVE of both today and the billing day, then divided by 7 and
 * floored. With billing on the 27th: the 21st is 1 week (7 days inclusive), the
 * 22nd is 0 (6 days inclusive). Never negative.
 */
export function weeksUntilDate(isoDate: string | null | undefined, today: Date): number {
  if (!isoDate) return 4; // no billing date on file - assume a full month
  return Math.max(0, Math.floor((daysUntil(isoDate, today) + 1) / 7));
}

/** True if today is on or before the billing date (still within the paid period). */
export function withinBillingPeriod(isoDate: string | null | undefined, today: Date): boolean {
  if (!isoDate) return false;
  return daysUntil(isoDate, today) >= 0;
}

/** Plan-change proration: charge (+) or refund (-) the weekly-rate difference
 *  for the weeks remaining until the billing date. */
export function prorationCents(oldWeekly: number, newWeekly: number, weeksRemaining: number): number {
  return Math.round((newWeekly - oldWeekly) * weeksRemaining);
}
