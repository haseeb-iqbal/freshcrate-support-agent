import { eq } from "drizzle-orm";
import { db } from "../../db";
import { customers, subscriptionEvents } from "../../db/schema";
import type { Tool } from "./types";

/** Write tool: pause the signed-in customer's subscription (reversible). */
export const pauseSubscription: Tool = {
  definition: {
    name: "pause_subscription",
    description:
      "Pause the current customer's subscription for a number of weeks (1-12). This skips upcoming boxes and is reversible. Use when the customer asks to pause, skip, or hold their deliveries.",
    parameters: {
      type: "object",
      properties: {
        weeks: {
          type: "integer",
          minimum: 1,
          maximum: 12,
          description: "Number of weeks to pause (1-12).",
        },
      },
      required: ["weeks"],
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const weeks = Math.floor(Number(args.weeks));
    if (!Number.isFinite(weeks) || weeks < 1 || weeks > 12) {
      return { ok: false, summary: "Pause length must be between 1 and 12 weeks." };
    }

    await db
      .update(customers)
      .set({ subscriptionStatus: "paused" })
      .where(eq(customers.id, ctx.customerId));

    await db.insert(subscriptionEvents).values({
      customerId: ctx.customerId,
      eventType: "paused",
      metadata: { weeks },
    });

    return {
      ok: true,
      summary: `Paused subscription for ${weeks} week${weeks === 1 ? "" : "s"}`,
      data: { status: "paused", weeks },
    };
  },
};
