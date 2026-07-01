import "dotenv/config";
import { db, client } from "./index";
import { customers, escalations, orders, plans, subscriptionEvents, transactions } from "./schema";

/**
 * Seed data for FreshCrate.
 *
 * Every row is chosen to cover a scenario from PRD Section 11. Stable UUIDs make
 * the demo customers and orders repeatable across reseeds. Dates are anchored
 * around the project "today" of 2026-06-24.
 *
 * Scenario coverage map:
 *   US-1 Order status .............. Ava (single recent order)
 *   US-2 Pause subscription ........ Ava / Jamal (active customers)
 *   US-3 KB answer w/ citation ..... any (no data dependency)
 *   US-4 Refund (under ceiling) .... Priya (delivered order, 4200c < 5000c ceiling)
 *   US-4 Refund ceiling escalation . Noah  (delivered order, 9800c > 5000c ceiling)
 *   US-5 Multi-tool turn ........... Priya (last box refund + pause next delivery)
 *   US-6 Clarify on ambiguity ...... Marcus (TWO open orders: processing + shipped)
 *   US-7 Escalation / off-topic .... any (no data dependency)
 *   Statuses covered ............... active, paused, cancelled (customers);
 *                                    processing, shipped, delivered, cancelled (orders)
 */

const C = {
  ava: "11111111-1111-1111-1111-111111110001",
  marcus: "11111111-1111-1111-1111-111111110002",
  priya: "11111111-1111-1111-1111-111111110003",
  diego: "11111111-1111-1111-1111-111111110004",
  lena: "11111111-1111-1111-1111-111111110005",
  tom: "11111111-1111-1111-1111-111111110006",
  sara: "11111111-1111-1111-1111-111111110007",
  noah: "11111111-1111-1111-1111-111111110008",
  mia: "11111111-1111-1111-1111-111111110009",
  jamal: "11111111-1111-1111-1111-111111110010",
} as const;

const ts = (iso: string) => new Date(iso);

const MEALS = [
  "Chicken Tikka Masala",
  "Veggie Stir-Fry",
  "Beef Tacos",
  "Salmon Teriyaki",
  "Mushroom Risotto",
  "Thai Green Curry",
  "Margherita Flatbread",
  "Lemon Herb Chicken",
  "Pesto Penne",
  "Korean Beef Bibimbap",
];
const ADDONS = [
  "Chocolate Lava Cake (add-on)",
  "Garlic Bread (add-on)",
  "Seasonal Fruit Box (add-on)",
  "Cookie Dough Trio (add-on)",
];

const planRows: (typeof plans.$inferInsert)[] = [
  { plan: "2 meals/week", weeklyCents: 3000, monthlyCents: 12000 },
  { plan: "3 meals/week", weeklyCents: 4200, monthlyCents: 16800 },
  { plan: "4 meals/week", weeklyCents: 5200, monthlyCents: 20800 },
];

// Orders whose refund (list price + add-ons) stays under the $10 ceiling, so the
// refund confirmation card still demonstrates. Keyed by index in orderRows.
const CHEAP_ORDER_INDICES = new Set([1, 7, 14, 23]);
const ADDON_PRICE_CENTS = 499;

/** Pricing for order i: subscription meals are free (only add-ons cost); extra
 *  meals are charged their list price + add-ons. Refund = list price + add-ons. */
function orderPricing(i: number) {
  const listPriceCents = CHEAP_ORDER_INDICES.has(i) ? 850 : [1199, 1299, 1399][i % 3];
  const kind = i % 5 === 4 && !CHEAP_ORDER_INDICES.has(i) ? "extra" : "subscription";
  const addOns =
    i % 4 === 0 && !CHEAP_ORDER_INDICES.has(i)
      ? [{ name: ADDONS[i % ADDONS.length].replace(" (add-on)", ""), priceCents: ADDON_PRICE_CENTS }]
      : [];
  const addSum = addOns.reduce((s, a) => s + a.priceCents, 0);
  const totalCents = kind === "extra" ? listPriceCents + addSum : addSum;
  return { kind, listPriceCents, addOns, totalCents };
}

