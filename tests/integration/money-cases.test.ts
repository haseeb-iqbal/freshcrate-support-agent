import { afterAll, beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { addDaysIso } from "@/lib/date";
import { issueRefund } from "@/lib/tools/refund";
import { getSubscription } from "@/lib/tools/subscription";
import { createTestCustomer, purgeCustomer } from "../helpers/db";

// Throwaway customers (88888888-…00NN range) so these don't touch the seeded ones.
const REFUND_ID = "88888888-8888-8888-8888-888888880041";
const RESUME_ID = "88888888-8888-8888-8888-888888880042";

async function addOrder(orderNumber: string, status: string, deliveryDate: string) {
  await db.insert(orders).values({
    orderNumber,
    customerId: REFUND_ID,
    status,
    kind: "subscription",
    totalCents: 0,
    listPriceCents: 1750,
    addOns: [],
    // Orders are placed a few days before they are delivered.
    placedAt: new Date(new Date(`${deliveryDate}T12:00:00`).getTime() - 4 * 86_400_000),
    deliveryDate,
    items: ["Test Meal"],
  });
}

describe("issue_refund on a box still in flight (integration)", () => {
  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required; run `npm run db:reset` first");
    await createTestCustomer({ id: REFUND_ID });
  });
  afterAll(() => purgeCustomer(REFUND_ID));

  const now = new Date();
  const refund = (orderNumber: string) => issueRefund.handler({ customerId: REFUND_ID, now }, { order_number: orderNumber, reason: "damaged" });

  it("proposes nothing for a shipped box that is not due yet", async () => {
    await addOrder("FC9941", "shipped", addDaysIso(2, now));
    const r = await refund("FC9941");
    expect((r.data as { status: string }).status).toBe("not_yet_due");
  });

  it("proposes nothing for a box due today or only a day late", async () => {
    await addOrder("FC9942", "shipped", addDaysIso(-1, now));
    expect(((await refund("FC9942")).data as { status: string }).status).toBe("not_yet_due");
  });

  it("proposes a refund once a shipped box is more than a day late", async () => {
    await addOrder("FC9943", "shipped", addDaysIso(-3, now));
    expect(((await refund("FC9943")).data as { status: string }).status).toBe("needs_confirmation");
  });

  it("won't refund an order that is not from the time the customer named", async () => {
    await addOrder("FC9945", "delivered", addDaysIso(-13, now));
    const r = await issueRefund.handler({ customerId: REFUND_ID, now, customerMessage: "my order from last week was damaged" }, { order_number: "FC9945", reason: "damaged" });
    expect((r.data as { status: string }).status).toBe("not_in_window");
  });

  it("refunds an order from the time the customer named, or one they name by number", async () => {
    await addOrder("FC9946", "delivered", addDaysIso(-3, now));
    await addOrder("FC9947", "delivered", addDaysIso(-13, now));
    const inWindow = await issueRefund.handler({ customerId: REFUND_ID, now, customerMessage: "my order from last week was damaged" }, { order_number: "FC9946", reason: "damaged" });
    expect((inWindow.data as { status: string }).status).toBe("needs_confirmation");
    const named = await issueRefund.handler({ customerId: REFUND_ID, now, customerMessage: "FC9947 from last week was damaged" }, { order_number: "FC9947", reason: "damaged" });
    expect((named.data as { status: string }).status).toBe("needs_confirmation");
  });

  it("proposes a refund for a delivered box", async () => {
    await addOrder("FC9944", "delivered", addDaysIso(-2, now));
    expect(((await refund("FC9944")).data as { status: string }).status).toBe("needs_confirmation");
  });
});

describe("get_subscription resume_quote (integration)", () => {
  beforeEach(() => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required; run `npm run db:reset` first");
  });
  afterAll(() => purgeCustomer(RESUME_ID));

  it("tells a paused customer what resuming charges and what the next bill becomes", async () => {
    // 2 weeks to billing on 3 meals/week: 2 x ($42 - $8) = $68 charge, which lands
    // on top of the -$68 credit already deferred, so the bill is back to $168.
    const now = new Date();
    await createTestCustomer({ id: RESUME_ID, plan: "3 meals/week", subscriptionStatus: "paused", billingDate: addDaysIso(16, now), billingAdjustmentCents: -6800 });
    const r = await getSubscription.handler({ customerId: RESUME_ID, now }, {});
    const d = r.data as { next_bill_cents: number; resume_quote: { charge_cents: number; next_bill_cents: number } };
    expect(d.next_bill_cents).toBe(10000);
    expect(d.resume_quote.charge_cents).toBe(6800);
    expect(d.resume_quote.next_bill_cents).toBe(16800);
  });

  it("has no resume quote for an active customer", async () => {
    await createTestCustomer({ id: RESUME_ID, plan: "3 meals/week" });
    const r = await getSubscription.handler({ customerId: RESUME_ID, now: new Date() }, {});
    expect((r.data as { resume_quote: unknown }).resume_quote).toBeNull();
  });
});
