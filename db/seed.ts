import "dotenv/config";
import { db, client } from "./index";
import { customers, escalations, orders, plans, subscriptionEvents, transactions } from "./schema";
import { MEAL_LIST_PRICE_CENTS } from "../lib/billing/pricing";
import { addDaysIso } from "../lib/date";

/** N days before the moment of seeding (real time), for demo data that must stay
 *  recent relative to "now" — e.g. a refund inside the 14-day cooldown window. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** ISO date (YYYY-MM-DD) N days from the moment of seeding. Billing dates are
 *  seeded relative to "now" so the weeks-to-billing money demos (pause credit,
 *  resume charge, free-vs-fee reactivation) stay correct whenever you reseed. */
const daysFromNow = (n: number) => addDaysIso(n, new Date());

/** ISO date (YYYY-MM-DD) N days BEFORE seeding. The past-facing pair to
 *  `daysFromNow`, for orders that have already been delivered or cancelled. */
const daysAgoDate = (n: number) => addDaysIso(-n, new Date());

/**
 * Seed data for FreshCrate.
 *
 * Every row is chosen to cover a scenario from PRD Section 11. Stable UUIDs make
 * the demo customers and orders repeatable across reseeds. Order and billing
 * dates are all seeded RELATIVE to the moment of seeding, so an open order
 * always has a delivery date still ahead of it however long after the original
 * 2026-06-24 anchor you reseed. (Order dates used to be absolute, so a month
 * later every "shipped" box also claimed a delivery date in the past, and the
 * agent read that contradiction as proof the box had arrived.)
 * tests/integration/seed-coherence.test.ts enforces this.
 *
 * Scenario coverage map:
 *   US-1 Order status .............. Ava (single recent order)
 *   US-2 Pause subscription ........ Ava / Jamal (active customers)
 *   US-3 KB answer w/ citation ..... any (no data dependency)
 *   US-4 Refund (under ceiling) .... Priya (plain $17.50 meal < $20 ceiling)
 *   US-4 Refund ceiling escalation . Noah  (FC1020 with add-ons, $26.00 > $20 ceiling)
 *   US-4 Refund cooldown escalation  Tom   (refunded 5 days ago → 2nd within 14-day window)
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
  { plan: "2 meals/week", mealsPerWeek: 2, weeklyCents: 3000, monthlyCents: 12000 },
  { plan: "3 meals/week", mealsPerWeek: 3, weeklyCents: 4200, monthlyCents: 16800 },
  { plan: "4 meals/week", mealsPerWeek: 4, weeklyCents: 5200, monthlyCents: 20800 },
];

// Every meal lists at $17.50 (MEAL_LIST_PRICE_CENTS). Refund = list price +
// add-ons, so a plain meal ($17.50) sits under the $20 ceiling and is
// confirmable, while add-ons can push a refund over it. Add-ons and extra-meal
// status are assigned explicitly by order index so the refund demos land
// predictably — no procedural guessing.
const clean = (name: string) => name.replace(" (add-on)", "");
const EXTRA_ORDER_INDICES = new Set([4, 9]); // charged à-la-carte meals (realism)
const ORDER_ADDONS: Record<number, { name: string; priceCents: number }[]> = {
  4: [{ name: clean(ADDONS[1]), priceCents: 499 }], // Marcus extra meal
  9: [{ name: clean(ADDONS[2]), priceCents: 499 }], // Priya extra meal
  // Noah FC1020 — over-ceiling refund demo: $17.50 + $8.50 add-ons = $26.00 > $20.
  19: [
    { name: clean(ADDONS[0]), priceCents: 499 },
    { name: clean(ADDONS[1]), priceCents: 351 },
  ],
};

/** Pricing for order i: subscription meals are free (only add-ons cost); extra
 *  meals are charged their list price + add-ons. Refund = list price + add-ons. */
function orderPricing(i: number) {
  const addOns = ORDER_ADDONS[i] ?? [];
  const kind = EXTRA_ORDER_INDICES.has(i) ? "extra" : "subscription";
  const addSum = addOns.reduce((s, a) => s + a.priceCents, 0);
  const totalCents = kind === "extra" ? MEAL_LIST_PRICE_CENTS + addSum : addSum;
  return { kind, listPriceCents: MEAL_LIST_PRICE_CENTS, addOns, totalCents };
}

