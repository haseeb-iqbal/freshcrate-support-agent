# Phase 4.5 — Agent Loop & Tool-Contract Hardening (Design)

**Status:** Approved design, ready for implementation plan
**Date:** 2026-07-02
**Author:** brainstormed with the maintainer
**Precedes:** Phase 5 (Evals). Evals are pointless while behavior is still shifting; harden first.

---

## 1. Problem

The chatbot behaves inconsistently. Three concrete, reproducible symptoms, each traced to a root cause in the current code:

1. **"My 2nd last order" dumps the whole order history.**
   Root cause: `lookup_order` (`lib/tools/orders.ts:33`) can only fetch *one order by number* or *the most recent*. Positional / attribute requests ("2nd last", "my last extra meal", "the delivered box") are inexpressible, so the model falls back to `list_orders` and shows the full card. The order details from `list_orders` are deliberately withheld from the model (`lib/agent/loop.ts:151`), so it cannot pick one afterward either.

2. **The reply text appears twice when a tool runs.**
   Root cause: the loop streams *every* iteration's text via `emit("delta", …)` (`lib/agent/loop.ts:69-71`). When a model turn emits a preamble ("Sure, let me look that up…") alongside its tool call, that preamble is streamed; then the next iteration streams the real answer. The UI accumulates both (`app/chat.tsx:407`, `content: m.content + delta`), so two blocks of text render.

3. **The loop "keeps iterating hoping it guesses correctly."**
   Root cause: two band-aids compensate for non-deterministic model behavior instead of constraining it — a regex **nudge** (`lib/agent/loop.ts:33,80`) that re-prompts when the model describes an action instead of calling the tool, and a **dedupe** `Set` (`lib/agent/loop.ts:61`) for duplicate confirmation cards. The **system prompt** (`lib/agent/system-prompt.ts`) is one ~20-rule wall of imperative "you MUST" text — brittle, and the source of the "terminology needs hardening" pain.

There is also **no automated test coverage** beyond `kb:test` + `typecheck`, so every behavioral change requires manual re-testing.

## 2. Goal

Make the agent's behavior **deterministic, hardened, and test-covered**:
- Fix all three symptoms with tests that prove the fix and guard against regression.
- Establish one **canonical source of truth** for domain terminology and feature rules, from which the prompt and tools are assembled.
- Split the loop into small, individually-testable units.
- Stand up the test harness the maintainer asked for: **Vitest** (unit + integration) and **Cypress** (E2E), plus a **deterministic mock LLM provider** that makes both the loop unit tests and the Cypress suite fast, free, and reproducible.

## 3. Scope

**In scope:** `lib/agent/*`, `lib/tools/orders.ts` (and pure-logic extraction from other tools as needed for tests), a new `lib/domain/*`, a new `lib/llm/mock.ts`, `app/chat.tsx` (only the streaming-reset handling), test scaffolding.

**Out of scope (later phases, separate specs):** the eval suite (Phase 5), model router / cost tracking / observability dashboard (Phase 6), Vercel + Supabase deploy and demo polish (Phase 7). No changes to `/api/actions/*`, the DB schema, or the billing/pricing rules themselves.

## 4. Locked decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Positional / attribute order queries | **Resolve to a single order and answer** (richer typed selectors), not clarify. |
| Rework depth | **Structured hardening** — keep the proven think→act→observe loop, SSE events, and confirmation-card flow; refactor into testable units. Not a from-scratch rewrite. |
| Double-text fix | **Stream live, then reset on a tool turn** — preserve token-by-token streaming; if a turn makes tool calls, emit a `reset` event that clears the accumulated preamble before tool chips + final answer render. |
| E2E model | **Deterministic mock provider** (`MOCK_LLM=1`); the same fake powers loop unit tests. Real OpenAI still used in dev/prod. |
| Test tooling | **Vitest** for unit + integration (Jest-compatible API, zero-config with the existing TS/ESM Next.js setup); **Cypress** for E2E. |

## 5. Architecture

### 5.1 Domain source of truth — `lib/domain/`

One place both the prompt and the tools import, so wording and rules cannot drift.

- `lib/domain/terms.ts` — typed constants and enums:
  - `ORDER_KINDS = ["subscription", "extra"] as const`, `ORDER_STATUSES = ["processing","shipped","delivered","cancelled"] as const`, `OPEN_STATUSES = ["processing","shipped"] as const`.
  - `PLAN_PRICES` (2/3/4 meals → weekly/monthly cents), `REFUND_CEILING_CENTS` (read from env, default 1000), sign-up fee, hold-fee rate.
  - `OrderSelector` type (see §5.2).
  - Short canonical rule strings, e.g. `RULES.subscriptionMealFree`, `RULES.refundAmount`, `RULES.refundCeiling`, `RULES.customerScoping` — the exact sentences the prompt reuses.
