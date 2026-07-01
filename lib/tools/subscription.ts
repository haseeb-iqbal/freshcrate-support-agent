import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { customers, subscriptionEvents } from "../../db/schema";
import { SIGNUP_FEE_CENTS, getPlan, holdFeeCents, withinBillingPeriod } from "../billing/pricing";
import type { Tool } from "./types";

/** Resume date for an N-week pause, as an ISO date string (YYYY-MM-DD). */
export function resumeDateFor(weeks: number): string {
  const d = new Date();
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function weeksUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${isoDate}T00:00:00`);
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000 / 7);
}

/** Read-only live subscription details. The model must call this for status /
 *  plan / billing / pause-length questions instead of trusting earlier messages
 *  (fixes stale-status answers). */
export const getSubscription: Tool = {
  definition: {
    name: "get_subscription",
    description:
      "Get the current customer's LIVE subscription details: status (active/paused/cancelled), plan, next billing date, and — if paused — how long / when it resumes. ALWAYS call this to answer any question about the customer's current status, plan, billing date, or pause length; never answer those from earlier conversation.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  async handler(ctx) {
    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };

    let pause: { indefinite: boolean; weeks: number | null; resume_date: string | null } | null = null;
    if (customer.subscriptionStatus === "paused") {
      const [last] = await db
        .select()
        .from(subscriptionEvents)
        .where(and(eq(subscriptionEvents.customerId, ctx.customerId), eq(subscriptionEvents.eventType, "paused")))
        .orderBy(desc(subscriptionEvents.createdAt))
        .limit(1);
      const m = (last?.metadata ?? {}) as { weeks?: number | null; resumeDate?: string | null; indefinite?: boolean };
      pause = { indefinite: !!m.indefinite, weeks: m.weeks ?? null, resume_date: m.resumeDate ?? null };
    }

    return {
      ok: true,
      summary: `Status ${customer.subscriptionStatus}, ${customer.plan}`,
      data: {
        status: customer.subscriptionStatus,
        plan: customer.plan,
        billing_date: customer.billingDate,
        pause,
      },
    };
  },
};

/**
 * Pause is propose-only. Accepts weeks (1-12), a target until_date, or
 * indefinite=true (resume anytime). Shows a confirmation prompt with the resume
 * date + hold fee; applied via /api/actions/pause on confirm.
 */
export const pauseSubscription: Tool = {
  definition: {
    name: "pause_subscription",
    description:
      "Start a pause for the current customer's subscription. Provide EITHER weeks (1-12), OR until_date (YYYY-MM-DD) if they named a date (never convert a date to weeks yourself), OR indefinite=true to pause indefinitely (resume anytime). Calling this shows a confirmation prompt with the resume date and hold fee; it does not pause until they confirm.",
    parameters: {
      type: "object",
      properties: {
        weeks: { type: "integer", minimum: 1, maximum: 12, description: "Number of weeks to pause (1-12)." },
        until_date: { type: "string", description: "Target resume date YYYY-MM-DD, if the customer gave a date." },
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
        weeks = weeksUntil(until);
        if (weeks < 1) return { ok: false, summary: "The pause date must be in the future." };
        if (weeks > 12) return { ok: false, summary: `${until} is about ${weeks} weeks away; pauses are capped at 12 weeks unless indefinite.` };
        resumeDate = until;
      } else {
        weeks = Math.floor(Number(args.weeks));
        if (!Number.isFinite(weeks) || weeks < 1 || weeks > 12) {
          return { ok: false, summary: "Provide 1-12 weeks, a date within 12 weeks, or indefinite." };
        }
        resumeDate = resumeDateFor(weeks);
      }
    }

    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    const plan = customer ? await getPlan(customer.plan) : null;
    // Indefinite pauses bill the hold fee monthly (≈4 weeks); finite pauses bill once.
    const holdFee = plan ? holdFeeCents(plan.weeklyCents, indefinite ? 4 : weeks!) : 0;

    return {
      ok: true,
      summary: indefinite
        ? `Proposed indefinite pause (hold fee $${(holdFee / 100).toFixed(2)}/month)`
        : `Proposed ${weeks}-week pause (resumes ${resumeDate}, hold fee $${(holdFee / 100).toFixed(2)})`,
      data: {
        status: "needs_confirmation",
        proposal: { indefinite, weeks, resume_date: resumeDate, hold_fee_cents: holdFee },
        message:
          "A confirmation prompt with the pause details and hold fee is shown to the customer. Briefly let them know and ask them to confirm. Do NOT say it's paused until they confirm.",
      },
    };
  },
};

/** Resume a PAUSED subscription immediately (low-risk, no fee). */
export const resumeSubscription: Tool = {
  definition: {
    name: "resume_subscription",
    description:
      "Resume the current customer's PAUSED subscription immediately (no fee, no confirmation). Use when a paused customer asks to resume/unpause. NOT for a cancelled subscription — that needs reactivate_subscription.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  async handler(ctx) {
    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };
    if (customer.subscriptionStatus === "cancelled") {
      return { ok: true, summary: "Cancelled — needs reactivation", data: { status: "cancelled", message: "The subscription is cancelled, not paused. Use reactivate_subscription instead." } };
    }
    if (customer.subscriptionStatus !== "paused") {
      return { ok: true, summary: `Already ${customer.subscriptionStatus}`, data: { status: customer.subscriptionStatus, message: "Nothing to resume — tell the customer their current status." } };
    }
    await db.update(customers).set({ subscriptionStatus: "active" }).where(eq(customers.id, ctx.customerId));
    await db.insert(subscriptionEvents).values({ customerId: ctx.customerId, eventType: "resumed", metadata: {} });
    return { ok: true, summary: "Subscription resumed", data: { status: "active" } };
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
    const effectivePlan = requestedPlan || customer.plan;
    const plan = await getPlan(effectivePlan);
    if (!plan) return { ok: false, summary: `Unknown plan "${requestedPlan}"`, data: { message: "That plan doesn't exist — ask the customer to pick 2, 3, or 4 meals/week." } };

    const planChanged = !!requestedPlan && requestedPlan !== customer.plan;
    const within = withinBillingPeriod(customer.billingDate);
    // Free only when resubscribing within the billing period on the SAME plan.
    const free = within && !planChanged;
    const signupFee = within ? 0 : SIGNUP_FEE_CENTS;
    const total = free ? 0 : plan.monthlyCents + signupFee;

    return {
      ok: true,
      summary: free
        ? "Proposed reactivation — free (within billing period, same plan)"
        : `Proposed reactivation on ${effectivePlan} — first charge $${(total / 100).toFixed(2)}`,
      data: {
        status: "needs_confirmation",
        proposal: {
          plan: effectivePlan,
          previous_plan: customer.plan,
          plan_changed: planChanged,
          monthly_cents: plan.monthlyCents,
          signup_fee_cents: signupFee,
          total_cents: total,
          free,
          within_billing: within,
          billing_date: customer.billingDate,
        },
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
