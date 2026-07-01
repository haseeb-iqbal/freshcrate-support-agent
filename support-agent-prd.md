# PRD: FreshCrate Customer Support Agent

**Type:** Technical PRD (code-generation handoff)
**Status:** Approved, ready to build
**Owner:** [you]
**Build model:** Phased. Build one phase, stop at its acceptance gate, get review, then continue.

> **⚠️ Status note (2026-07-01):** This is the original approved spec. It has since **diverged** — see [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) for the authoritative as-built state. Key deltas: **OpenAI-only** (chat + embeddings; no Anthropic); the tool set and data model grew (11 tools, 8 tables); a **simulated billing/pricing/ledger** layer (plans, meal pricing, add-ons, fees, transactions, subscription lifecycle) was added beyond the original scope; and the refund ceiling is $10. Phases 0–4 are complete and merged; Phases 5–7 (evals, observability, deploy) remain as planned below. Where this document and `PROJECT_STATE.md` disagree, `PROJECT_STATE.md` wins.

---

## 1. Summary

An agentic AI customer support assistant for a fictional meal-kit subscription company, FreshCrate. The agent answers help questions grounded in a knowledge base with citations, and performs real actions (order lookup, subscription pause, refund, escalation) against a Postgres database, behind safety and cost guardrails, with an evaluation suite and an observability dashboard.

This is a portfolio project. The fictional company is the demo surface; the engineering patterns (agentic RAG, guarded tool use, evals, observability) are the deliverable.

---

## 2. Problem & Goal

Companies need support agents that do more than chat: they retrieve accurate answers and take safe actions. The goal is a small, complete, production-shaped system that demonstrates those patterns end to end and runs as a live, clickable demo.

---

## 3. Users

- **Primary (in-product):** a FreshCrate customer asking support questions and requesting actions.
- **Secondary (evaluator):** a hiring reviewer who opens the live demo or repo to assess engineering skill.

---

## 4. Scope

**In scope**
- Streaming chat UI with a customer selector (simulated "logged-in" customer).
- Agentic RAG over a fixed knowledge base, with citations.
- Five agent tools (Section 9) against a seeded Postgres database.
- Safety guardrails, abuse/cost controls, eval suite, observability dashboard, model routing.
- Live deploy with seeded "try me" customers and example prompts.

> _Update: a **simulated** billing/pricing/ledger (plans, meal list-prices, add-ons, sign-up/hold/proration fees, a transactions table) and full subscription lifecycle (pause/resume/reactivate/cancel/change-plan) were added after the original scope. Still no **real** payments — all money is simulated DB writes._

**Out of scope**
- Real authentication/accounts (use a customer selector).
- Real billing/payments (all charges/refunds are simulated DB writes).
- Live email or chat-widget integration, admin panel/CMS, multi-tenancy, mobile apps.

---

## 5. Locked Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| UI | React + Tailwind CSS |
| Database | PostgreSQL + pgvector (Supabase free tier) |
| ORM | Drizzle ORM |
| Chat model | ~~Anthropic Claude~~ → **OpenAI**, behind a swappable provider interface (`gpt-4o-mini` default; `gpt-4o` reserved for the Phase 6 router). No Anthropic key needed. |
| Embeddings | OpenAI `text-embedding-3-small` (hosted) |
| Deploy | Vercel |

> _As-built: OpenAI powers both chat and embeddings (only `OPENAI_API_KEY`). The §15 prompt-caching item is Anthropic-specific and will be adapted or dropped._

---

## 6. Architecture Decisions (ADR summary)

**ADR-1 — RAG style: agentic (tool-based).** Knowledge-base search is a tool the agent chooses to call, not an always-on retrieval step.
*Trade-off:* one extra model round-trip and a small risk the agent skips a needed search, versus retrieving only when relevant, supporting multi-step retrieval, and demonstrating agent reasoning. Missed-search risk is covered by an eval case.
*Decision:* agentic.

**ADR-2 — ORM: Drizzle over TypeORM.** Drizzle has first-class pgvector support, is fully typed, and reads like SQL in review. TypeORM needs custom types/raw queries for pgvector and hides behavior behind decorators.
*Decision:* Drizzle.

