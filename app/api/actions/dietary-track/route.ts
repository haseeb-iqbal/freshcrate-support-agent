import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents } from "@/db/schema";
import { isDietaryTrack } from "@/lib/domain/menu";
import { reconcile } from "@/lib/billing/reconcile";
import { now } from "@/lib/clock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DietaryTrackBody {
  customerId?: string;
  track?: string;
}

/**
 * Applies a dietary-track switch and logs it. Called by the confirmation
 * prompt, never the model. Switching track is free, so no ledger row is
 * written - the audit event is the whole record.
 */
export async function POST(req: NextRequest) {
  let body: DietaryTrackBody;
  try {
    body = (await req.json()) as DietaryTrackBody;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { customerId, track } = body;
  if (!customerId || !track) return new Response("Missing customerId or track", { status: 400 });
  if (!isDietaryTrack(track)) return Response.json({ ok: false, error: "unknown_track" }, { status: 400 });

  await reconcile(customerId, now());
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return new Response("Unknown customer", { status: 404 });
  if (customer.dietaryTrack === track) {
    // Nothing to change - do not log a diet_changed event for a non-change.
    return Response.json({ ok: false, error: "same_track" }, { status: 409 });
  }

  await db.update(customers).set({ dietaryTrack: track }).where(eq(customers.id, customerId));
  await db.insert(subscriptionEvents).values({
    customerId,
    eventType: "diet_changed",
    metadata: { from: customer.dietaryTrack, to: track },
  });

  return Response.json({ ok: true, dietary_track: track, previous_track: customer.dietaryTrack });
}