- `docs/DOMAIN.md` — the human-readable feature/terminology spec these constants mirror (order kinds, statuses, refund math, pause/reactivate/plan rules, scoping). Reviewed as prose; `terms.ts` is its machine mirror.

### 5.2 Tool contract — `lookup_order` typed selectors

`lib/tools/orders.ts` — extend `lookup_order`'s parameters:

```ts
// JSON-schema args exposed to the model
order_number?: string;                 // exact, e.g. "FC1002"
position?: number;                     // 1 = most recent, 2 = 2nd most recent, …  (default 1)
kind?: "subscription" | "extra";
status?: "processing" | "shipped" | "delivered" | "cancelled";
```

**Resolution (pure function `selectOrder(orders, selector): OrderRow | null`, unit-tested without DB):**
1. If `order_number` is given, return that order or `null`.
2. Else filter by `kind` and/or `status` when present.
3. Sort remaining by `placedAt` descending.
4. Return the order at 1-based `position` (default 1), or `null` if out of range / empty.

The tool handler queries the customer's orders (scoped), calls `selectOrder`, and returns either `{ ok: true, data: { order: view(o) } }` or `{ ok: false, summary: "No matching order found" }`. Because the maintainer chose *resolve, don't clarify*, `position` deterministically breaks "multiple match" cases. The description tells the model to use `position`/`kind`/`status` for relative or attribute requests and reserve `list_orders` for "show me all my orders."

### 5.3 Loop split into testable units — `lib/agent/`

| Unit | Responsibility | Testability |
|---|---|---|
| `lib/agent/messages.ts` → `buildAgentMessages(system, history)` | Pure assembly of the working transcript. | Pure — unit test. |
| `lib/agent/dispatch.ts` → `dispatchTool(call, result, state)` | Pure mapping: given a tool call + its `ToolResult` + loop state (shown-proposals set), return `{ events: {name,data}[], modelContent: string, updatedState }`. All "which SSE event / what to feed back / dedupe" logic lives here. | Pure — unit test, no I/O. |
| `lib/agent/loop.ts` → `runAgent(opts)` | Thin orchestrator: builds messages, streams each turn from the `ChatProvider`, applies the streaming-reset rule, calls `dispatchTool`, runs tool handlers, enforces the iteration ceiling. | Integration-tested with the mock provider capturing emitted events. |
| `lib/agent/prompt.ts` → `buildSystemPrompt()` | Assembles the system prompt from `lib/domain/terms.ts` rule strings into short labelled sections. | Unit test asserts invariants (contains canonical prices, ceiling, scoping rule, injection rule). |

The regex **nudge** is replaced by a deterministic, unit-tested post-turn policy inside `runAgent` (documented rule, asserted by test), and the **dedupe** becomes an explicit invariant owned by `dispatchTool` and asserted by test — no more incidental hacks.

### 5.4 Streaming / text contract (double-text fix)

Rule: **only the final assistant turn's text reaches the user.**

Implementation in `runAgent`:
- Stream `delta` events live as text arrives (responsiveness preserved).
- When a turn's stream completes: if it produced tool calls **and** any text was streamed this turn, emit a new SSE event **`reset`** (empty payload) *before* the tool-call events. This signals the UI to clear the current assistant message's accumulated `content`.
- The final turn (no tool calls) streams its text normally and is never reset.

UI change (`app/chat.tsx`, `handleEvent`): add a branch
```ts
} else if (event === "reset") {
  setMessages((prev) => updateLast(prev, (m) => ({ ...m, content: "" })));
}
```
`reset` clears only `content` — `steps`, `sources`, and proposals are untouched. This is the sole UI change.

### 5.5 Mock LLM provider — `lib/llm/mock.ts`

`MockChatProvider implements ChatProvider`. Selection lives in `lib/llm/index.ts` `getChatProvider()`: when `process.env.MOCK_LLM === "1"`, return the mock; otherwise the OpenAI provider.

- The mock inspects `opts.messages`: the latest `user` message text, and whether a `tool` result message is already present (i.e. first pass vs. post-tool pass).
- A **fixture map** (`lib/llm/mock-scripts.ts`) keys scripted responses on `(normalizedUserText, phase)`, where `phase` is `"pre_tool"` (no tool result yet) or `"post_tool"`. Each script yields either `{type:"text"}` deltas or a `{type:"tool_calls"}` event, matching the real provider's streaming shape.
- Example: user "where's my 2nd last order" → pre_tool script yields a `lookup_order` call with `{position:2}`; post_tool script yields the final sentence. This makes a full two-phase agent turn deterministic.
- Unknown inputs yield a safe generic answer so tests fail loudly (assertion mismatch) rather than hang.

