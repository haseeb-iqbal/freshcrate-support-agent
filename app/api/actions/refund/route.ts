import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, transactions } from "@/db/schema";
import { evaluateRefund } from "@/lib/guardrails/refund-policy";
import { latestRefundAt, refundAmountCents } from "@/lib/tools/orders";
import { reconcile } from "@/lib/billing/reconcile";
import { now } from "@/lib/clock";
import { toIsoDate } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RefundBody {
  customerId?: string;
  orderNumber?: string;
  reason?: string;
}

/** The ONLY path that writes a refund. Called by the confirmation prompt's
 *  Approve button, never the model. Re-validates ownership, the no-repeat rule,
 *  and the ceiling; refunds the meal's list price + add-ons and logs a ledger
 *  transaction. */
export async function POST(req: NextRequest) {
  let body: RefundBody;
  try {
    body = (await req.json()) as RefundBody;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { customerId, orderNumber } = body;
  const reason = (body.reason ?? "").trim() || "Approved by customer";
  if (!customerId || !orderNumber) {
    return new Response("Missing customerId or orderNumber", { status: 400 });
  }

  await reconcile(customerId, now());
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderNumber, orderNumber), eq(orders.customerId, customerId)))
    .limit(1);
  if (!order) return new Response("Order not found for this customer", { status: 404 });
  if (order.refundedAt) return Response.json({ ok: false, error: "already_refunded" }, { status: 409 });

  const refundCents = refundAmountCents(order);
  const decision = evaluateRefund({
    totalCents: refundCents,
    now: now(),
    lastRefundAt: await latestRefundAt(customerId),
  });
  if (decision.kind === "over_ceiling") {
    return Response.json({ ok: false, error: "over_ceiling", ceiling_cents: decision.ceilingCents }, { status: 403 });
  }
  if (decision.kind === "cooldown") {
    return Response.json({ ok: false, error: "refund_cooldown", next_eligible: toIsoDate(decision.nextEligible) }, { status: 403 });
  }

  await db.update(orders).set({ refundedAt: now() }).where(and(eq(orders.orderNumber, orderNumber), eq(orders.customerId, customerId)));
  await db.insert(transactions).values({
    customerId,
    type: "refund",
    amountCents: -refundCents,
    description: `Refund — order ${orderNumber} (${reason})`,
    orderNumber,
  });

  return Response.json({ ok: true, order_number: orderNumber, amount_cents: refundCents });
}
