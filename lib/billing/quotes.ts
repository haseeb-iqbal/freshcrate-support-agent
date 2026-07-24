import {
  PAUSE_FEE_CENTS,
  SIGNUP_FEE_CENTS,
  pauseReimbursementCents,
  prorationCents,
  resumeChargeCents,
  weeklySavingsCents,
  weeksUntilDate,
  withinBillingPeriod,
} from "./pricing";
import { addMonthsIso, addWeeksIso } from "../date";
import type { SubStatus } from "./reconcile";

/**
 * Money quotes for the four subscription actions.
 *
 * Every one of these actions is quoted twice: once by the tool that PROPOSES it
 * (to fill the confirmation card) and again by the `/api/actions/*` route that
 * APPLIES it (which must never trust a number that came back from the client).
 * Both sides used to compose `getPlan` + `weeksUntilDate` + the pricing helper
 * themselves, so the two could drift apart silently - and had: a pause proposed
 * for an ALREADY-PAUSED customer quoted a credit on the card that the route then
 * refused to pay, because only the route knew that rule.
 *
 * These functions are the shared composition. The route still re-fetches the
 * customer and re-runs its own guards; it just no longer recomputes the money by
 * hand. They are deliberately pure - plan rates come in as arguments rather than
 * being looked up - so the rules are unit-testable without a database.
 */

/** A row of the `plans` table, reduced to what a quote needs. */
export interface PlanRate {
  plan: string;
  mealsPerWeek: number;
  weeklyCents: number;
  monthlyCents: number;
}

// --- pause -------------------------------------------------------------------

export interface PauseQuote {
  indefinite: boolean;
  weeks: number | null;
  resume_date: string | null;
  reimbursement_cents: number;
  weekly_fee_cents: number;
  weeks_to_billing: number;
  /**
   * True when the subscription was already paused. The up-front credit pays back
   * the already-paid weeks of the CURRENT billing period, so extending or
   * replaying a pause must not buy those weeks back a second time.
   */
  already_paused: boolean;
}

export function quotePause(input: {
  status: SubStatus;
  billingDate: string | null;
  plan: PlanRate | null;
  indefinite: boolean;
  /** Resolved pause length; null when indefinite. */
  weeks: number | null;
  /** An explicit resume date, when the customer named one. */
  resumeDate?: string | null;
  now: Date;
}): PauseQuote {
  const { status, billingDate, plan, indefinite, weeks, now } = input;
  const weeksToBilling = weeksUntilDate(billingDate, now);
  const alreadyPaused = status === "paused";

  const earned = plan ? pauseReimbursementCents(plan.weeklyCents, indefinite ? null : weeks, weeksToBilling) : 0;

  return {
    indefinite,
    weeks: indefinite ? null : weeks,
    resume_date: indefinite ? null : (input.resumeDate ?? addWeeksIso(weeks ?? 0, now)),
    reimbursement_cents: alreadyPaused ? 0 : earned,
    weekly_fee_cents: PAUSE_FEE_CENTS,
    weeks_to_billing: weeksToBilling,
    already_paused: alreadyPaused,
  };
}

// --- resume ------------------------------------------------------------------

export interface ResumeQuote {
  plan: string;
  previous_plan: string;
  plan_changed: boolean;
  weekly_cents: number;
  weekly_fee_cents: number;
  charge_cents: number;
  weeks_to_billing: number;
  billing_date: string | null;
}

export function quoteResume(input: {
  currentPlan: string;
  billingDate: string | null;
  /** The plan being resumed onto - the new one when switching, else the current. */
  plan: PlanRate;
  /** Set only when the customer asked to switch plan while resuming. */
  requestedPlan?: string;
  now: Date;
}): ResumeQuote {
  const { currentPlan, billingDate, plan, requestedPlan, now } = input;
  const weeksToBilling = weeksUntilDate(billingDate, now);

  return {
    plan: plan.plan,
    previous_plan: currentPlan,
    plan_changed: !!requestedPlan && requestedPlan !== currentPlan,
    weekly_cents: plan.weeklyCents,
    weekly_fee_cents: PAUSE_FEE_CENTS,
    charge_cents: resumeChargeCents(plan.weeklyCents, weeksToBilling),
    weeks_to_billing: weeksToBilling,
    billing_date: billingDate,
  };
}

// --- reactivate --------------------------------------------------------------

export interface ReactivateQuote {
  plan: string;
  previous_plan: string;
  plan_changed: boolean;
  monthly_cents: number;
  signup_fee_cents: number;
  total_cents: number;
  free: boolean;
  within_billing: boolean;
  billing_date: string | null;
  /**
   * The billing date to store on reactivation. A subscription cancelled before
   * its billing date passed still carries that stale date; handing it back to
   * reconcile unchanged would back-bill every month the customer was cancelled.
   */
  next_billing_date: string | null;
}

export function quoteReactivate(input: {
  currentPlan: string;
  billingDate: string | null;
  plan: PlanRate;
  requestedPlan?: string;
  now: Date;
}): ReactivateQuote {
  const { currentPlan, billingDate, plan, requestedPlan, now } = input;
  const planChanged = !!requestedPlan && requestedPlan !== currentPlan;
  const within = withinBillingPeriod(billingDate, now);
  // Free only when resubscribing within the billing period on the SAME plan.
  const free = within && !planChanged;
  const signupFee = within ? 0 : SIGNUP_FEE_CENTS;

  return {
    plan: plan.plan,
    previous_plan: currentPlan,
    plan_changed: planChanged,
    monthly_cents: plan.monthlyCents,
    signup_fee_cents: signupFee,
    total_cents: free ? 0 : plan.monthlyCents + signupFee,
    free,
    within_billing: within,
    billing_date: billingDate,
    next_billing_date: within ? billingDate : addMonthsIso(1, now),
  };
}

// --- change plan -------------------------------------------------------------

export interface PlanChangeQuote {
  plan: string;
  monthly_cents: number;
  weekly_cents: number;
  current_plan: string | null;
  proration_cents: number;
  weeks_until_billing: number;
  billing_date: string | null;
  weekly_savings_cents: number;
}

export function quotePlanChange(input: {
  currentPlan: PlanRate | null;
  billingDate: string | null;
  plan: PlanRate;
  now: Date;
}): PlanChangeQuote {
  const { currentPlan, billingDate, plan, now } = input;
  const weeksLeft = weeksUntilDate(billingDate, now);

  return {
    plan: plan.plan,
    monthly_cents: plan.monthlyCents,
    weekly_cents: plan.weeklyCents,
    current_plan: currentPlan?.plan ?? null,
    proration_cents: currentPlan ? prorationCents(currentPlan.weeklyCents, plan.weeklyCents, weeksLeft) : 0,
    weeks_until_billing: weeksLeft,
    billing_date: billingDate,
    weekly_savings_cents: weeklySavingsCents(plan.mealsPerWeek, plan.weeklyCents),
  };
}
