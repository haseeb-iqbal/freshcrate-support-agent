import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, escalations, orders, subscriptionEvents, transactions } from "@/db/schema";

export interface TestCustomerInput {
  /** Must be in the 88888888-8888-8888-8888-8888888800NN range. */
  id: string;
  plan?: string;
  subscriptionStatus?: "active" | "paused" | "cancelled";
  billingDate?: string;
  pauseResumeDate?: string | null;
  dietaryTrack?: string;
}

export interface TestOrderInput {
  customerId: string;
  orderNumber: string;
  listPriceCents?: number;
  totalCents?: number;
  addOns?: { name: string; priceCents: number }[];
  status?: string;
  kind?: string;
  refundedAt?: Date | null;
}

/** Delete a test customer and everything referencing it, children first. */
export async function purgeCustomer(id: string): Promise<void> {
  await db.delete(transactions).where(eq(transactions.customerId, id));
  await db.delete(subscriptionEvents).where(eq(subscriptionEvents.customerId, id));
  await db.delete(escalations).where(eq(escalations.customerId, id));
  await db.delete(orders).where(eq(orders.customerId, id));
  await db.delete(customers).where(eq(customers.id, id));
}

/**
 * Create a throwaway customer in a known state, purging any leftovers first so a
 * test that crashed mid-run cannot poison the next one. `lastReconciledAt` is
 * the epoch because reconcile keys off billingDate, not the watermark.
 */
export async function createTestCustomer(input: TestCustomerInput): Promise<void> {
  await purgeCustomer(input.id);
  const suffix = input.id.slice(-4);
  await db.insert(customers).values({
    id: input.id,
    name: `Test ${suffix}`,
    email: `test-${suffix}@example.test`,
    subscriptionStatus: input.subscriptionStatus ?? "active",
    plan: input.plan ?? "2 meals/week",
    dietaryTrack: input.dietaryTrack ?? "standard",
    paymentMethod: "Visa ending 0000",
    billingDate: input.billingDate ?? "2026-08-17",
    pauseResumeDate: input.pauseResumeDate ?? null,
    lastReconciledAt: new Date(0),
  });
}

export async function createTestOrder(input: TestOrderInput): Promise<void> {
  await db.insert(orders).values({
    orderNumber: input.orderNumber,
    customerId: input.customerId,
    status: input.status ?? "delivered",
    kind: input.kind ?? "subscription",
    totalCents: input.totalCents ?? 0,
    listPriceCents: input.listPriceCents ?? 1750,
    addOns: input.addOns ?? [],
    placedAt: new Date(2026, 5, 1),
    deliveryDate: "2026-06-05",
    refundedAt: input.refundedAt ?? null,
    items: ["Test Meal"],
  });
}

/** Ledger rows for a customer, oldest first, reduced to what assertions need. */
export async function txnsOf(customerId: string): Promise<{ type: string; amountCents: number }[]> {
  return db
    .select({ type: transactions.type, amountCents: transactions.amountCents })
    .from(transactions)
    .where(eq(transactions.customerId, customerId))
    .orderBy(asc(transactions.createdAt));
}

/** Status-change audit trail for a customer, oldest first. */
export async function eventsOf(customerId: string): Promise<string[]> {
  const rows = await db
    .select({ eventType: subscriptionEvents.eventType })
    .from(subscriptionEvents)
    .where(eq(subscriptionEvents.customerId, customerId))
    .orderBy(asc(subscriptionEvents.createdAt));
  return rows.map((r) => r.eventType);
}

export async function customerOf(customerId: string) {
  const [row] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!row) throw new Error(`No customer ${customerId}`);
  return row;
}
