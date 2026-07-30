/**
 * Pure pricing arithmetic. No database, no clock — every input arrives as an
 * argument, so each rule here is checkable in isolation. Plan-rate lookups live
 * in `./plans.ts`.
 */

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
 * Plan value of a run of weeks at the given weekly rate - the basis of the
 * deferred pause credit and resume charge. Full weekly rate, NO fee netting:
 * the $8/week pause fee is applied separately, only while actually paused across
 * a billing date (see reconcile). Pass the resulting plan's weekly rate when the
 * customer switches plan while resuming.
 */
export function weeklyValueCents(weeklyCents: number, weeks: number): number {
  return Math.max(0, weeks) * weeklyCents;
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
