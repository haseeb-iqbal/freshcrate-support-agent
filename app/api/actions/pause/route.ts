import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents, transactions } from "@/db/schema";
import { getPlan, holdFeeCents } from "@/lib/billing/pricing";
import { resumeDateFor } from "@/lib/tools/subscription";
import { now } from "@/lib/clock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PauseBody {
  customerId?: string;
  weeks?: number;
  resumeDate?: string;
  indefinite?: boolean;
}

/** Applies a subscription pause — called by the pause confirmation prompt's
 *  Confirm button, never the model. Recomputes the hold fee server-side and
 *  logs the status change + hold-fee transaction. */
export async function POST(req: NextRequest) {
  let body: PauseBody;
  try {
    body = (await req.json()) as PauseBody;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { customerId } = body;
  const indefinite = body.indefinite === true;
  const weeks = indefinite ? null : Math.floor(Number(body.weeks));
  if (!customerId) return new Response("Missing customerId", { status: 400 });
  if (!indefinite && (!Number.isFinite(weeks!) || weeks! < 1 || weeks! > 12)) {
    return new Response("weeks must be 1-12 (or indefinite)", { status: 400 });
  }

  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return new Response("Unknown customer", { status: 404 });

  const plan = await getPlan(customer.plan);
  const holdFee = plan ? holdFeeCents(plan.weeklyCents, indefinite ? 4 : weeks!) : 0;
  const resumeDate = indefinite
    ? null
    : body.resumeDate?.match(/^\d{4}-\d{2}-\d{2}$/)
      ? body.resumeDate
      : resumeDateFor(weeks!, now());

  await db.update(customers).set({ subscriptionStatus: "paused" }).where(eq(customers.id, customerId));
  await db.insert(subscriptionEvents).values({
    customerId,
    eventType: "paused",
    metadata: { weeks, resumeDate, indefinite, holdFeeCents: holdFee },
  });
  await db.insert(transactions).values({
    customerId,
    type: "hold_fee",
    amountCents: holdFee,
    description: indefinite ? "Pause hold fee (monthly)" : `Pause hold fee (${weeks} weeks)`,
  });

  return Response.json({ ok: true, weeks, indefinite, resume_date: resumeDate, hold_fee_cents: holdFee });
}
