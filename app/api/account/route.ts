import type { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders, subscriptionEvents, transactions } from "@/db/schema";
import { orderView } from "@/lib/tools/order-view";
import { reconcile } from "@/lib/billing/reconcile";
import { now } from "@/lib/clock";
import { toIsoDate } from "@/lib/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Account view: profile, order history, money ledger, and status-change trail. */
export async function GET(req: NextRequest) {
  const customerId = req.nextUrl.searchParams.get("customerId");
  if (!customerId) return new Response("Missing customerId", { status: 400 });

  // Lazy reconcile so the panel reflects current billing / pause / status.
  await reconcile(customerId, now());

  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return new Response("Unknown customer", { status: 404 });

  const orderRows = await db.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.placedAt));
  const txns = await db.select().from(transactions).where(eq(transactions.customerId, customerId)).orderBy(desc(transactions.createdAt));
  const events = await db.select().from(subscriptionEvents).where(eq(subscriptionEvents.customerId, customerId)).orderBy(desc(subscriptionEvents.createdAt));

  return Response.json({
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      paymentMethod: customer.paymentMethod,
      plan: customer.plan,
      dietaryTrack: customer.dietaryTrack,
      subscriptionStatus: customer.subscriptionStatus,
      billingDate: customer.billingDate,
    },
    orders: orderRows.map(orderView),
    transactions: txns.map((t) => ({
      type: t.type,
      amount_cents: t.amountCents,
      description: t.description,
      order_number: t.orderNumber,
      date: toIsoDate(t.createdAt),
    })),
    statusHistory: events.map((e) => ({ event: e.eventType, date: toIsoDate(e.createdAt) })),
  });
}
