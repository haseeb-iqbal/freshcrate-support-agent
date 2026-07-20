import { eq } from "drizzle-orm";
import { db } from "../../db";
import { plans } from "../../db/schema";

/** One-time fee to reactivate a cancelled subscription. */
export const SIGNUP_FEE_CENTS = Number(process.env.SIGNUP_FEE_CENTS ?? 4000); // $40

/** À-la-carte list price of one meal. Subscription meals are free; this is what
 *  an extra meal costs, and the basis of the "you save vs à la carte" figure. */
export const MEAL_LIST_PRICE_CENTS = 1750; // $17.50

/** Flat weekly fee to keep a plan reserved while paused. */
export const PAUSE_FEE_CENTS = 800; // $8/week

/** Weekly saving of a plan vs buying the same number of meals à la carte. */
export function weeklySavingsCents(mealsPerWeek: number, planWeeklyCents: number): number {
  return MEAL_LIST_PRICE_CENTS * mealsPerWeek - planWeeklyCents;
}

/**
 * Credit given when a subscription is paused: for each week skipped before the
 * next billing date, the customer gets their plan's weekly value back minus the
 * $8/week pause fee. A finite pause only counts the weeks it actually covers
 * before billing (`min(pauseWeeks, weeksToBilling)`); an indefinite pause
 * (`pauseWeeks === null`) counts every week to billing.
 */
export function pauseReimbursementCents(weeklyCents: number, pauseWeeks: number | null, weeksToBilling: number): number {
  const weeks = pauseWeeks === null ? weeksToBilling : Math.min(pauseWeeks, weeksToBilling);
  return Math.max(0, weeks) * (weeklyCents - PAUSE_FEE_CENTS);
}

/**
 * Charge applied when a paused subscription resumes: the weeks remaining until
 * billing at the given weekly rate, net of the $8/week pause fee. Pass the NEW
 * plan's weekly rate when the customer switches plan while resuming.
 */
export function resumeChargeCents(weeklyCents: number, weeksToBilling: number): number {
  return Math.max(0, weeksToBilling) * (weeklyCents - PAUSE_FEE_CENTS);
}

export async function getPlan(plan: string) {
  const [row] = await db.select().from(plans).where(eq(plans.plan, plan)).limit(1);
  return row ?? null;
}

export async function listPlans() {
  return db.select().from(plans).orderBy(plans.weeklyCents);
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
