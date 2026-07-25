import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents } from "@/db/schema";
import { isDietaryTrack } from "@/lib/domain/menu";
import { actionRoute, type ActionBody } from "@/lib/http/action-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DietaryTrackBody extends ActionBody {
  track?: string;
}

/**
 * Applies a dietary-track switch and logs it. Called by the confirmation
 * prompt, never the model. Switching track is free, so no ledger row is
 * written - the audit event is the whole record.
 */
export const POST = actionRoute<DietaryTrackBody>(async ({ body, customer }) => {
  const { track } = body;
  if (!track) return new Response("Missing track", { status: 400 });
  if (!isDietaryTrack(track)) return Response.json({ ok: false, error: "unknown_track" }, { status: 400 });

  if (customer.dietaryTrack === track) {
    // Nothing to change - do not log a diet_changed event for a non-change.
    return Response.json({ ok: false, error: "same_track" }, { status: 409 });
  }

  await db.update(customers).set({ dietaryTrack: track }).where(eq(customers.id, customer.id));
  await db.insert(subscriptionEvents).values({
    customerId: customer.id,
    eventType: "diet_changed",
    metadata: { from: customer.dietaryTrack, to: track },
  });

  return Response.json({ ok: true, dietary_track: track, previous_track: customer.dietaryTrack });
});
