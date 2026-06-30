import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents } from "@/db/schema";
import { getPlan } from "@/lib/billing/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChangePlanBody {
  customerId?: string;
  plan?: string;
}

/** Applies a plan change — called by the plan-change confirmation prompt's
 *  Confirm button, never the model. Validates the plan exists. */
export async function POST(req: NextRequest) {
  let body: ChangePlanBody;
  try {
    body = (await req.json()) as ChangePlanBody;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { customerId, plan: newPlan } = body;
  if (!customerId || !newPlan) return new Response("Missing customerId or plan", { status: 400 });

  const plan = await getPlan(newPlan);
  if (!plan) return Response.json({ ok: false, error: "unknown_plan" }, { status: 400 });

  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return new Response("Unknown customer", { status: 404 });

  await db.update(customers).set({ plan: newPlan }).where(eq(customers.id, customerId));
  await db.insert(subscriptionEvents).values({
    customerId,
    eventType: "plan_changed",
    metadata: { from: customer.plan, to: newPlan, monthlyCents: plan.monthlyCents },
  });

  return Response.json({ ok: true, plan: newPlan, monthly_cents: plan.monthlyCents });
}
