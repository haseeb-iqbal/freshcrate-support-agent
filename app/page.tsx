import { asc } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import Chat, { type CustomerOption } from "./chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  const rows: CustomerOption[] = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      subscriptionStatus: customers.subscriptionStatus,
      plan: customers.plan,
    })
    .from(customers)
    .orderBy(asc(customers.name));

  return <Chat customers={rows} />;
}