**ADR-3 — Embeddings: hosted API over local model.** Anthropic offers no embedding model. A hosted embedding API is ~10 lines of code, deploys cleanly on Vercel, and costs a fraction of a cent at this scale. A local model is fiddly inside Vercel serverless.
*Decision:* OpenAI `text-embedding-3-small`.

**ADR-4 — Single repo, Next.js full-stack.** Fastest credible path to a deployable demo; UI, API, and agent live in one TypeScript codebase.
*Decision:* Next.js App Router.

---

## 7. System Architecture

```
Browser (React chat UI, streaming, tool-call status)
        |
        v
Next.js API route  (/api/chat)
        |
        v
Agent loop (Claude, think -> act -> observe)
   |          |            |             |
   v          v            v             v
search_kb   DB tools    guardrails    cost + trace
(pgvector) (orders,     (confirm,      logging
            subs,        scope,
            refund,      limits)
            escalate)
        |
        v
PostgreSQL + pgvector (relational tables + KB vectors)
```

The agent receives the user message, current customer_id, and tool definitions. It decides whether to search the KB, call a DB tool, request confirmation, or answer. It loops until it returns a final response.

---

## 8. Data Model

**customers**
| column | type | notes |
|---|---|---|
| id | uuid (pk) | |
| name | text | |
| email | text | |
| subscription_status | text | active \| paused \| cancelled |
| plan | text | e.g. "2 meals/week" |

**orders**
| column | type | notes |
|---|---|---|
| id | uuid (pk) | |
| customer_id | uuid (fk) | |
| status | text | processing \| shipped \| delivered \| cancelled |
| total_cents | integer | refund logic |
| placed_at | timestamptz | |
| delivery_date | date | |

**subscription_events**
| column | type | notes |
|---|---|---|
| id | uuid (pk) | |
| customer_id | uuid (fk) | |
| event_type | text | paused \| resumed \| cancelled \| plan_changed \| refund |
| created_at | timestamptz | |
| metadata | jsonb | e.g. pause weeks, refund amount |

**kb_chunks**
| column | type | notes |
|---|---|---|
| id | uuid (pk) | |
| article_slug | text | citation source id |
| heading | text | citation section |
| content | text | chunk text |
| embedding | vector(1536) | pgvector |

**traces** (observability)
| column | type | notes |
|---|---|---|
| id | uuid (pk) | |
| conversation_id | uuid | |
| turn_index | integer | |
| user_message | text | |
| model_used | text | |
| tools_called | jsonb | names + args |
| retrieval_hits | jsonb | chunk ids |
| input_tokens | integer | |
| output_tokens | integer | |
| est_cost_usd | numeric | |
| latency_ms | integer | |
| created_at | timestamptz | |

**Seed data:** 8–12 customers across all statuses, 20–30 orders, several subscription events. Must cover every scenario in Section 11, including at least one customer with multiple open orders (for the clarify case).

> _As-built (8 tables): `orders` expanded with `kind` (subscription|extra), `list_price_cents`, `add_ons`, `refunded_at`, `items`; `customers` gained contact/`payment_method`/`billing_date`; and two tables were added — **`plans`** (pricing) and **`transactions`** (money ledger). `subscription_events` also records `subscribed`/`reactivated`. See `docs/PROJECT_STATE.md` §6._

---

## 9. Agent Tools

All tools are typed and scoped to the current `customer_id`. No general SQL tool.

