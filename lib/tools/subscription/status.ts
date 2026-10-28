import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../db";
import { customers, subscriptionEvents } from "../../../db/schema";
import { PAUSE_FEE_CENTS, pausedWeekReductionCents } from "../../billing/pricing";
import { getPlan } from "../../billing/plans";
import { quoteResume } from "../../billing/quotes";
import { computeReconciliation, type SubStatus } from "../../billing/reconcile";
import { money } from "../../money";
import type { Tool } from "../types";
import { PAUSE_FEE_PER_WEEK } from "./fee";

/** Read-only live subscription details. The model must call this for status /
 *  plan / billing / pause-length questions instead of trusting earlier messages
 *  (fixes stale-status answers). Also carries the actual money on the next bill,
 *  so the model can answer "what will my next bill be" with a real figure. */
export const getSubscription: Tool = {
  definition: {
    name: "get_subscription",
    description:
      "Get the current customer's LIVE subscription details: status (active/paused/cancelled), plan, dietary track, next billing date, how long/when it resumes if paused, and the money on their next monthly bill (plan_monthly_cents, any deferred billing_adjustment_cents, and the resulting next_bill_cents). For a PAUSED subscription it also returns resume_quote: what resuming would charge (charge_cents) and the next bill after resuming (next_bill_cents). When a paused customer asks what they'll pay if or when they resume, answer from resume_quote, not the stay-paused next_bill_cents, and don't call resume_subscription for a question. ALWAYS call this to answer any question about the customer's current status, plan, dietary track, billing date, pause length, or how much their next bill will be; never answer those from earlier conversation.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  async handler(ctx) {
    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };

    // Pause detail comes from the live column, so it reflects auto-resume:
    // a finite pause has a resume date; an indefinite pause has none.
    let pause: { indefinite: boolean; resume_date: string | null } | null = null;
    if (customer.subscriptionStatus === "paused") {
      pause = { indefinite: !customer.pauseResumeDate, resume_date: customer.pauseResumeDate ?? null };
    }

    // The real next bill. Run the biller forward to the next billing date so a
    // finite pause's auto-resume claws back the weeks that go active again - the
    // stored adjustment alone overstates the discount until then. A paused week
    // is billed at the $8 fee, so e.g. a one-week pause bills monthly − (weekly − $8).
    const plan = await getPlan(customer.plan);
    const monthly = plan?.monthlyCents ?? null;
    const adjustment = customer.billingAdjustmentCents;
    const nextBill = nextBillCents(customer, plan?.weeklyCents ?? null, monthly, adjustment);

    const weekly = plan?.weeklyCents ?? null;
    // Paused weeks reflected in this bill = the reduction divided by the per-week
    // reduction (weekly − $8). Lets the note say "N weeks at $8" without guessing.
    // Not after a plan switch during this pause: the credit was then earned at the
    // OLD plan's rate, so dividing by the new one miscounts (Diego's $44 is two
    // 2-meal weeks but exactly one 4-meal week) - the note calls it a credit.
    const perWeek = weekly === null ? 0 : pausedWeekReductionCents(weekly);
    const reduction = monthly !== null && nextBill !== null ? monthly - nextBill : 0;
    const paused = customer.subscriptionStatus === "paused";
    const countable =
      paused && perWeek > 0 && reduction > 0 && reduction % perWeek === 0 && !(await planChangedDuringPause(customer.id));
    const pausedWeeks = countable ? reduction / perWeek : 0;
    const nextBill_ =
      nextBill === null || monthly === null
        ? null
        : { amount_cents: nextBill, monthly_cents: monthly, pause_fee_per_week_cents: PAUSE_FEE_CENTS, paused_weeks_billed: pausedWeeks };
    const note = nextBill === null || monthly === null ? undefined : nextBillNote(nextBill, monthly, weekly, pausedWeeks, adjustment);

    // What resuming would cost - the same quote the resume prompt shows. Without
    // it the model answers "what will I pay when I resume?" with the stay-paused
    // next bill, which is a different (lower) number.
    const resumeQuote =
      paused && plan
        ? quoteResume({ currentPlan: customer.plan, billingDate: customer.billingDate, plan, billingAdjustmentCents: adjustment, now: ctx.now })
        : null;

    return {
      ok: true,
      summary: `Status ${customer.subscriptionStatus}, ${customer.plan}${nextBill === null ? "" : `, next bill ${money(nextBill)}`}`,
      data: {
        status: customer.subscriptionStatus,
        plan: customer.plan,
        dietary_track: customer.dietaryTrack,
        billing_date: customer.billingDate,
        pause,
        resume_quote: resumeQuote && {
          charge_cents: resumeQuote.charge_cents,
          next_bill_cents: resumeQuote.next_bill_cents,
          weeks_to_billing: resumeQuote.weeks_to_billing,
          note: `If they resume, ${money(resumeQuote.charge_cents)} is added to their next bill for the ${resumeQuote.weeks_to_billing} weeks left until billing, so the next bill after resuming is ${money(resumeQuote.next_bill_cents)}. Quote only these two figures for resuming; the next_bill figures describe staying paused.`,
        },
        plan_monthly_cents: monthly,
        billing_adjustment_cents: adjustment,
        next_bill_cents: nextBill,
        next_bill: nextBill_,
        next_bill_note: note,
      },
    };
  },
};