const customerRows: (typeof customers.$inferInsert)[] = [
  { id: C.ava, name: "Ava Chen", email: "ava.chen@example.com", subscriptionStatus: "active", plan: "2 meals/week", phone: "+1 (555) 010-2231", address: "412 Maple St, Portland, OR 97205", paymentMethod: "Visa ending 4242", billingDate: "2026-07-15" },
  { id: C.marcus, name: "Marcus Bell", email: "marcus.bell@example.com", subscriptionStatus: "active", plan: "4 meals/week", phone: "+1 (555) 028-7741", address: "88 Birch Ave, Austin, TX 78704", paymentMethod: "Mastercard ending 5309", billingDate: "2026-07-12" },
  { id: C.priya, name: "Priya Raman", email: "priya.raman@example.com", subscriptionStatus: "active", plan: "3 meals/week", phone: "+1 (555) 033-1190", address: "19 Cedar Ct, Seattle, WA 98103", paymentMethod: "Visa ending 1881", billingDate: "2026-07-18" },
  { id: C.diego, name: "Diego Santos", email: "diego.santos@example.com", subscriptionStatus: "paused", plan: "2 meals/week", phone: "+1 (555) 041-6620", address: "275 Oak Blvd, Denver, CO 80206", paymentMethod: "Amex ending 3007", billingDate: "2026-07-20" },
  { id: C.lena, name: "Lena Kowalski", email: "lena.kowalski@example.com", subscriptionStatus: "cancelled", plan: "2 meals/week", phone: "+1 (555) 052-9043", address: "9 Spruce Ln, Chicago, IL 60614", paymentMethod: "Visa ending 7720", billingDate: "2026-07-10" },
  { id: C.tom, name: "Tom Becker", email: "tom.becker@example.com", subscriptionStatus: "active", plan: "2 meals/week", phone: "+1 (555) 060-3318", address: "601 Elm St, Columbus, OH 43215", paymentMethod: "Mastercard ending 6612", billingDate: "2026-07-15" },
  { id: C.sara, name: "Sara Lindqvist", email: "sara.lindqvist@example.com", subscriptionStatus: "paused", plan: "3 meals/week", phone: "+1 (555) 074-8852", address: "33 Willow Way, Minneapolis, MN 55401", paymentMethod: "Visa ending 9134", billingDate: "2026-07-22" },
  { id: C.noah, name: "Noah Patel", email: "noah.patel@example.com", subscriptionStatus: "active", plan: "4 meals/week", phone: "+1 (555) 080-2275", address: "147 Aspen Dr, Phoenix, AZ 85004", paymentMethod: "Amex ending 4419", billingDate: "2026-07-14" },
  { id: C.mia, name: "Mia Rossi", email: "mia.rossi@example.com", subscriptionStatus: "cancelled", plan: "3 meals/week", phone: "+1 (555) 091-5567", address: "70 Poplar St, Boston, MA 02118", paymentMethod: "Visa ending 2050", billingDate: "2026-06-20" },
  { id: C.jamal, name: "Jamal Wright", email: "jamal.wright@example.com", subscriptionStatus: "active", plan: "2 meals/week", phone: "+1 (555) 099-7401", address: "256 Walnut Ave, Atlanta, GA 30308", paymentMethod: "Mastercard ending 8826", billingDate: "2026-07-16" },
];

const O = (n: number) => `22222222-2222-2222-2222-2222222200${n.toString().padStart(2, "0")}`;