const customerRows: (typeof customers.$inferInsert)[] = [
  { id: C.ava, name: "Ava Chen", email: "ava.chen@example.com", subscriptionStatus: "active", plan: "2 meals/week", phone: "+1 (555) 010-2231", address: "412 Maple St, Portland, OR 97205", paymentMethod: "Visa ending 4242" },
  { id: C.marcus, name: "Marcus Bell", email: "marcus.bell@example.com", subscriptionStatus: "active", plan: "4 meals/week", phone: "+1 (555) 028-7741", address: "88 Birch Ave, Austin, TX 78704", paymentMethod: "Mastercard ending 5309" },
  { id: C.priya, name: "Priya Raman", email: "priya.raman@example.com", subscriptionStatus: "active", plan: "3 meals/week", phone: "+1 (555) 033-1190", address: "19 Cedar Ct, Seattle, WA 98103", paymentMethod: "Visa ending 1881" },
  { id: C.diego, name: "Diego Santos", email: "diego.santos@example.com", subscriptionStatus: "paused", plan: "2 meals/week", phone: "+1 (555) 041-6620", address: "275 Oak Blvd, Denver, CO 80206", paymentMethod: "Amex ending 3007" },
  { id: C.lena, name: "Lena Kowalski", email: "lena.kowalski@example.com", subscriptionStatus: "cancelled", plan: "2 meals/week", phone: "+1 (555) 052-9043", address: "9 Spruce Ln, Chicago, IL 60614", paymentMethod: "Visa ending 7720" },
  { id: C.tom, name: "Tom Becker", email: "tom.becker@example.com", subscriptionStatus: "active", plan: "2 meals/week", phone: "+1 (555) 060-3318", address: "601 Elm St, Columbus, OH 43215", paymentMethod: "Mastercard ending 6612" },
  { id: C.sara, name: "Sara Lindqvist", email: "sara.lindqvist@example.com", subscriptionStatus: "paused", plan: "3 meals/week", phone: "+1 (555) 074-8852", address: "33 Willow Way, Minneapolis, MN 55401", paymentMethod: "Visa ending 9134" },
  { id: C.noah, name: "Noah Patel", email: "noah.patel@example.com", subscriptionStatus: "active", plan: "4 meals/week", phone: "+1 (555) 080-2275", address: "147 Aspen Dr, Phoenix, AZ 85004", paymentMethod: "Amex ending 4419" },
  { id: C.mia, name: "Mia Rossi", email: "mia.rossi@example.com", subscriptionStatus: "cancelled", plan: "3 meals/week", phone: "+1 (555) 091-5567", address: "70 Poplar St, Boston, MA 02118", paymentMethod: "Visa ending 2050" },
  { id: C.jamal, name: "Jamal Wright", email: "jamal.wright@example.com", subscriptionStatus: "active", plan: "2 meals/week", phone: "+1 (555) 099-7401", address: "256 Walnut Ave, Atlanta, GA 30308", paymentMethod: "Mastercard ending 8826" },
];

// Next billing date per customer, as days-from-seed-time. Future for everyone
// except Mia, who is deliberately PAST her billing date to demo the paid
// reactivation (past billing → $40 sign-up fee); Lena is future/within-billing
// to demo the free reactivation. Paused customers (Diego, Sara) sit a couple
// weeks out so the resume charge is non-zero.
const BILLING_OFFSET_DAYS: Record<string, number> = {
  [C.ava]: 12,
  [C.marcus]: 9,
  [C.priya]: 18,
  [C.diego]: 14,
  [C.lena]: 6,
  [C.tom]: 12,
  [C.sara]: 16,
  [C.noah]: 10,
  [C.mia]: -20,
  [C.jamal]: 13,
};

const O = (n: number) => `22222222-2222-2222-2222-2222222200${n.toString().padStart(2, "0")}`;

