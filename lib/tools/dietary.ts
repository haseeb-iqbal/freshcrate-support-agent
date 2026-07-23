import { eq } from "drizzle-orm";
import { db } from "../../db";
import { customers } from "../../db/schema";
import { DIETARY_TRACKS, isDietaryTrack, mealsForTrack } from "../domain/menu";
import { addWeeksIso } from "../date";
import type { Tool } from "./types";

/**
 * Switching dietary track costs nothing and moves no money, but it still goes
 * through propose→confirm like every other account change: the model proposes,
 * the customer confirms, and only /api/actions/dietary-track writes. A misread
 * request ("my sister is vegetarian") must not be able to move a coeliac
 * customer off the gluten-free track on its own.
 */
export const changeDietaryTrack: Tool = {
  definition: {
    name: "change_dietary_track",
    description:
      "Switch the current customer's dietary track. Valid tracks: standard, gluten-free, vegetarian, dairy-free. Calling this shows a confirmation prompt with the new track and a few of its meals; it does NOT change anything until they confirm. Don't ask them to confirm before calling.",
    parameters: {
      type: "object",
      properties: {
        track: {
          type: "string",
          enum: [...DIETARY_TRACKS],
          description: "The dietary track to switch to.",
        },
      },
      required: ["track"],
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const requested = typeof args.track === "string" ? args.track.trim().toLowerCase() : "";
    if (!isDietaryTrack(requested)) {
      return {
        ok: false,
        summary: `Unknown track "${String(args.track)}"`,
        data: { message: `That isn't one of our dietary tracks. Offer them: ${DIETARY_TRACKS.join(", ")}.` },
      };
    }

    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };

    if (customer.dietaryTrack === requested) {
      return {
        ok: true,
        summary: `Already on ${requested}`,
        data: {
          status: "no_change",
          dietary_track: requested,
          message: "They are already on that track. Tell them so; there is nothing to confirm.",
        },
      };
    }

    return {
      ok: true,
      summary: `Proposed switch to ${requested}`,
      data: {
        status: "needs_confirmation",
        proposal: {
          current_track: customer.dietaryTrack,
          new_track: requested,
          effective_from: addWeeksIso(1, ctx.now),
          meals_preview: mealsForTrack(requested).slice(0, 3).map((m) => m.name),
        },
        message:
          "A confirmation prompt shows the new track and a few of its meals. The switch applies from next week's menu; boxes already processing or shipped are packed and keep their meals. Ask them to confirm; do NOT say it's changed until they confirm.",
      },
    };
  },
};