// order_number is assigned sequentially on insert (FC1001…), so it's omitted here.
const orderRows: Omit<typeof orders.$inferInsert, "orderNumber">[] = [
  // Ava — US-1 order status: one recent in-flight order + history
  { id: O(1), customerId: C.ava, status: "shipped", totalCents: 3800, placedAt: ts("2026-06-22T09:00:00Z"), deliveryDate: "2026-06-26" },
  { id: O(2), customerId: C.ava, status: "delivered", totalCents: 650, placedAt: ts("2026-06-08T09:00:00Z"), deliveryDate: "2026-06-12" }, // small add-on → under-ceiling refund demo
  { id: O(22), customerId: C.ava, status: "delivered", totalCents: 3800, placedAt: ts("2026-05-25T09:00:00Z"), deliveryDate: "2026-05-29" },

  // Marcus — US-6 clarify: TWO open orders (processing + shipped) + history
  { id: O(3), customerId: C.marcus, status: "processing", totalCents: 6400, placedAt: ts("2026-06-23T14:00:00Z"), deliveryDate: "2026-06-27" },
  { id: O(4), customerId: C.marcus, status: "shipped", totalCents: 6400, placedAt: ts("2026-06-21T14:00:00Z"), deliveryDate: "2026-06-25" },
  { id: O(5), customerId: C.marcus, status: "delivered", totalCents: 6400, placedAt: ts("2026-06-07T14:00:00Z"), deliveryDate: "2026-06-11" },
  { id: O(24), customerId: C.marcus, status: "delivered", totalCents: 6400, placedAt: ts("2026-05-24T14:00:00Z"), deliveryDate: "2026-05-28" },

  // Priya — US-4 refund (under ceiling) + US-5 multi-tool (refund last box, pause next)
  { id: O(6), customerId: C.priya, status: "delivered", totalCents: 850, placedAt: ts("2026-06-18T10:00:00Z"), deliveryDate: "2026-06-22" }, // small add-on, damaged → under-ceiling refund demo
  { id: O(23), customerId: C.priya, status: "shipped", totalCents: 4200, placedAt: ts("2026-06-23T10:00:00Z"), deliveryDate: "2026-06-27" },
  { id: O(7), customerId: C.priya, status: "delivered", totalCents: 4200, placedAt: ts("2026-06-04T10:00:00Z"), deliveryDate: "2026-06-08" },

  // Diego — paused customer with history
  { id: O(8), customerId: C.diego, status: "delivered", totalCents: 3600, placedAt: ts("2026-05-20T08:00:00Z"), deliveryDate: "2026-05-24" },
  { id: O(9), customerId: C.diego, status: "cancelled", totalCents: 3600, placedAt: ts("2026-06-01T08:00:00Z"), deliveryDate: "2026-06-05" },

  // Lena — cancelled customer
  { id: O(10), customerId: C.lena, status: "cancelled", totalCents: 3400, placedAt: ts("2026-05-10T08:00:00Z"), deliveryDate: "2026-05-14" },
  { id: O(11), customerId: C.lena, status: "delivered", totalCents: 3400, placedAt: ts("2026-04-26T08:00:00Z"), deliveryDate: "2026-04-30" },

  // Tom — straightforward delivered history
  { id: O(12), customerId: C.tom, status: "delivered", totalCents: 900, placedAt: ts("2026-06-15T11:00:00Z"), deliveryDate: "2026-06-19" }, // small add-on → under-ceiling refund demo
  { id: O(13), customerId: C.tom, status: "delivered", totalCents: 3800, placedAt: ts("2026-06-01T11:00:00Z"), deliveryDate: "2026-06-05" },

  // Sara — paused, but a box still in transit
  { id: O(14), customerId: C.sara, status: "delivered", totalCents: 5200, placedAt: ts("2026-06-02T12:00:00Z"), deliveryDate: "2026-06-06" },
  { id: O(15), customerId: C.sara, status: "shipped", totalCents: 5200, placedAt: ts("2026-06-20T12:00:00Z"), deliveryDate: "2026-06-24" },

  // Noah — US-4 refund ceiling escalation: high-value delivered order (> 5000c)
  { id: O(16), customerId: C.noah, status: "delivered", totalCents: 9800, placedAt: ts("2026-06-17T13:00:00Z"), deliveryDate: "2026-06-21" },
  { id: O(17), customerId: C.noah, status: "shipped", totalCents: 9800, placedAt: ts("2026-06-23T13:00:00Z"), deliveryDate: "2026-06-27" },

  // Mia — cancelled customer history
  { id: O(18), customerId: C.mia, status: "cancelled", totalCents: 4800, placedAt: ts("2026-05-15T15:00:00Z"), deliveryDate: "2026-05-19" },
  { id: O(19), customerId: C.mia, status: "delivered", totalCents: 4800, placedAt: ts("2026-05-01T15:00:00Z"), deliveryDate: "2026-05-05" },

  // Jamal — active, one in-flight order (pause candidate)
  { id: O(20), customerId: C.jamal, status: "processing", totalCents: 3800, placedAt: ts("2026-06-23T16:00:00Z"), deliveryDate: "2026-06-27" },
  { id: O(21), customerId: C.jamal, status: "delivered", totalCents: 750, placedAt: ts("2026-06-09T16:00:00Z"), deliveryDate: "2026-06-13" }, // small add-on → under-ceiling refund demo
];