// order_number is assigned sequentially on insert (FC1001…), so it's omitted here.
const orderRows: Omit<typeof orders.$inferInsert, "orderNumber">[] = [
  // Ava — US-1 order status: one recent in-flight order + history
  { id: O(1), customerId: C.ava, status: "shipped", totalCents: 3800, placedAt: daysAgo(2), deliveryDate: daysFromNow(2) },
  { id: O(2), customerId: C.ava, status: "delivered", totalCents: 650, placedAt: daysAgo(16), deliveryDate: daysAgoDate(12) }, // small add-on → under-ceiling refund demo
  { id: O(22), customerId: C.ava, status: "delivered", totalCents: 3800, placedAt: daysAgo(30), deliveryDate: daysAgoDate(26) },

  // Marcus — US-6 clarify: TWO open orders (processing + shipped) + history
  { id: O(3), customerId: C.marcus, status: "processing", totalCents: 6400, placedAt: daysAgo(1), deliveryDate: daysFromNow(3) },
  { id: O(4), customerId: C.marcus, status: "shipped", totalCents: 6400, placedAt: daysAgo(3), deliveryDate: daysFromNow(1) },
  { id: O(5), customerId: C.marcus, status: "delivered", totalCents: 6400, placedAt: daysAgo(17), deliveryDate: daysAgoDate(13) },
  { id: O(24), customerId: C.marcus, status: "delivered", totalCents: 6400, placedAt: daysAgo(31), deliveryDate: daysAgoDate(27) },

  // Priya — US-4 refund (under ceiling) + US-5 multi-tool (refund last box, pause next)
  { id: O(6), customerId: C.priya, status: "delivered", totalCents: 850, placedAt: daysAgo(6), deliveryDate: daysAgoDate(2) }, // small add-on, damaged → under-ceiling refund demo
  { id: O(23), customerId: C.priya, status: "shipped", totalCents: 4200, placedAt: daysAgo(1), deliveryDate: daysFromNow(3) },
  { id: O(7), customerId: C.priya, status: "delivered", totalCents: 4200, placedAt: daysAgo(20), deliveryDate: daysAgoDate(16) },

  // Diego — paused customer with history
  { id: O(8), customerId: C.diego, status: "delivered", totalCents: 3600, placedAt: daysAgo(35), deliveryDate: daysAgoDate(31) },
  { id: O(9), customerId: C.diego, status: "cancelled", totalCents: 3600, placedAt: daysAgo(23), deliveryDate: daysAgoDate(19) },

  // Lena — cancelled customer
  { id: O(10), customerId: C.lena, status: "cancelled", totalCents: 3400, placedAt: daysAgo(45), deliveryDate: daysAgoDate(41) },
  { id: O(11), customerId: C.lena, status: "delivered", totalCents: 3400, placedAt: daysAgo(59), deliveryDate: daysAgoDate(55) },

  // Tom — refund-cooldown demo: FC1015 is a fresh refundable box, but FC1016 was
  // already refunded 5 days ago, so a 2nd refund now hits the 14-day cooldown.
  { id: O(12), customerId: C.tom, status: "delivered", totalCents: 900, placedAt: daysAgo(9), deliveryDate: daysAgoDate(5) },
  { id: O(13), customerId: C.tom, status: "delivered", totalCents: 3800, placedAt: daysAgo(23), deliveryDate: daysAgoDate(19), refundedAt: daysAgo(5) },

  // Sara — paused, but a box still in transit
  { id: O(14), customerId: C.sara, status: "delivered", totalCents: 5200, placedAt: daysAgo(22), deliveryDate: daysAgoDate(18) },
  { id: O(15), customerId: C.sara, status: "shipped", totalCents: 5200, placedAt: daysAgo(3), deliveryDate: daysFromNow(1) },

  // Noah — US-4 refund ceiling escalation: high-value delivered order (> 5000c)
  { id: O(16), customerId: C.noah, status: "delivered", totalCents: 9800, placedAt: daysAgo(7), deliveryDate: daysAgoDate(3) },
  { id: O(17), customerId: C.noah, status: "shipped", totalCents: 9800, placedAt: daysAgo(1), deliveryDate: daysFromNow(3) },

  // Mia — cancelled customer history
  { id: O(18), customerId: C.mia, status: "cancelled", totalCents: 4800, placedAt: daysAgo(40), deliveryDate: daysAgoDate(36) },
  { id: O(19), customerId: C.mia, status: "delivered", totalCents: 4800, placedAt: daysAgo(54), deliveryDate: daysAgoDate(50) },

  // Jamal — active, one in-flight order (pause candidate)
  { id: O(20), customerId: C.jamal, status: "processing", totalCents: 3800, placedAt: daysAgo(1), deliveryDate: daysFromNow(3) },
  { id: O(21), customerId: C.jamal, status: "delivered", totalCents: 750, placedAt: daysAgo(15), deliveryDate: daysAgoDate(11) }, // small add-on → under-ceiling refund demo
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

  // Set each customer's next billing date relative to seed time (see
  // BILLING_OFFSET_DAYS) so the weeks-to-billing money demos stay correct. State
  // is current as of seed time, so the reconciler won't retroactively charge.
  const seededAt = new Date();
  for (const c of customerRows) {
    c.billingDate = daysFromNow(BILLING_OFFSET_DAYS[c.id!]);
    c.lastReconciledAt = seededAt;
  }
  // Diego is a FINITE pause (auto-resumes ~3 weeks out — skip-forward demo);
  // Sara stays indefinite (accrues the $8/week fee monthly while paused).
  customerRows.find((c) => c.id === C.diego)!.pauseResumeDate = daysFromNow(21);

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

  // Unified money ledger: monthly billing + pause credits. (Refunds, sign-up
  // fees, resume charges, and prorations from chat actions are written at runtime.)
  const monthly = (plan: string) => planRows.find((p) => p.plan === plan)!.monthlyCents;
  const weekly = (plan: string) => planRows.find((p) => p.plan === plan)!.weeklyCents;
  const txnRows: (typeof transactions.$inferInsert)[] = [];
  for (const c of customerRows) {
    if (c.subscriptionStatus !== "cancelled") {
      txnRows.push({ customerId: c.id!, type: "monthly_billing", amountCents: monthly(c.plan), description: `Monthly billing — ${c.plan}`, createdAt: ts("2026-06-15T09:00:00Z") });
    }
    if (c.subscriptionStatus === "paused") {
      // Pause credit at pause time: 2 weeks' plan value net of the $8/week fee.
      const credit = 2 * (weekly(c.plan) - 800);
      txnRows.push({ customerId: c.id!, type: "pause_credit", amountCents: -credit, description: "Pause credit (2 weeks)", createdAt: ts("2026-06-16T09:00:00Z") });
    }
  }
  // Tom's recent refund (drives the 14-day cooldown demo) — mirrors the
  // refundedAt set on FC1016 above.
  txnRows.push({ customerId: C.tom, type: "refund", amountCents: -MEAL_LIST_PRICE_CENTS, description: "Refund — order FC1016 (damaged box)", orderNumber: "FC1016", createdAt: daysAgo(5) });
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
