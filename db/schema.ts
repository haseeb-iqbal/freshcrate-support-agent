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
  totalCents: integer("total_cents").notNull(),
  placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  deliveryDate: date("delivery_date"),
  refundedAt: timestamp("refunded_at", { withTimezone: true }), // set when a refund is approved
});

// --- subscription_events -----------------------------------------------------
// event_type: paused | resumed | cancelled | plan_changed | refund
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
