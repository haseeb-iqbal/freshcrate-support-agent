import { eq } from "drizzle-orm";
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

/** Whole weeks between today and an ISO target date (rounded up). */
function weeksUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${isoDate}T00:00:00`);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  return Math.ceil(days / 7);
}

/**
 * Pause is propose-only: it shows the customer a confirmation prompt (resume
 * date + hold fee) and does NOT write. Accepts either a number of weeks (1-12)
 * or a target until_date — when a date is given the tool computes the duration
 * so the model never has to do date math. Applied via /api/actions/pause.
 */
export const pauseSubscription: Tool = {
  definition: {
    name: "pause_subscription",
    description:
      "Start a pause for the current customer's subscription. Provide EITHER weeks (1-12) OR until_date (YYYY-MM-DD) if the customer named a date to pause until — never convert a date to weeks yourself, pass until_date and let the tool do it. Calling this shows the customer a confirmation prompt with their resume date and the pause hold fee; it does not pause until they confirm.",
    parameters: {
      type: "object",
      properties: {
        weeks: { type: "integer", minimum: 1, maximum: 12, description: "Number of weeks to pause (1-12)." },
        until_date: { type: "string", description: "Target resume date YYYY-MM-DD, if the customer gave a date." },
      },
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    let weeks: number;
    let resumeDate: string;

    const until = args.until_date ? String(args.until_date).trim() : undefined;
    if (until) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
        return { ok: false, summary: "until_date must be in YYYY-MM-DD format." };
      }
      weeks = weeksUntil(until);
      if (weeks < 1) return { ok: false, summary: "The pause date must be in the future." };
      if (weeks > 12) {
        return { ok: false, summary: `${until} is about ${weeks} weeks away; pauses are capped at 12 weeks — ask the customer for a date within 12 weeks.` };
      }
      resumeDate = until;
    } else {
      weeks = Math.floor(Number(args.weeks));
      if (!Number.isFinite(weeks) || weeks < 1 || weeks > 12) {
        return { ok: false, summary: "Provide a pause length of 1-12 weeks (or a date within 12 weeks)." };
      }
      resumeDate = resumeDateFor(weeks);
    }

    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    const plan = customer ? await getPlan(customer.plan) : null;
    const holdFee = plan ? holdFeeCents(plan.weeklyCents, weeks) : 0;

    return {
      ok: true,
      summary: `Proposed ${weeks}-week pause (resumes ${resumeDate}, hold fee $${(holdFee / 100).toFixed(2)})`,
      data: {
        status: "needs_confirmation",
        proposal: { weeks, resume_date: resumeDate, hold_fee_cents: holdFee },
        message:
          "A confirmation prompt is shown to the customer with the resume date and a pause hold fee (they're still billed a small discounted fee to reserve their plan). Briefly let them know and ask them to confirm. Do NOT say it's paused until they confirm.",
      },
    };
  },
};

/** Resume a PAUSED subscription immediately (reactivation is low-risk, no fee). */
export const resumeSubscription: Tool = {
  definition: {
    name: "resume_subscription",
    description:
      "Resume the current customer's PAUSED subscription immediately (no fee). Use when a paused customer asks to resume, unpause, or restart. Do NOT use this for a cancelled subscription — that needs reactivate_subscription.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  async handler(ctx) {
    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };
    if (customer.subscriptionStatus === "cancelled") {
      return {
        ok: true,
        summary: "Subscription is cancelled — needs reactivation",
        data: { status: "cancelled", message: "The subscription is cancelled, not paused. Use reactivate_subscription instead (a sign-up fee applies)." },
      };
    }
    if (customer.subscriptionStatus !== "paused") {
      return { ok: true, summary: `Subscription is already ${customer.subscriptionStatus}`, data: { status: customer.subscriptionStatus, message: "Nothing to resume — tell the customer their current status." } };
    }

    await db.update(customers).set({ subscriptionStatus: "active" }).where(eq(customers.id, ctx.customerId));
    await db.insert(subscriptionEvents).values({ customerId: ctx.customerId, eventType: "resumed", metadata: {} });
    return { ok: true, summary: "Subscription resumed", data: { status: "active" } };
  },
};

/** Reactivate a CANCELLED subscription — propose-only, with a sign-up fee. */
export const reactivateSubscription: Tool = {
  definition: {
    name: "reactivate_subscription",
    description:
      "Reactivate a CANCELLED subscription. Call this immediately when a cancelled customer wants to sign up / start again — calling it shows the confirmation prompt with the cost; it does NOT reactivate or charge until they confirm via that prompt. Don't ask the customer to confirm before calling it.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  async handler(ctx) {
    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };
    if (customer.subscriptionStatus !== "cancelled") {
      return {
        ok: true,
        summary: `Subscription is ${customer.subscriptionStatus}, not cancelled`,
        data: { status: customer.subscriptionStatus, message: "The subscription isn't cancelled, so no reactivation/sign-up fee is needed. If it's paused, use resume_subscription." },
      };
    }
    const plan = await getPlan(customer.plan);
    const monthly = plan?.monthlyCents ?? 0;
    // Resubscribing within the billing period (on the same plan) waives the
    // sign-up fee — they're simply reactivated.
    const within = withinBillingPeriod(customer.billingDate);
    const signupFee = within ? 0 : SIGNUP_FEE_CENTS;
    const total = monthly + signupFee;

    return {
      ok: true,
      summary: within
        ? `Proposed reactivation (within billing period — no sign-up fee, $${(total / 100).toFixed(2)} first charge)`
        : `Proposed reactivation (sign-up $${(SIGNUP_FEE_CENTS / 100).toFixed(2)} + plan $${(monthly / 100).toFixed(2)} = $${(total / 100).toFixed(2)})`,
      data: {
        status: "needs_confirmation",
        proposal: {
          signup_fee_cents: signupFee,
          plan: customer.plan,
          monthly_cents: monthly,
          total_cents: total,
          within_billing: within,
          billing_date: customer.billingDate,
        },
        message: within
          ? "The customer cancelled but is still within their billing period on the same plan, so NO sign-up fee applies — they're just reactivated and charged their normal plan price. Ask them to confirm; do NOT say it's reactivated until they confirm."
          : "A confirmation prompt shows the first charge: the plan price plus a one-time sign-up fee. Ask the customer to confirm before it's charged. Do NOT say it's reactivated until they confirm.",
      },
    };
  },
};

/** Cancel an ACTIVE/PAUSED subscription — propose-only, with a warning that
 *  resubscribing after the billing date incurs a sign-up fee (item 10). */
export const cancelSubscription: Tool = {
  definition: {
    name: "cancel_subscription",
    description:
      "Cancel the current customer's subscription. Call this immediately when the customer asks to cancel — calling it shows the confirmation prompt (which warns that resubscribing after the billing date costs a sign-up fee). It does NOT cancel until they confirm via the prompt. Don't ask them to confirm before calling it.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  async handler(ctx) {
    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };
    if (customer.subscriptionStatus === "cancelled") {
      return { ok: true, summary: "Already cancelled", data: { status: "cancelled", message: "The subscription is already cancelled — let the customer know." } };
    }
    return {
      ok: true,
      summary: "Proposed cancellation — awaiting confirmation",
      data: {
        status: "needs_confirmation",
        proposal: { billing_date: customer.billingDate, signup_fee_cents: SIGNUP_FEE_CENTS },
        message:
          "A cancellation confirmation prompt is shown, warning that resubscribing after the billing date costs a sign-up fee (before then, same plan, is free). Briefly relay that and ask them to confirm. Do NOT say it's cancelled until they confirm.",
      },
    };
  },
};