const E = (n: number) => `33333333-3333-3333-3333-3333333300${n.toString().padStart(2, "0")}`;

const eventRows: (typeof subscriptionEvents.$inferInsert)[] = [
  { id: E(1), customerId: C.diego, eventType: "paused", createdAt: ts("2026-06-06T08:00:00Z"), metadata: { weeks: 3 } },
  { id: E(2), customerId: C.sara, eventType: "plan_changed", createdAt: ts("2026-05-12T12:00:00Z"), metadata: { from: "2 meals/week", to: "3 meals/week" } },
  { id: E(3), customerId: C.sara, eventType: "paused", createdAt: ts("2026-06-10T12:00:00Z"), metadata: { weeks: 2 } },
  { id: E(4), customerId: C.lena, eventType: "cancelled", createdAt: ts("2026-05-15T08:00:00Z"), metadata: { reason: "moving abroad" } },
  { id: E(5), customerId: C.mia, eventType: "cancelled", createdAt: ts("2026-05-20T15:00:00Z"), metadata: { reason: "too many meals" } },
  { id: E(6), customerId: C.diego, eventType: "resumed", createdAt: ts("2026-04-01T08:00:00Z"), metadata: {} },
  { id: E(7), customerId: C.ava, eventType: "plan_changed", createdAt: ts("2026-04-18T09:00:00Z"), metadata: { from: "3 meals/week", to: "2 meals/week" } },
];

async function main() {
  console.log("Seeding FreshCrate database…");

  // Idempotent reseed: clear dependents first (FK order), then parents.
  await db.delete(subscriptionEvents);
  await db.delete(transactions);
  await db.delete(escalations);
  await db.delete(orders);
  await db.delete(customers);
  await db.delete(plans);

  await db.insert(plans).values(planRows);
  await db.insert(customers).values(customerRows);

  // Each order is one meal (FC1001…): subscription meals are free (list price
  // shown struck through), extra meals are charged; both can carry paid add-ons.
  const pricedOrders = orderRows.map((o, i) => ({
    ...o,
    orderNumber: `FC${1001 + i}`,
    items: [MEALS[i % MEALS.length]],
    ...orderPricing(i),
  }));
  await db.insert(orders).values(pricedOrders);

  // Unified money ledger: monthly billing + pause hold fees. (Refunds, sign-up
  // fees, and prorations from chat actions are written at runtime.)
  const monthly = (plan: string) => planRows.find((p) => p.plan === plan)!.monthlyCents;
  const weekly = (plan: string) => planRows.find((p) => p.plan === plan)!.weeklyCents;
  const txnRows: (typeof transactions.$inferInsert)[] = [];
  for (const c of customerRows) {
    if (c.subscriptionStatus !== "cancelled") {
      txnRows.push({ customerId: c.id!, type: "monthly_billing", amountCents: monthly(c.plan), description: `Monthly billing — ${c.plan}`, createdAt: ts("2026-06-15T09:00:00Z") });
    }
    if (c.subscriptionStatus === "paused") {
      txnRows.push({ customerId: c.id!, type: "hold_fee", amountCents: Math.round(weekly(c.plan) * 2 * 0.2), description: "Pause hold fee", createdAt: ts("2026-06-16T09:00:00Z") });
    }
  }
  await db.insert(transactions).values(txnRows);

  // Status-change history: an initial "subscribed" event per customer plus the
  // specific changes each has made.
  const subscribedRows: (typeof subscriptionEvents.$inferInsert)[] = customerRows.map((c) => ({
    customerId: c.id!,
    eventType: "subscribed",
    createdAt: ts("2026-03-01T00:00:00Z"),
    metadata: { plan: c.plan },
  }));
  await db.insert(subscriptionEvents).values([...subscribedRows, ...eventRows]);

  console.log(`✓ ${customerRows.length} customers`);
  console.log(`✓ ${pricedOrders.length} orders`);
  console.log(`✓ ${txnRows.length} transactions`);
  console.log(`✓ ${subscribedRows.length + eventRows.length} subscription events`);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
