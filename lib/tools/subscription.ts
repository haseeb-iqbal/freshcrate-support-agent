import { eq } from "drizzle-orm";
import { db } from "../../db";
import { customers, subscriptionEvents } from "../../db/schema";
import { SIGNUP_FEE_CENTS, getPlan, holdFeeCents } from "../billing/pricing";
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
      "Reactivate a CANCELLED subscription. Use when a customer whose subscription is cancelled wants to sign up / start again. Calling this shows a confirmation prompt with the sign-up fee; it does NOT reactivate or charge until they confirm.",
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
    return {
      ok: true,
      summary: `Proposed reactivation (sign-up fee $${(SIGNUP_FEE_CENTS / 100).toFixed(2)})`,
      data: {
        status: "needs_confirmation",
        proposal: {
          signup_fee_cents: SIGNUP_FEE_CENTS,
          plan: customer.plan,
          monthly_cents: plan?.monthlyCents ?? 0,
        },
        message:
          "A confirmation prompt is shown with the sign-up fee and plan price. Reactivating a cancelled plan charges this one-time fee, so ask the customer to confirm before it's charged. Do NOT say it's reactivated until they confirm.",
      },
    };
  },
};
