import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents } from "@/db/schema";
import { resumeDateFor } from "@/lib/tools/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PauseBody {
  customerId?: string;
  weeks?: number;
}

/** Applies a subscription pause — called by the pause confirmation prompt's
 *  Confirm button, never by the model. Validates the customer + week range. */
export async function POST(req: NextRequest) {
  let body: PauseBody;
  try {
    body = (await req.json()) as PauseBody;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { customerId } = body;
  const weeks = Math.floor(Number(body.weeks));
  if (!customerId) return new Response("Missing customerId", { status: 400 });
  if (!Number.isFinite(weeks) || weeks < 1 || weeks > 12) {
    return new Response("weeks must be between 1 and 12", { status: 400 });
  }

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!customer) return new Response("Unknown customer", { status: 404 });

  await db.update(customers).set({ subscriptionStatus: "paused" }).where(eq(customers.id, customerId));
  await db.insert(subscriptionEvents).values({
    customerId,
    eventType: "paused",
    metadata: { weeks, resumeDate: resumeDateFor(weeks) },
  });

  return Response.json({ ok: true, weeks, resume_date: resumeDateFor(weeks) });
}
