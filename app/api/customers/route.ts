import { asc } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Customer list backing the "logged-in customer" selector (simulated auth). */
export async function GET() {
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      subscriptionStatus: customers.subscriptionStatus,
      plan: customers.plan,
    })
    .from(customers)
    .orderBy(asc(customers.name));

  return Response.json(rows);
}
