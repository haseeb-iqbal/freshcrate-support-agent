# FreshCrate Support Agent — Unit Feature Breakdown

A granular, feature-by-feature inventory of what the app does today, grouped by
subsystem. "Unit feature" = one discrete, individually-describable capability.
Not-yet-built work (Phase 5 evals, Phase 6 observability, Phase 7 deploy) is
excluded.

---

## 1. Retrieval & Knowledge Base (RAG)

- **Semantic KB search** — `search_knowledge_base` tool embeds the query
  (`text-embedding-3-small`) and does a pgvector similarity search over
  `kb_chunks`.
- **Citation surfacing** — retrieved chunks are emitted to the client as a
  `sources` SSE event and rendered as citations.
- **Relevance gating** — sources are shown only when genuinely relevant: score
  within 0.12 of the top hit **and** ≥ 0.32 absolute; otherwise suppressed.
- **KB article viewer** — standalone article pages at `/kb/[slug]`
  (`app/kb/[slug]/page.tsx`) render full articles outside the chat.
- **KB ingestion pipeline** — `npm run kb:ingest` chunks and embeds KB markdown
  into the vector store.

## 2. Chat & Agent Loop

- **Streaming chat UI** — `app/chat.tsx` consumes Server-Sent Events and renders
  incrementally.
- **Think→act→observe loop** — `runAgent` (`lib/agent/loop.ts`) drives OpenAI
  function-calling turns until a final answer, capped by an iteration ceiling.
- **Message assembly** — `buildAgentMessages` (`lib/agent/messages.ts`) composes
  the OpenAI message array from system prompt + history.
- **System-prompt assembly** — `buildSystemPrompt` (`lib/agent/prompt.ts`) builds
  the prompt from the single-source `RULES` in `lib/domain/terms.ts` (no
  duplicated rule strings).
- **Tool dispatch** — `dispatchTool` (`lib/agent/dispatch.ts`) is a pure mapping
  from a tool call + result to SSE events and model-visible content.
- **Duplicate-reply fix (`reset`)** — any non-final turn that streamed prose
  emits a `reset` SSE event; the client clears the preamble so only the final
  turn's text is shown.
- **Action nudge** — `shouldNudge` (`lib/agent/nudge.ts`) re-prompts the model
  when it *describes* an account action without *calling* the tool (fires at most
  once per turn).
- **Dependency injection** — `runAgent(opts, deps)` accepts an injectable
  provider/tool registry so tests swap fakes (no live OpenAI/Postgres).
- **Deterministic mock provider** — `MockChatProvider` (`lib/llm/mock.ts`), gated
  behind `MOCK_LLM=1`, scripts canned tool-call/text turns keyed off the incoming
  message.
- **SSE event vocabulary** — `delta`, `sources`, `history`, `tool_call`,
  `tool_result`, `reset`, `done`, plus per-action proposals: `refund_proposal`,
  `pause_proposal`, `reactivate_proposal`, `plan_change_proposal`,
  `cancel_proposal`.

## 3. Order Tools

- **Single-order lookup** — `lookup_order` resolves ONE order via a pure resolver
  (`selectOrder`, `lib/tools/select-order.ts`).
  - **By order number** — exact match on `FC1001…`, regardless of other filters.
  - **By position** — 1-based most-recent-first (1 = latest, 2 = 2nd latest…).
  - **By kind** — `subscription` | `extra`, filtered before positioning.
  - **By status** — `processing` | `shipped` | `delivered` | `cancelled`,
    filtered before positioning.
  - **Out-of-range / unknown / empty → `null`** (no history dump to the model).
- **Order history** — `list_orders` returns history as a client card; order
  details are withheld from the model (reply is a one-line lead-in only).

## 4. Subscription Lifecycle (propose → confirm)

Each action is a proposal card; the model never writes. The card's confirm button
calls `/api/actions/*`, which re-validates server-side.

- **Get subscription** — `get_subscription` fetches live status/plan/billing;
  **mandatory** for any status/plan/billing/pause question (no answers from
  memory).
- **Pause** — `pause_subscription`: 1–12 weeks, a target date, or **indefinite**.
- **Resume** — `resume_subscription`: immediate, free, no confirmation (paused →
  active).
