import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, subscriptionEvents } from "@/db/schema";
import { evaluateRefund } from "@/lib/guardrails/refund-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RefundBody {
  customerId?: string;
  orderNumber?: string;
  reason?: string;
}

/**
 * The ONLY path that actually writes a refund. Called by the confirmation card's
 * Approve button — never by the model. Re-validates ownership, the ceiling, and
 * the no-repeat-refund rule server-side: the client request is never trusted.
 */
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

  // Re-verify the order belongs to this customer (scoping).
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderNumber, orderNumber), eq(orders.customerId, customerId)))
    .limit(1);
  if (!order) {
    return new Response("Order not found for this customer", { status: 404 });
  }

  // Re-check the no-repeat-refund rule.
  if (order.refundedAt) {
    return Response.json({ ok: false, error: "already_refunded" }, { status: 409 });
  }

  // Re-check the ceiling — over-limit refunds are never written here.
  const decision = evaluateRefund({ totalCents: order.totalCents });
  if (decision.kind === "over_ceiling") {
    return Response.json(
      { ok: false, error: "over_ceiling", ceiling_cents: decision.ceilingCents },
      { status: 403 },
    );
  }

  // Mark the order itself refunded (so lookups reflect it) and log the event.
  await db
    .update(orders)
    .set({ refundedAt: new Date() })
    .where(and(eq(orders.orderNumber, orderNumber), eq(orders.customerId, customerId)));

  await db.insert(subscriptionEvents).values({
    customerId,
    eventType: "refund",
    metadata: { orderNumber, reason, amountCents: order.totalCents, approvedByUser: true },
  });

  return Response.json({ ok: true, order_number: orderNumber, amount_cents: order.totalCents });
}
