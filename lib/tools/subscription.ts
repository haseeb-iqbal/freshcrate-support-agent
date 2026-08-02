import { eq } from "drizzle-orm";
import { db } from "../../db";
import { customers } from "../../db/schema";
import { PAUSE_FEE_CENTS, SIGNUP_FEE_CENTS, pausedWeekReductionCents, weeksUntilDate } from "../billing/pricing";
import { getPlan } from "../billing/plans";
import { quotePause, quoteReactivate, quoteResume } from "../billing/quotes";
import { computeReconciliation, type SubStatus } from "../billing/reconcile";
import { money } from "../money";
import type { Tool } from "./types";

/** The pause fee as it is written for humans and for the model, e.g. "$8/week".
 *  Derived so the fee quoted in tool descriptions, summaries and model-facing
 *  messages cannot drift from PAUSE_FEE_CENTS. */
const PAUSE_FEE_PER_WEEK = `${money(PAUSE_FEE_CENTS)}/week`;


/** Read-only live subscription details. The model must call this for status /
 *  plan / billing / pause-length questions instead of trusting earlier messages
 *  (fixes stale-status answers). Also carries the actual money on the next bill,
 *  so the model can answer "what will my next bill be" with a real figure. */
export const getSubscription: Tool = {
  definition: {
    name: "get_subscription",
    description:
      "Get the current customer's LIVE subscription details: status (active/paused/cancelled), plan, dietary track, next billing date, how long/when it resumes if paused, and the money on their next monthly bill (plan_monthly_cents, any deferred billing_adjustment_cents, and the resulting next_bill_cents). ALWAYS call this to answer any question about the customer's current status, plan, dietary track, billing date, pause length, or how much their next bill will be; never answer those from earlier conversation.",
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
    const perWeek = weekly === null ? 0 : pausedWeekReductionCents(weekly);
    const pausedWeeks =
      customer.subscriptionStatus === "paused" && monthly !== null && nextBill !== null && perWeek > 0
        ? Math.max(0, Math.round((monthly - nextBill) / perWeek))
        : 0;
    const nextBill_ =
      nextBill === null || monthly === null
        ? null
        : { amount_cents: nextBill, monthly_cents: monthly, pause_fee_per_week_cents: PAUSE_FEE_CENTS, paused_weeks_billed: pausedWeeks };
    const note = nextBill === null || monthly === null ? undefined : nextBillNote(nextBill, monthly, weekly, pausedWeeks, adjustment);

    return {
      ok: true,
      summary: `Status ${customer.subscriptionStatus}, ${customer.plan}${nextBill === null ? "" : `, next bill ${money(nextBill)}`}`,
      data: {
        status: customer.subscriptionStatus,
        plan: customer.plan,
        dietary_track: customer.dietaryTrack,
        billing_date: customer.billingDate,
        pause,
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
  if (adjustment > 0) {
    return `Next bill is ${money(nextBill)}: your ${money(monthly)} plan plus ${money(adjustment)} for the weeks added back on resuming. Explain from these numbers; do not invent a fee.`;
  }
  return `Next bill is ${money(nextBill)} (your ${money(monthly)} plan). Explain from these numbers; do not invent a fee.`;
}

/**
 * Pause is propose-only. Accepts weeks (1-52), a target until_date (within a
 * year), or indefinite=true. The plan pauses from next week; each paused week is
 * billed at the $8 pause fee instead of the plan's weekly rate. Shows a
 * confirmation prompt; applied via /api/actions/pause on confirm.
 */
export const pauseSubscription: Tool = {
  definition: {
    name: "pause_subscription",
    description:
      `Start a pause for the current customer's subscription. Provide EITHER weeks (1-52), OR until_date (YYYY-MM-DD, within a year) if they named a date (never convert a date to weeks yourself), OR indefinite=true to pause indefinitely (resume anytime). Each paused week is billed at the ${PAUSE_FEE_PER_WEEK} pause fee instead of the plan's weekly rate; calling this shows a confirmation prompt and does not pause until they confirm. Call this ONLY when the customer is asking to start a pause or to change a pause's length/date. Do NOT call it to explain or answer a QUESTION about a pause that is already shown or that they mentioned ("what do you mean", "why", "how much is the fee/next bill") - answer that in words, using get_subscription for any figure.`,
    parameters: {
      type: "object",
      properties: {
        weeks: { type: "integer", minimum: 1, maximum: 52, description: "Number of weeks to pause (1-52)." },
        until_date: { type: "string", description: "Target resume date YYYY-MM-DD (within a year), if the customer gave a date." },
        indefinite: { type: "boolean", description: "Set true to pause indefinitely (no fixed resume date)." },
      },
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const indefinite = args.indefinite === true;
    let weeks: number | null = null;
    let resumeDate: string | null = null;

    if (!indefinite) {
      const until = args.until_date ? String(args.until_date).trim() : undefined;
      if (until) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return { ok: false, summary: "until_date must be YYYY-MM-DD." };
        weeks = weeksUntilDate(until, ctx.now);
        if (weeks < 1) return { ok: false, summary: "The pause date must be at least a week in the future." };
        if (weeks > 52) return { ok: false, summary: `${until} is about ${weeks} weeks away; pauses are capped at 52 weeks unless indefinite.` };
        resumeDate = until;
      } else {
        weeks = Math.floor(Number(args.weeks));
        if (!Number.isFinite(weeks) || weeks < 1 || weeks > 52) {
          return { ok: false, summary: "Provide 1-52 weeks, a date within a year, or indefinite." };
        }
      }
    }

    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };
    if (customer.subscriptionStatus === "cancelled") {
      return { ok: true, summary: "Cancelled — can't pause", data: { status: "cancelled", message: "A cancelled subscription can't be paused; tell the customer they'd need to reactivate first." } };
    }
    if (customer.subscriptionStatus === "paused") {
      // Already paused — there is nothing to pause, so surface NO card. Guarding
      // here (like resume/reactivate/cancel do) stops a stray pause_subscription
      // call — e.g. on a billing question — from popping a fresh pause prompt.
      const resumeNote = customer.pauseResumeDate ? ` (set to resume ${customer.pauseResumeDate})` : " indefinitely";
      return {
        ok: true,
        summary: "Already paused — no pause prompt",
        data: {
          status: "already_paused",
          message:
            `The subscription is already paused${resumeNote}. Do NOT show a pause prompt or claim to pause it again. Just tell the customer it's already paused; if they want it to run again use resume_subscription, and if they only asked a question, answer it.`,
        },
      };
    }

    // The same quote /api/actions/pause applies on confirm, so the card and the
    // write path can't disagree.
    const proposal = quotePause({
      status: customer.subscriptionStatus as SubStatus,
      billingDate: customer.billingDate,
      plan: await getPlan(customer.plan),
      indefinite,
      weeks,
      resumeDate,
      now: ctx.now,
    });

    const summary = indefinite
      ? `Proposed indefinite pause (${PAUSE_FEE_PER_WEEK} while paused)`
      : `Proposed ${weeks}-week pause (resumes ${proposal.resume_date}, ${PAUSE_FEE_PER_WEEK} while paused)`;

    return {
      ok: true,
      summary,
      data: {
        status: "needs_confirmation",
        proposal,
        message:
          `A confirmation prompt is shown. Nothing is charged now. Tell the customer plainly that each paused week is billed at the ${PAUSE_FEE_PER_WEEK} pause fee instead of their usual weekly rate, until it resumes - there is NO separate credit. The plan pauses from next week (this week's box still ships) and they can resume early. Keep your reply to a short lead-in and ask them to confirm. Do NOT say it's paused until they confirm.`,
      },
    };
  },
};

/**
 * Resume is propose-only. Optionally switch plan at the same time (new_plan).
 * Resuming returns the weeks left to billing to the plan's weekly rate (they no
 * longer bill at the $8 pause fee), which is deferred to the next monthly bill;
 * the plan resumes from next week. Applied via /api/actions/resume on confirm.
 */
export const resumeSubscription: Tool = {
  definition: {
    name: "resume_subscription",
    description:
      "Resume the current customer's PAUSED subscription. Optionally pass new_plan (e.g. '3 meals/week') to resume AND switch plan in one step. Calling this shows a confirmation prompt with the resume charge; it does NOT resume or charge until they confirm. NOT for a cancelled subscription — that needs reactivate_subscription. Don't ask them to confirm before calling. Call this ONLY when the customer is asking to resume (or resume-and-switch). Do NOT call it to answer a QUESTION about resuming or about their next bill while paused - answer that in words, using get_subscription for any figure.",
    parameters: {
      type: "object",
      properties: {
        new_plan: { type: "string", description: "Optional plan to switch to while resuming (e.g. '3 meals/week')." },
      },
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };
    if (customer.subscriptionStatus === "cancelled") {
      return { ok: true, summary: "Cancelled — needs reactivation", data: { status: "cancelled", message: "The subscription is cancelled, not paused. Use reactivate_subscription instead." } };
    }
    if (customer.subscriptionStatus !== "paused") {
      return { ok: true, summary: `Already ${customer.subscriptionStatus}`, data: { status: customer.subscriptionStatus, message: "Nothing to resume — tell the customer their current status." } };
    }

    const requestedPlan = args.new_plan ? String(args.new_plan).trim() : undefined;
    const plan = await getPlan(requestedPlan || customer.plan);
    if (!plan) return { ok: false, summary: `Unknown plan "${requestedPlan}"`, data: { message: "That plan doesn't exist — ask the customer to pick 2, 3, or 4 meals/week." } };

    // The same quote /api/actions/resume applies on confirm.
    const proposal = quoteResume({
      currentPlan: customer.plan,
      billingDate: customer.billingDate,
      plan,
      requestedPlan,
      billingAdjustmentCents: customer.billingAdjustmentCents,
      now: ctx.now,
    });
    const charge = money(proposal.charge_cents);
    const nextBill = money(proposal.next_bill_cents);

    return {
      ok: true,
      summary: proposal.plan_changed
        ? `Proposed resume on ${proposal.plan} - next bill ${nextBill}`
        : `Proposed resume - next bill ${nextBill}`,
      data: {
        status: "needs_confirmation",
        proposal,
        message:
          `A confirmation prompt shows the resume. Nothing is charged now: resuming returns the weeks left until billing to the normal weekly rate (they stop billing at the ${PAUSE_FEE_PER_WEEK} pause fee), which adds ${charge}, so their next monthly bill will be exactly ${nextBill}. The plan resumes from next week. The card shows the exact ${nextBill} figure - do NOT state a different amount in your reply; keep it to a short lead-in and ask them to confirm. Do NOT say it's resumed until they confirm.`,
      },
    };
  },
};

/**
 * Reactivate a CANCELLED subscription — propose-only. Optionally switch plan at
 * the same time. Within the billing period on the same plan it's FREE (no fee,
 * no charge); otherwise the first charge is the plan price + a sign-up fee.
 */
export const reactivateSubscription: Tool = {
  definition: {
    name: "reactivate_subscription",
    description:
      "Reactivate a CANCELLED subscription. Call this immediately when a cancelled customer wants to start again. Optionally pass new_plan (e.g. '3 meals/week') to reactivate AND switch plan in one step. Shows a confirmation prompt with the cost; it does NOT reactivate or charge until they confirm. Don't ask them to confirm before calling.",
    parameters: {
      type: "object",
      properties: {
        new_plan: { type: "string", description: "Optional plan to switch to while reactivating (e.g. '3 meals/week')." },
      },
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };
    if (customer.subscriptionStatus !== "cancelled") {
      return { ok: true, summary: `${customer.subscriptionStatus}, not cancelled`, data: { status: customer.subscriptionStatus, message: "Not cancelled — no reactivation needed. If paused, use resume_subscription." } };
    }

    const requestedPlan = args.new_plan ? String(args.new_plan).trim() : undefined;
    const plan = await getPlan(requestedPlan || customer.plan);
    if (!plan) return { ok: false, summary: `Unknown plan "${requestedPlan}"`, data: { message: "That plan doesn't exist — ask the customer to pick 2, 3, or 4 meals/week." } };

    // The same quote /api/actions/reactivate applies on confirm.
    const proposal = quoteReactivate({
      currentPlan: customer.plan,
      billingDate: customer.billingDate,
      plan,
      requestedPlan,
      now: ctx.now,
    });
    const free = proposal.free;

    return {
      ok: true,
      summary: free
        ? "Proposed reactivation — free (within billing period, same plan)"
        : `Proposed reactivation on ${proposal.plan} — first charge ${money(proposal.total_cents)}`,
      data: {
        status: "needs_confirmation",
        proposal,
        message: free
          ? "The customer is within their billing period on the same plan, so reactivation is FREE (no charge). Ask them to confirm; do NOT say it's done until they confirm."
          : "A confirmation prompt shows the first charge (plan price plus sign-up fee where it applies). Ask them to confirm before it's charged; do NOT say it's reactivated until they confirm.",
      },
    };
  },
};

/** Cancel an ACTIVE/PAUSED subscription — propose-only, with a resubscription
 *  sign-up-fee warning. */
export const cancelSubscription: Tool = {
  definition: {
    name: "cancel_subscription",
    description:
      "Cancel the current customer's subscription. Call this immediately when the customer asks to cancel — calling it shows the confirmation prompt (which warns that resubscribing after the billing date costs a sign-up fee). It does NOT cancel until they confirm. Don't ask them to confirm before calling.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  async handler(ctx) {
    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };
    if (customer.subscriptionStatus === "cancelled") {
      return { ok: true, summary: "Already cancelled", data: { status: "cancelled", message: "Already cancelled — let the customer know." } };
    }
    return {
      ok: true,
      summary: "Proposed cancellation — awaiting confirmation",
      data: {
        status: "needs_confirmation",
        proposal: { billing_date: customer.billingDate, signup_fee_cents: SIGNUP_FEE_CENTS },
        message:
          "A cancellation prompt is shown, warning that resubscribing after the billing date costs a sign-up fee (before then, same plan, is free). Briefly relay that and ask them to confirm. Do NOT say it's cancelled until they confirm.",
      },
    };
  },
};