> _As-built there are **11** tools (the 5 below plus `list_orders`, `get_subscription`, `resume_subscription`, `reactivate_subscription`, `cancel_subscription`, `change_plan`). All account actions follow a propose→confirm-card flow (the model never writes; the card's confirm button calls a re-validating `/api/actions/*` endpoint). See `docs/PROJECT_STATE.md` §5._

| Tool | Signature | Access | Notes |
|---|---|---|---|
| search_knowledge_base | `(query: string)` | read | Semantic search over kb_chunks; returns chunks + article_slug + heading for citations |
| lookup_order | `(customer_id, order_id?)` | read | Most recent order if order_id omitted |
| pause_subscription | `(customer_id, weeks: number)` | write | Sets status=paused, logs event; reversible |
| issue_refund | `(customer_id, order_id, reason)` | write | **Guardrailed** (Section 12). Simulated: logs refund event |
| escalate_to_human | `(customer_id, summary)` | write | Logs a handoff record |

---

## 10. Knowledge Base

10–15 short markdown help articles covering: delivery schedule and changing delivery day, pause/resume, cancellation policy, refund and damaged-box policy, plan changes, dietary options, account/billing basics, referral program, and a few FAQs. Chunk by heading. Every KB-sourced answer must cite article + section. When the answer is not in the KB, the agent must say so and offer to escalate (no fabrication).

---

## 11. Functional Requirements (User Stories)

**US-1 Order status**
As a customer, I want to ask where my order is, so that I know its delivery state.
- Agent calls lookup_order scoped to the current customer.
- Response states status and delivery date.
- Never returns another customer's order.

**US-2 Pause subscription**
As a customer, I want to pause my subscription, so that I skip upcoming boxes.
- Agent calls pause_subscription with the requested weeks.
- subscription_status becomes paused; a subscription_event is logged.
- Agent confirms the pause and duration in plain language.

**US-3 Knowledge answer with citation**
As a customer, I want policy answers, so that I understand the rules.
- Agent calls search_knowledge_base and answers only from retrieved content.
- Answer includes a citation (article + heading).
- If not found, agent says it does not know and offers escalation.

**US-4 Refund (guarded)**
As a customer, I want a refund for a damaged box, so that I am compensated.
- Agent proposes the refund and shows a confirmation UI; it does NOT write until the user approves.
- On approval, issue_refund logs a refund event.
- Refunds above the ceiling route to escalate_to_human instead (Section 12).

**US-5 Multi-tool turn**
As a customer, I want to say "refund my last box and pause my next delivery," so that both happen.
- Agent sequences lookup_order -> propose refund -> (on approval) issue_refund -> pause_subscription.

**US-6 Clarify on ambiguity**
As a customer with multiple open orders, when I say "cancel my order," I want to be asked which one.
- Agent detects >1 open order and asks a clarifying question instead of guessing.

**US-7 Escalation / off-topic**
As a customer, I want out-of-scope or human requests handled gracefully.
- Off-topic or sensitive requests get a polite decline plus an escalate option, not a hallucinated answer.
- "Talk to a human" triggers escalate_to_human.

---

## 12. Guardrails & Safety (Requirements)

- **Refund confirmation (human-in-the-loop):** issue_refund never fires without explicit user approval via a confirmation UI.
- **Refund ceiling:** refunds above a configured amount route to escalation, not auto-approval. _As-built: `REFUND_CEILING_CENTS=1000` ($10); the refund amount = the meal's list price + add-ons; a second refund on the same order also routes to a human._
- **Least privilege:** each tool touches only its data; lookup_order and search_knowledge_base are read-only; no general SQL tool.
- **Customer scoping:** every tool is bound to the active customer_id; cross-customer access is refused even if asked.
- **Prompt-injection resistance:** KB and DB content are treated as data, not instructions; an eval case verifies injected instructions are ignored.

---

## 13. Abuse & Cost Controls (Requirements)

- **Per-session rate limiting** (requests per minute and per hour).
- **Input length cap:** reject oversized messages before the model call.
- **Output cap:** hard `max_tokens` per response.
- **Agent-loop ceiling:** max tool-call iterations per turn (prevents runaway loops).
- **History trimming:** bounded conversation context per turn.
- **Account spend cap:** hard ceiling set in the provider console; auto-reload off.

---

## 14. Evaluation Suite (Requirements)

One-command runner producing a per-case pass/fail report plus an aggregate score (console + JSON). 15–25 cases covering:

- **Retrieval:** KB question -> expected source article retrieved.
- **Grounding:** answer cites a real source and stays faithful.
- **Tool selection:** correct tool chosen (or correctly none), including "did it search when it should."
- **Honesty:** out-of-KB question -> "I don't know" + escalation offer.
- **Guardrails:** refund triggers confirmation not an immediate write; cross-customer request refused; injected instruction ignored.

Open-ended answers graded by a second Claude call acting as a rubric-based judge (LLM-as-judge). The suite must catch a deliberately introduced regression.

---

## 15. Observability & Cost (Requirements)

- **Dashboard page** showing, per conversation: each turn's message, tools called, retrieval hits, model used, latency, tokens, estimated cost; a think/act/observe trace; aggregate latency/cost/tool-frequency.
- **Model routing:** simple queries -> Haiku, complex multi-step reasoning -> Sonnet.
- **Prompt caching** on the static system prompt and tool definitions.
- **Per-turn cost tracking** persisted to the traces table.

---

## 16. Repository Structure

```
/freshcrate-support-agent
  /app
    /api/chat          # streaming agent endpoint
    /dashboard         # observability page
    page.tsx           # chat UI + customer selector + tool-call status
  /lib
    /agent             # agent loop, tool dispatch
    /tools             # the five tools, typed
    /rag               # chunking, embedding, retrieval, rerank
    /guardrails        # confirmation, scoping, limits
    /llm               # provider interface, model router, cost tracking
  /db
    schema.ts          # Drizzle schema
    seed.ts            # seed data
  /kb                  # markdown help articles
    ingest.ts          # chunk + embed + load into pgvector
  /evals
    cases.ts
    run.ts
  README.md
  .env.example
```

---

## 17. Build Phases & Acceptance Gates

Stop at each gate for review before proceeding.

> _Status: Phases **0–4 complete and merged**, plus a large account/billing feature layer beyond this plan. **Phase 5 (Evals) is the recommended next step.** Phases 5–7 below are unchanged (note: §6 "prompt caching" is Anthropic-specific and will be adapted/dropped; the model router targets `gpt-4o-mini` ↔ `gpt-4o`)._

| Phase | Deliverable | Acceptance gate |
|---|---|---|
| 0 — Scaffold & data | Repo, env config, Drizzle schema, seed script | Schema sound; seed covers every scenario incl. multi-order customer; runs locally |
| 1 — RAG retrieval | KB articles, ingest pipeline, retrieval + rerank, test script | Right chunks returned for sample questions; citations resolve |
| 2 — Grounded chat | Chat UI, streaming endpoint, KB answers with citations, honest "I don't know" | Streaming works; answers grounded and cited; honest failure works |
| 3 — Agentic tools | Five tools + agent loop; customer scoping | Each tool fires on correct prompts; scoping holds; loop terminates |
| 4 — Guardrails | Refund confirmation UI, refund ceiling, injection handling | No refund without approval; cross-customer + injection refused |
| 5 — Evals | Eval cases + runner + LLM-as-judge | One-command run; clear report; catches a seeded regression |
| 6 — Cost & observability | Model router, prompt caching, cost tracking, dashboard | Dashboard shows real traces/costs; routing works |
| 7 — Polish & deploy | README, tool-call status UI, live deploy, seeded demo customers, 60s walkthrough | Stranger can use the live URL in seconds; repo clean |

---

## 18. Success Metrics

- **System:** eval suite passes its target threshold; no guardrail case fails; p50 turn latency acceptable for a chat UI.
- **Portfolio:** a reviewer can try the live demo without setup; README maps each demonstrated skill (agentic RAG, guarded tool use, evals, observability, cost control) to where it lives in the code; includes a candid "limitations / where it fails" section and an OWASP-LLM-aware security note.

---

## 19. Environment & Setup

Required accounts (all free tier or trivial cost): Supabase (Postgres + pgvector) — or local Docker pgvector for dev — and an OpenAI API key (chat **and** embeddings). _No Anthropic key is needed._

`.env.example` keys: `DATABASE_URL`, `OPENAI_API_KEY`, plus tunables: `REFUND_CEILING_CENTS` ($10), `MAX_LOOP_ITERATIONS`, `MAX_OUTPUT_TOKENS`, `RATE_LIMIT_PER_MIN`, and model overrides `CHAT_MODEL_FAST` / `CHAT_MODEL_SMART` / `EMBEDDING_MODEL`.

---

## 20. Open Questions

None blocking. Tunable defaults (refund ceiling, rate limits, loop ceiling) to be confirmed during Phase 4 / Phase 6.