/** The actual next bill, from running the biller forward to the billing date so
 *  a finite pause's auto-resume is folded in. Falls back to monthly + adjustment
 *  when there is no plan rate or billing date to project from. */
/** Whether the plan was switched after the subscription was last paused. */
async function planChangedDuringPause(customerId: string): Promise<boolean> {
  const [latest] = await db
    .select({ eventType: subscriptionEvents.eventType })
    .from(subscriptionEvents)
    .where(and(eq(subscriptionEvents.customerId, customerId), inArray(subscriptionEvents.eventType, ["paused", "plan_changed"])))
    .orderBy(desc(subscriptionEvents.createdAt))
    .limit(1);
  return latest?.eventType === "plan_changed";
}

function nextBillCents(
  customer: { subscriptionStatus: string; billingDate: string | null; pauseResumeDate: string | null },
  weeklyCents: number | null,
  monthlyCents: number | null,
  adjustmentCents: number,
): number | null {
  if (monthlyCents === null) return null;
  if (weeklyCents === null || !customer.billingDate) return Math.max(0, monthlyCents + adjustmentCents);
  const r = computeReconciliation(
    {
      status: customer.subscriptionStatus as SubStatus,
      billingDate: customer.billingDate,
      pauseResumeDate: customer.pauseResumeDate,
      weeklyCents,
      monthlyCents,
      billingAdjustmentCents: adjustmentCents,
    },
    new Date(`${customer.billingDate}T00:00:00`),
  );
  const line = r.transactions.find((t) => t.date === customer.billingDate && t.type === "monthly_billing");
  return line ? line.amountCents : Math.max(0, monthlyCents + adjustmentCents);
}

/** A plain-language breakdown the model relays instead of guessing at the math. */
function nextBillNote(nextBill: number, monthly: number, weekly: number | null, pausedWeeks: number, adjustment: number): string {
  if (pausedWeeks > 0) {
    const rate = weekly === null ? "your usual weekly rate" : `${money(weekly)}/week`;
    return `Next bill is ${money(nextBill)}: your ${money(monthly)} plan with ${pausedWeeks} paused week${pausedWeeks === 1 ? "" : "s"} billed at ${PAUSE_FEE_PER_WEEK} instead of ${rate}. That is the whole bill - nothing else is added or taken off. Explain it from these numbers.`;
  }
  if (nextBill < monthly) {
    return `Next bill is ${money(nextBill)}: your ${money(monthly)} plan less a ${money(monthly - nextBill)} pause credit for weeks skipped while paused. That is the whole bill - nothing else is added or taken off. Explain it from these numbers.`;
  }
  if (adjustment > 0) {
    return `Next bill is ${money(nextBill)}: your ${money(monthly)} plan plus ${money(adjustment)} for the weeks added back on resuming. Explain from these numbers; do not invent a fee.`;
  }
  return `Next bill is ${money(nextBill)} (your ${money(monthly)} plan). Explain from these numbers; do not invent a fee.`;
}