## 6. Test strategy

### 6.1 Vitest — unit (DB-free, the default `npm test`)
- `selectOrder`: position (1/2/out-of-range), `kind` filter, `status` filter, combined filters, `order_number` exact, empty list. (Fixes symptom 1.)
- refund/pricing pure math (extracted from `refund.ts`/`pricing.ts` as needed): refund = list price + add-ons; ceiling boundary at exactly `REFUND_CEILING_CENTS`.
- `dispatchTool`: emits `sources` for `search_knowledge_base`; emits the right `*_proposal` event once and suppresses the duplicate (dedupe invariant); `list_orders` withholds details and emits `history`; unknown tool → error result.
- `buildSystemPrompt`: contains canonical plan prices, refund-ceiling sentence, customer-scoping rule, injection rule.
- `runAgent` streaming rule (with a scripted fake provider): a preamble+tool turn followed by a final-text turn emits exactly one `reset` and final `content` equals only the final answer (no duplicate). (Fixes symptom 2.)
- `runAgent` termination: hitting the iteration ceiling emits the truncation message + `done{truncated:true}`. (Guards symptom 3.)

### 6.2 Vitest — integration (`npm run test:integration`, gated on a seeded local DB)
- `lookup_order` handler against the seed: `{position:2}` for a known customer returns the expected order; `{kind:"extra"}` returns the extra meal; cross-customer id never leaks (scoping).
- `list_orders` handler returns the customer's orders + transactions, scoped.

Integration tests require `DATABASE_URL` + `npm run db:reset`; they are excluded from the default `npm test`.

### 6.3 Cypress — E2E (against `next dev` with `MOCK_LLM=1` + seeded DB)
Scripted, deterministic scenarios asserting observable UI behavior:
- **Positional order:** "where's my 2nd last order" → one order's status in text, **no** history card. (Symptom 1.)
- **Order history:** "show my order history" → history card renders **and** the reply text appears exactly once (no double text). (Symptom 2.)
- **Pause proposal:** "pause for 2 weeks" → pause card renders once, single lead-in text, no duplicate card.
- **Refund ceiling:** the over-ceiling customer requesting a refund → escalation message, no refund card.
- **Off-topic:** a general-knowledge question → polite refusal, no tool chips.
- **Clarify on ambiguity:** the multi-open-order customer saying "cancel my order" → a clarifying question.

## 7. Global constraints

- TypeScript **strict**; `npm run typecheck` clean.
- **OpenAI-only** preserved; no Anthropic. Mock provider is test-only, gated behind `MOCK_LLM`.
- **SSE event names stay stable**; the only additions are the `reset` event (UI updated in lockstep). Existing events (`delta`, `sources`, `history`, `*_proposal`, `tool_call`, `tool_result`, `done`) are unchanged.
- Customer-scoping invariant preserved: every tool acts only on the trusted server-side `customerId`.
- Date display remains **DD-MM-YYYY**; refund ceiling remains env-driven (default `REFUND_CEILING_CENTS=1000`).
- No new **runtime** dependencies; new dev deps limited to Vitest + Cypress (+ their required adapters).
- `/api/actions/*` endpoints, DB schema, and billing rules unchanged.
- Every implementation task ends green on `npm test` + `npm run typecheck` (+ `npm run kb:test` where relevant).

## 8. Acceptance criteria

1. All three symptoms fixed, each with a failing-then-passing test committed alongside the fix.
2. `lib/agent/loop.ts` decomposed into `messages.ts`, `dispatch.ts`, `prompt.ts`, and a thin `runAgent`, each unit-tested.
3. `lib/domain/terms.ts` + `docs/DOMAIN.md` exist and are the single source the prompt and tools import; the regex nudge is gone and dedupe is a tested invariant.
4. `MOCK_LLM=1` yields deterministic behavior; `npm test` (unit) and the Cypress suite pass with the mock.
5. `npm run typecheck` clean; existing `npm run kb:test` still passes; the live app (real OpenAI) still works end-to-end for a manual spot-check.

## 9. Out of scope / non-goals

- No eval suite, model router, cost tracking, dashboard, or deploy work (Phases 5–7).
- No schema migration, no change to pricing/pause/refund business rules — only their *representation* is centralized.
- No new agent tools beyond the `lookup_order` selector enrichment.
