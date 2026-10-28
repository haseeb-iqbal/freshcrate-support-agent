import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { customers } from "../../../db/schema";
import { weeksUntilDate } from "../../billing/pricing";
import { getPlan } from "../../billing/plans";
import { quotePause } from "../../billing/quotes";
import type { SubStatus } from "../../billing/reconcile";
import { pauseLeadIn } from "../lead-ins";
import type { Tool } from "../types";
import { PAUSE_FEE_PER_WEEK } from "./fee";

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
        lead_in: pauseLeadIn(proposal),
        message:
          `A confirmation prompt is shown. Nothing is charged now. Tell the customer plainly that each paused week is billed at the ${PAUSE_FEE_PER_WEEK} pause fee instead of their usual weekly rate, until it resumes - there is NO separate credit. The plan pauses from next week (this week's box still ships) and they can resume early. Keep your reply to a short lead-in and ask them to confirm. Do NOT say it's paused until they confirm.`,
      },
    };
  },
};
