# Dev Log — FreshCrate Support Agent

A running journal of how this project was built: what I tried, what worked, the problems I hit, and what's next. For the *current* as-built state see [`PROJECT_STATE.md`](PROJECT_STATE.md); for the original spec see [`../support-agent-prd.md`](../support-agent-prd.md). This file is the narrative and reasoning behind those.

_Last updated: 2026-07-09._

---

## Why this project

I wanted a portfolio piece that shows more than "chat with an LLM": an agent that **retrieves grounded answers with citations** and **takes real, guard-railed actions** against a database. The fictional meal-kit company (FreshCrate) is just a surface to make the engineering patterns concrete — agentic RAG, guarded tool use, evals, observability, cost control.

---

## Decisions & turning points

### Pivot: Anthropic → OpenAI-only
The PRD specified Claude for chat + OpenAI for embeddings. I didn't have an Anthropic key, so I moved chat to OpenAI too and put everything behind a swappable provider interface (`lib/llm`). **What worked:** one key (`OPENAI_API_KEY`), one bill, and the provider abstraction meant the agent loop never hard-codes a vendor. **Trade-off:** the PRD's Anthropic-specific prompt-caching idea (§15) no longer applies — I'll adapt or drop it in Phase 6.

### Agentic RAG (retrieval as a tool, not an always-on step)
Knowledge-base search is a tool the model *chooses* to call. **Why:** it supports multi-step retrieval and shows real agent reasoning, and I cover the "did it search when it should have?" risk with an eval case (Phase 5). **What worked:** answers cite `article › heading`, and sources only render when genuinely relevant (score within 0.12 of the top hit, ≥0.32) so the UI isn't noisy.

### Propose → confirm for every write
The model never writes to the database. Account actions (refund, pause, cancel, plan change, reactivate) return a *proposal*; the UI shows a confirmation card; the card's button calls a re-validating `/api/actions/*` endpoint that performs the write. **Why:** human-in-the-loop safety, and it keeps the model's job to *decide*, not to *execute*. **What worked:** this pattern generalized cleanly as the feature set grew.

### Scope grew well beyond the PRD
What started as "5 tools, 5 tables" became **11 tools and 8 tables** — a full subscription lifecycle (pause/resume/reactivate/cancel/change-plan), plan pricing, add-ons, a transactions ledger, and an account panel. **Why:** a believable support demo needs believable account depth. All money is simulated DB writes — no real payments.

---

## Problems I hit (and what they taught me)

By the end of Phase 4 the app *worked*, but the agent behaved inconsistently. Three concrete, reproducible symptoms:

1. **"Show me my 2nd last order" dumped the whole order history.** Root cause: `lookup_order` could only fetch a specific order *by number* or *the most recent* — positional/attribute requests were inexpressible, so the model fell back to listing everything. **Lesson:** when the model "does the wrong thing," check whether the *tools* even let it do the right thing.

2. **The reply text sometimes rendered twice when a tool ran.** Root cause: the loop streamed *every* iteration's text, so a preamble ("let me look that up…") plus the final answer both landed in the message. **Lesson:** streaming a multi-step agent needs an explicit rule for which turn's text is "the answer."

3. **The loop felt like it was guessing.** It leaned on band-aids — a regex "nudge" to re-prompt when the model described an action instead of calling the tool, and a de-dupe set for duplicate confirmation cards — layered over a brittle ~20-rule wall-of-text system prompt. **Lesson:** band-aids compensate for non-determinism instead of constraining it, and without tests every change was a manual re-test.

The deeper problem underneath all three: **no automated test coverage** beyond a retrieval check and `tsc`. Every behavioral tweak meant clicking through the UI again.

---

## What I'm doing now: Phase 4.5 — hardening

Rather than jump to the eval suite (Phase 5), I'm hardening the agent first — evals are pointless while behavior is still shifting. The approach (spec: [`superpowers/specs/2026-07-02-agent-loop-hardening-design.md`](superpowers/specs/2026-07-02-agent-loop-hardening-design.md)):

- **One source of truth for terminology & rules** (`lib/domain/terms.ts` + `DOMAIN.md`) that both the prompt and the tools import, so wording can't drift. It re-exports the existing pricing/ceiling sources rather than duplicating them.
- **Richer `lookup_order`** — `position` / `kind` / `status` selectors resolved by a pure, unit-tested `selectOrder`. Fixes symptom 1.
- **The loop, split into testable units** — `messages`, `prompt`, `dispatch`, `nudge`, and a thin `runAgent(opts, deps)` that takes injectable dependencies for testing.
- **A `reset` streaming event** — only the *final* turn's text reaches the user; any earlier turn that streamed a preamble emits `reset` to clear it. Fixes symptom 2.
- **A deterministic mock LLM** (`MOCK_LLM=1`) — scripted tool-calls/answers keyed to known prompts. The same fake powers both the loop unit tests and the Cypress E2E suite, so tests are fast, free, and reproducible. This is the piece I'm most happy with: **testing an agentic app deterministically without paying per run or fighting model flakiness.**
- **A real test harness** — Vitest (unit + integration) and Cypress (E2E), with each change written test-first.

### What's working about the process
I'm executing the hardening as a written plan, task-by-task, each with its own tests and an independent review before moving on. It's slower up front but the review gates have already caught real gaps (e.g. the prompt rebuild silently dropped a couple of guardrail lines — caught and restored before it shipped).

---

## What's next

- **Phase 5 — Evals:** a one-command runner, 15–25 cases (retrieval, grounding, tool-selection, honesty, guardrails), an LLM-as-judge for open-ended answers, and a deliberately-seeded regression the suite must catch.
- **Phase 6 — Cost & observability:** a model router (mini ↔ 4o), per-turn cost/latency written to the `traces` table (defined but currently unused), and a dashboard.
- **Phase 7 — Polish & deploy:** live on Vercel + Supabase, a "reset demo data" control, a tool-call/think-act-observe trace in the UI, and a short walkthrough.

## Open questions / things I'm watching
- **LLM function-calling is inherently non-deterministic** — the model occasionally describes an action instead of calling the tool. The nudge mitigates it, but the eval suite is what will actually *bound* it.
- **Prompt caching** (PRD §15) was Anthropic-specific — decide in Phase 6 whether OpenAI's equivalent is worth it at this scale.
- **Single shared demo database** — fine for a demo, but the "reset demo data" control (Phase 7) matters once it's public and mutable.
