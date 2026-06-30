import type { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Account view for the details + order-history panel: the customer's profile
 *  and their full order history, scoped to the requested customerId. */
export async function GET(req: NextRequest) {
  const customerId = req.nextUrl.searchParams.get("customerId");
  if (!customerId) return new Response("Missing customerId", { status: 400 });

  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!customer) return new Response("Unknown customer", { status: 404 });

  const orderRows = await db
    .select()
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.placedAt));

  return Response.json({
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      paymentMethod: customer.paymentMethod,
      plan: customer.plan,
      subscriptionStatus: customer.subscriptionStatus,
      billingDate: customer.billingDate,
    },
    orders: orderRows.map((o) => ({
      order_number: o.orderNumber,
      status: o.status,
      total_cents: o.totalCents,
      delivery_date: o.deliveryDate,
      refunded: o.refundedAt !== null,
      refunded_at: o.refundedAt ? o.refundedAt.toISOString().slice(0, 10) : null,
      items: o.items ?? [],
    })),
  });
}
