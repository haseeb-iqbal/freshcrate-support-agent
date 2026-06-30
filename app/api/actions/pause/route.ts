import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents } from "@/db/schema";
import { getPlan, holdFeeCents } from "@/lib/billing/pricing";
import { resumeDateFor } from "@/lib/tools/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PauseBody {
  customerId?: string;
  weeks?: number;
  resumeDate?: string;
}

/** Applies a subscription pause — called by the pause confirmation prompt's
 *  Confirm button, never by the model. Recomputes the hold fee server-side. */
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

  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return new Response("Unknown customer", { status: 404 });

  const plan = await getPlan(customer.plan);
  const holdFee = plan ? holdFeeCents(plan.weeklyCents, weeks) : 0;
  const resumeDate = body.resumeDate?.match(/^\d{4}-\d{2}-\d{2}$/) ? body.resumeDate : resumeDateFor(weeks);

  await db.update(customers).set({ subscriptionStatus: "paused" }).where(eq(customers.id, customerId));
  await db.insert(subscriptionEvents).values({
    customerId,
    eventType: "paused",
    metadata: { weeks, resumeDate, holdFeeCents: holdFee },
  });

  return Response.json({ ok: true, weeks, resume_date: resumeDate, hold_fee_cents: holdFee });
}
