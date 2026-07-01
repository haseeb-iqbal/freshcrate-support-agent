# FreshCrate Support Agent — Project State & Handoff

> Read this first when continuing work in a new session. It captures where the project actually is (which has diverged from `support-agent-prd.md`), the business rules, agent conventions, and what's left. The original PRD is still the north star for the remaining phases (5–7).

_Last updated: 2026-07-01._

## 1. What this is
Agentic AI customer-support assistant for a fictional meal-kit company (FreshCrate). It answers help questions grounded in a knowledge base (with citations) and performs guard-railed account actions against Postgres. Portfolio project — the engineering patterns are the deliverable.

## 2. Status
| Phase (PRD §17) | State |
|---|---|
| 0 Scaffold & data | ✅ merged |
| 1 RAG retrieval | ✅ merged |
| 2 Grounded chat | ✅ merged |
| 3 Agentic tools | ✅ merged |
| 4 Guardrails | ✅ merged |
| **Account/billing features + fixes** (beyond PRD) | ✅ merged (#5) + **PR #6 open** (orders/ledger/pricing + bug fixes) |
| 5 Evals | ⬜ **not started — recommended next** |
| 6 Cost & observability (dashboard, model router, cost tracking) | ⬜ not started (`traces` table exists, unused) |
| 7 Polish & deploy (Vercel + Supabase, tool-call UI, demo walkthrough, guided scenarios) | ⬜ not started |

**Branch/PR:** merged PRs #1–#5 are in `main`. Current work is on branch `orders-ledger-and-fixes` = **PR #6 (open, draft)**. Merge it before starting new work; then branch fresh from `main`.

## 3. Key deviations from the PRD (important)
- **OpenAI-only.** Chat AND embeddings are OpenAI (no Anthropic). Only `OPENAI_API_KEY` is needed. Chat = `gpt-4o-mini` (`CHAT_MODEL_FAST`); `CHAT_MODEL_SMART=gpt-4o` is defined but the model router (Phase 6) isn't built. Prompt caching (PRD §15) is Anthropic-specific → revisit/drop.
- **Refund ceiling is $10** (`REFUND_CEILING_CENTS=1000`), not $50.
- **Big feature layer beyond the PRD**: subscription lifecycle (pause/resume/reactivate/cancel/change-plan), plan pricing, add-ons, a transactions ledger, an account panel. All are propose→confirm card flows.

## 4. Tech stack (as built)
Next.js 14 (App Router) + React 18 + Tailwind v3 · TypeScript · PostgreSQL + pgvector (local Docker: `docker compose up -d`, image `pgvector/pgvector:pg16`) · Drizzle ORM (`postgres.js` driver) · OpenAI (`gpt-4o-mini` chat, `text-embedding-3-small` embeddings). Everything is `DATABASE_URL`-driven (swaps to Supabase for deploy). `gh` CLI is installed for PRs.

## 5. Architecture / request flow
Browser (`app/chat.tsx`, SSE) → `POST /api/chat` (`app/api/chat/route.ts`, builds trusted `customerLabel`) → **agent loop** (`lib/agent/loop.ts`, think→act→observe over OpenAI function calling) → tools (`lib/tools/*`) → Postgres. The loop streams `delta` text and emits SSE events: `sources`, `history`, `refund_proposal`, `pause_proposal`, `reactivate_proposal`, `plan_change_proposal`, `cancel_proposal`, `tool_call`, `tool_result`, `done`. Confirmation actions never write from the model — the card's confirm button calls `/api/actions/*`, which re-validates server-side.

### The 11 tools (`lib/tools/`)
`search_knowledge_base`, `lookup_order` (one order), `list_orders` (history → card; details withheld from the model), `get_subscription` (live status — must be called for status/plan/billing/pause questions), `pause_subscription`, `resume_subscription`, `reactivate_subscription`, `cancel_subscription`, `change_plan`, `issue_refund`, `escalate_to_human`.

## 6. Data model (8 tables, `db/schema.ts`)
- **customers** — status (active|paused|cancelled), plan, `billingDate`, contact + `paymentMethod` (simulated).
- **orders** — one meal each: `orderNumber` (FC1001…), `kind` (subscription|extra), `totalCents` (charged; 0 for a free subscription meal), `listPriceCents` (undiscounted), `addOns` `[{name, priceCents}]`, `items` `[mealName]`, `refundedAt`.
- **plans** — plan → weekly/monthly cents.
- **transactions** — money ledger: `type` (monthly_billing|signup_fee|hold_fee|proration|refund), signed `amountCents` (+charge/−credit), description, `orderNumber?`.
- **subscription_events** — status-change audit (subscribed|paused|resumed|cancelled|reactivated|plan_changed).
- **escalations**, **kb_chunks** (pgvector), **traces** (defined, unused).

## 7. Business rules (single source: `lib/billing/pricing.ts` + seed)
- **Plans:** 2/3/4 meals/week = $30/$42/$52 weekly ($120/$168/$208 monthly).
- **Meals:** subscription meals are **free** (list price shown struck-through + "Free"); extra meals charged at list price; add-ons always cost extra.
- **Refund** = list price + add-ons (both meal types). Guardrails: human-in-the-loop confirmation; ceiling $10 → escalate; already-refunded → escalate; scoped to the customer.
- **Pause:** 1–12 weeks, a target date, or **indefinite**. Hold fee = 20% of skipped boxes' value (indefinite = billed monthly).
- **Reactivation (cancelled):** free within the billing period on the same plan; otherwise plan price + **$15 sign-up fee**. Can switch plan while reactivating (`new_plan`).
- **Resume (paused):** immediate, free, no confirmation.
- **Change plan:** active/paused only (cancelled → reactivate with new_plan); prorated by weeks-to-billing; new plan starts next week.

## 8. Agent conventions (enforced in `lib/agent/system-prompt.ts` + loop)
- Every confirmation action → the model MUST call the tool (a **nudge** re-prompts if it only describes; duplicate cards are **deduped**).
- Status/plan/billing/pause questions → MUST call `get_subscription` (not from memory) — prevents stale answers.
- Order history → `list_orders`; reply is a one-line lead-in only (the model doesn't receive the order details).
- Sources shown only if genuinely relevant (score within 0.12 of top, ≥0.32).
- Cards/sources render **after** the text completes.
- Dates display **DD-MM-YYYY**. Off-topic questions are refused. KB/tool content treated as untrusted data (injection resistance).

## 9. Run & verify
```bash
npm install
cp .env.example .env         # set OPENAI_API_KEY; DATABASE_URL defaults to local Docker
npm run db:up                # start pgvector
npm run db:reset             # enable vector + push schema + seed
npm run kb:ingest            # embed KB articles (needs OPENAI_API_KEY)
npm run kb:test              # retrieval gate (12 cases)
npm run typecheck
npm run dev                  # http://localhost:3000
```
`npm run db:seed` resets demo data (shared DB — mutations persist). **Demo customers:** Ava (active), Marcus (2 open orders → clarify), Priya/Ava small orders (confirmable refunds), Noah ($98 → ceiling escalation), Lena (cancelled, within billing → free reactivation), Mia (cancelled, past billing → fee), Diego/Sara (paused). Order numbers `FC1001…`.

## 10. What's left / known limitations
- **Phase 5 Evals (do next):** one-command runner, 15–25 cases (retrieval, grounding, tool-selection, honesty, guardrails), LLM-as-judge, catch a seeded regression. This is the highest-value next step — a lot of behavior now needs regression protection.
- **Phase 6:** model router (mini↔4o), per-turn cost/latency written to `traces`, observability dashboard.
- **Phase 7:** Vercel + Supabase deploy, "Reset demo data" endpoint/button + periodic reseed, live tool-call/think-act-observe UI, guided sample-scenarios walkthrough (see memory), README limitations + OWASP-LLM note.
- **Known:** shared single DB (not multi-tenant — by design); README is UTF-16-encoded and its tech-stack line still says "Anthropic Claude"; no automated test suite beyond `kb:test` + `typecheck`; the tool-call-not-emitted behavior is mitigated (nudge+dedup) but inherent to LLM function-calling.

## 11. Memory & PR workflow
Persistent memory lives in the Claude memory dir (`MEMORY.md` index + notes on OpenAI-only, gh CLI, requested extra features). PRs: push branch, open a **draft** PR with `gh`, user reviews + merges manually. Schema changes require `npm run db:reset` (+ `kb:ingest` if KB changed).
