import {
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
  date,
} from "drizzle-orm/pg-core";

// --- customers ---------------------------------------------------------------
// subscription_status: active | paused | cancelled
export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  subscriptionStatus: text("subscription_status").notNull(),
  plan: text("plan").notNull(), // e.g. "2 meals/week"
  phone: text("phone"),
  address: text("address"),
  paymentMethod: text("payment_method"), // simulated, e.g. "Visa ending 4242"
  billingDate: date("billing_date"), // next monthly billing date
});

// --- orders ------------------------------------------------------------------
// status: processing | shipped | delivered | cancelled
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNumber: text("order_number").notNull().unique(), // short human-facing id, e.g. FC1001
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  status: text("status").notNull(),
  kind: text("kind").notNull().default("subscription"), // subscription | extra
  totalCents: integer("total_cents").notNull(), // amount actually charged
  listPriceCents: integer("list_price_cents").notNull().default(0), // undiscounted meal price
  addOns: jsonb("add_ons").$type<{ name: string; priceCents: number }[]>(), // paid extras
  placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  deliveryDate: date("delivery_date"),
  refundedAt: timestamp("refunded_at", { withTimezone: true }), // set when a refund is approved
  items: jsonb("items").$type<string[]>(), // meal name(s) in the box
});

// --- transactions (unified money ledger: charges, fees, refunds) --------------
// type: monthly_billing | signup_fee | hold_fee | proration | meal_charge | refund
export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  type: text("type").notNull(),
  amountCents: integer("amount_cents").notNull(), // +charge / -refund or credit
  description: text("description").notNull(),
  orderNumber: text("order_number"), // linked order, if any
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- subscription_events -----------------------------------------------------
// event_type: paused | resumed | cancelled | reactivated | plan_changed | refund
export const subscriptionEvents = pgTable("subscription_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  eventType: text("event_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata"), // e.g. { weeks: 2 } or { refundCents: 4200, orderId, reason }
});

// --- kb_chunks (RAG over the knowledge base) ---------------------------------
export const kbChunks = pgTable("kb_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  articleSlug: text("article_slug").notNull(), // citation source id
  heading: text("heading").notNull(), // citation section
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }), // OpenAI text-embedding-3-small
});

// --- traces (observability) --------------------------------------------------
export const traces = pgTable("traces", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull(),
  turnIndex: integer("turn_index").notNull(),
  userMessage: text("user_message"),
  modelUsed: text("model_used"),
  toolsCalled: jsonb("tools_called"), // names + args
  retrievalHits: jsonb("retrieval_hits"), // chunk ids
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estCostUsd: numeric("est_cost_usd"),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- plans (subscription pricing reference) ---
export const plans = pgTable("plans", {
  plan: text("plan").primaryKey(), // e.g. "2 meals/week"
  mealsPerWeek: integer("meals_per_week").notNull().default(0), // meals/week, for the savings calc
  weeklyCents: integer("weekly_cents").notNull(),
  monthlyCents: integer("monthly_cents").notNull(),
});

// --- escalations (human-handoff records, written by escalate_to_human) ---
export const escalations = pgTable("escalations", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Customer = typeof customers.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;
export type KbChunk = typeof kbChunks.$inferSelect;
export type Trace = typeof traces.$inferSelect;
export type Escalation = typeof escalations.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
