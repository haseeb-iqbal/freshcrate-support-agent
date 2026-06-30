import { eq } from "drizzle-orm";
import { db } from "../../db";
import { customers, subscriptionEvents } from "../../db/schema";
import type { Tool } from "./types";

/** Resume date for an N-week pause, as an ISO date string (YYYY-MM-DD). */
export function resumeDateFor(weeks: number): string {
  const d = new Date();
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Pause is propose-only: it shows the customer a confirmation prompt (with the
 * resume date) and does NOT write. The pause is applied via /api/actions/pause
 * when the customer confirms.
 */
export const pauseSubscription: Tool = {
  definition: {
    name: "pause_subscription",
    description:
      "Start a pause for the current customer's subscription for a number of weeks (1-12). Call this immediately whenever the customer asks to pause, skip, or hold deliveries — calling it is what shows the customer a confirmation prompt with their resume date. It does NOT pause until they confirm via that prompt, so don't ask the customer for permission before calling this; just call it.",
    parameters: {
      type: "object",
      properties: {
        weeks: { type: "integer", minimum: 1, maximum: 12, description: "Number of weeks to pause (1-12)." },
      },
      required: ["weeks"],
      additionalProperties: false,
    },
  },
  async handler(_ctx, args) {
    const weeks = Math.floor(Number(args.weeks));
    if (!Number.isFinite(weeks) || weeks < 1 || weeks > 12) {
      return { ok: false, summary: "Pause length must be between 1 and 12 weeks." };
    }
    const resumeDate = resumeDateFor(weeks);
    return {
      ok: true,
      summary: `Proposed ${weeks}-week pause (resumes ${resumeDate}) — awaiting confirmation`,
      data: {
        status: "needs_confirmation",
        proposal: { weeks, resume_date: resumeDate },
        message:
          "A confirmation prompt has been shown to the customer with the resume date. Ask them to confirm to apply the pause. Do NOT say the subscription is paused yet — it only pauses once they confirm.",
      },
    };
  },
};

/** Resume a paused subscription immediately (reactivation is low-risk). */
export const resumeSubscription: Tool = {
  definition: {
    name: "resume_subscription",
    description:
      "Resume the current customer's paused subscription, reactivating upcoming deliveries. Use when the customer asks to resume, unpause, restart, or reactivate their subscription.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  async handler(ctx) {
    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, ctx.customerId))
      .limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };
    if (customer.subscriptionStatus !== "paused") {
      return {
        ok: true,
        summary: `Subscription is already ${customer.subscriptionStatus}`,
        data: { status: customer.subscriptionStatus, message: "The subscription was not paused, so there is nothing to resume. Tell the customer their current status." },
      };
    }

    await db.update(customers).set({ subscriptionStatus: "active" }).where(eq(customers.id, ctx.customerId));
    await db.insert(subscriptionEvents).values({ customerId: ctx.customerId, eventType: "resumed", metadata: {} });

    return { ok: true, summary: "Subscription resumed", data: { status: "active" } };
  },
};