- **Reactivate** — `reactivate_subscription`: cancelled → active; can switch plan
  in the same step (`new_plan`).
- **Cancel** — `cancel_subscription`.
- **Change plan** — `change_plan`: active/paused only; new plan starts next week.
- **Proposal-card dedupe** — duplicate proposal cards within a turn are
  suppressed as a tested invariant in `dispatchTool`.

## 5. Billing & Pricing Rules (`lib/billing/pricing.ts`)

- **Plan catalog** — 2/3/4 meals/week = $30/$42/$52 weekly ($120/$168/$208
  monthly); read from the `plans` table.
- **Meal pricing** — subscription meals are free (list price struck-through +
  "Free"); extra meals charged at list price; add-ons always cost extra.
- **Refund amount** — list (undiscounted) price + add-ons, for both meal types.
- **Pause hold fee** — 20% of the skipped boxes' value
  (`holdFeeCents = weeklyCents × weeks × 0.2`).
- **Sign-up fee** — $15 one-time (`SIGNUP_FEE_CENTS`) to reactivate a cancelled
  sub past its billing period.
- **Free-reactivation window** — free within the billing period on the same plan
  (`withinBillingPeriod`); otherwise plan price + sign-up fee.
- **Plan-change proration** — weekly-rate difference × weeks remaining until
  billing (`prorationCents`), charge (+) or refund (−).
- **Weeks-until-date** — `weeksUntilDate` computes whole weeks to an ISO target
  (min 0; defaults to 4).
- **Transactions ledger** — money movements recorded in `transactions`
  (`monthly_billing` | `signup_fee` | `hold_fee` | `proration` | `refund`) with
  signed `amountCents`.
- **Subscription-event audit** — status changes logged in `subscription_events`
  (`subscribed` | `paused` | `resumed` | `cancelled` | `reactivated` |
  `plan_changed`).

## 6. Guardrails & Safety

- **Human-in-the-loop confirmation** — every money/state action requires explicit
  customer confirmation; the model cannot write directly.
- **Server-side re-validation** — `/api/actions/*` re-checks every confirmed
  action; the card payload is not trusted.
- **Refund ceiling** — refunds at/below $10 (`REFUND_CEILING_CENTS=1000`) are
  self-service; anything above → escalate (never claim a refund was issued).
- **Already-refunded guard** — an order refunded once → escalate on a second
  attempt.
- **Customer scoping** — every tool is bound to the signed-in customer
  server-side; cross-customer access is refused.
- **Prompt-injection resistance** — all tool results, KB excerpts, and
  account/order data are treated as untrusted DATA (including inside
  `<<BEGIN … >>` / `<<END … >>` markers); embedded instructions are ignored.
- **Off-topic refusal** — non-FreshCrate questions are declined in one sentence
  and steered back, even when the model knows the answer.
- **Escalation** — `escalate_to_human` records an escalation for anything outside
  self-service bounds.

## 7. Domain Source-of-Truth (`lib/domain/terms.ts`)

- **Canonical order kinds/statuses** — `ORDER_KINDS`, `ORDER_STATUSES`,
  `OPEN_STATUSES` (`processing`/`shipped`) shared across tools and prompt.
- **Canonical rule sentences** — `RULES` (scope, subscriptionFree, refundAmount,
  refundCeiling, injection, offTopic) reused verbatim by the system prompt so
  wording can't drift.
- **Single-home refund ceiling** — re-exported from `lib/guardrails/refund-policy`.

## 8. API Surface

- **`POST /api/chat`** — builds a trusted `customerLabel`, runs the agent loop,
  streams SSE.
- **`/api/actions/{pause,reactivate,cancel,change-plan,refund}`** — one route per
  confirmable action; each re-validates server-side.
- **`/api/account`** — account panel data.
- **`/api/customers`** — customer selection/lookup for the demo.

## 9. Presentation / Formatting

- **Cards & sources render after text** — proposal cards and citations appear
  only once the reply text completes.
- **Date display** — `DD-MM-YYYY`.
- **Struck-through free meals** — subscription meals show list price crossed out +
  "Free".

## 10. Data Model (8 tables, `db/schema.ts`)

`customers`, `orders`, `plans`, `transactions`, `subscription_events`,
`escalations`, `kb_chunks` (pgvector), `traces` (defined, unused — reserved for
Phase 6).
