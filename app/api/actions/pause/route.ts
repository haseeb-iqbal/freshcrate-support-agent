import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents, transactions } from "@/db/schema";
import { getPlan, pauseReimbursementCents, weeksUntilDate } from "@/lib/billing/pricing";
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
 *  Confirm button, never the model. Recomputes the reimbursement server-side and
 *  logs the status change + the pause credit. A cancelled subscription can't be
 *  paused. */
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
  if (!indefinite && (!Number.isFinite(weeks!) || weeks! < 1 || weeks! > 52)) {
    return new Response("weeks must be 1-52 (or indefinite)", { status: 400 });
  }

  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return new Response("Unknown customer", { status: 404 });
  if (customer.subscriptionStatus === "cancelled") {
    return Response.json({ ok: false, error: "cancelled" }, { status: 409 });
  }

  const today = now();
  const plan = await getPlan(customer.plan);
  const weeksToBilling = weeksUntilDate(customer.billingDate, today);
  const reimbursement = plan ? pauseReimbursementCents(plan.weeklyCents, indefinite ? null : weeks, weeksToBilling) : 0;
  const resumeDate = indefinite
    ? null
    : body.resumeDate?.match(/^\d{4}-\d{2}-\d{2}$/)
      ? body.resumeDate
      : resumeDateFor(weeks!, today);

  await db.update(customers).set({ subscriptionStatus: "paused" }).where(eq(customers.id, customerId));
  await db.insert(subscriptionEvents).values({
    customerId,
    eventType: "paused",
    metadata: { weeks, resumeDate, indefinite, reimbursementCents: reimbursement },
  });
  // Credit the reimbursement (negative amount = money back to the customer).
  if (reimbursement > 0) {
    await db.insert(transactions).values({
      customerId,
      type: "pause_credit",
      amountCents: -reimbursement,
      description: indefinite ? "Pause credit (indefinite)" : `Pause credit (${weeks} week${weeks === 1 ? "" : "s"})`,
    });
  }

  return Response.json({ ok: true, weeks, indefinite, resume_date: resumeDate, reimbursement_cents: reimbursement });
}
