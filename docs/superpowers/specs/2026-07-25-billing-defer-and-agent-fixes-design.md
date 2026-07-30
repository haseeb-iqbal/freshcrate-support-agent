# Deferred pause/resume billing + agent fixes - design

_2026-07-25. Three features (deferred billing, the Cratelyn rename, a single-order card) and three bug fixes (date order lookup, subscription-cost refusal, nudge robustness), on branch `billing-defer-and-agent-fixes`._

## Scope

Six items. F1 (billing) is a self-contained subsystem change to `lib/billing/*` and the pause/resume routes; the rest are prompt, tool, and UI tweaks. F3 and B1 both touch order lookup, so they share a section. One spec, F1 implemented and reviewed first.

Out of scope: any change to refund, cancel, reactivate, or plan-change money math; retrieval; the reconcile row-lock/idempotency machinery.

---

## F1 - Defer the pause credit and resume charge to the next bill

### Today

- **Pause** (`/api/actions/pause`) posts a `pause_credit` transaction immediately for `min(pauseWeeks, weeksToBilling) x (weekly - $8)`.
- **Resume** (`/api/actions/resume`) posts a `resume_charge` transaction immediately for `weeksToBilling x (weekly - $8)`.
- The `$8/week` pause fee for time spent paused across a billing date is applied by `reconcile`.

### Target

The credit and the charge move off immediate transactions and onto the next monthly bill, at the **full weekly rate** (no `-$8`). The `$8/week` ongoing fee is unchanged.

**Mechanism:** a new `billing_adjustment_cents` integer column on `customers` (default 0) - a running one-time adjustment applied to the next monthly bill.

- **Pause** (active -> paused): `billing_adjustment_cents -= weeksToBilling(now) x weekly` - the whole rest of the current cycle, NOT capped by the pause length. No `pause_credit` transaction.
- **Resume** (paused -> active, manual route or `reconcile` auto-resume): `billing_adjustment_cents += weeksToBilling(now or resumeDate) x weekly`. No `resume_charge` transaction.
- **Reconcile**, active sub crossing its billing date: the `monthly_billing` transaction amount becomes `max(0, monthly + billing_adjustment_cents)`, and the column resets to 0 in the same update (only on the FIRST active billing crossing; subsequent crossings in the same catch-up see 0). Its description notes the adjustment when non-zero (e.g. `Monthly billing (incl. -$60 pause adjustment)`). The `max(0, ...)` clamp prevents a negative bill in the corner where the credit exceeds one month; a residual is not carried (acceptable for the demo).
- The pause-fee and finite/indefinite reconcile paths are otherwise unchanged.

**Pause credits the full cycle, not the pause length** - this is what keeps the round-trip exact. Both pause and resume key off `weeksToBilling`, so an immediate resume of a pause of *any* length cancels it to zero. If the credit were capped at the pause length, a short finite pause resumed immediately would leave a non-zero residual. The card must therefore show the customer the **net** they can expect, not the raw column change: `quotePause` returns a display field `net_credit_cents = min(pauseWeeks, weeksToBilling) x weekly` for a finite pause (what they net once it auto-resumes as scheduled) and `weeksToBilling x weekly` for an indefinite one. The stored adjustment is always the full-cycle figure; the card copy uses `net_credit_cents`.

### Why this is correct

`weeksUntilDate` returns whole weeks, so pause and a same-day resume read the identical `weeksToBilling` and the adjustment returns to exactly 0 - a pause-then-resume nets to zero, as if never paused.

A **finite pause self-corrects**: pause credits the entire rest of the period (`-weeksToBilling x weekly`); the auto-resume at the resume date charges back the weeks then remaining (`+weeksToBilling(resumeDate) x weekly`); the net is precisely the weeks actually skipped, at the weekly rate. Worked example on the 2-meal ($30/wk, $120/mo) plan, billing 4 weeks out, pause for 2 weeks:

- Pause: adjustment = `-4 x $30 = -$120`.
- Auto-resume 2 weeks later (2 weeks left to billing): adjustment = `-$120 + 2 x $30 = -$60`.
- Next monthly bill: `$120 + (-$60) = $60` - i.e. the customer paid for the 2 weeks they received and skipped the 2 they paused. Correct.

Matches the resume example from the request: resume with 2 weeks to billing on the $30 plan -> next bill `$120 + 2 x $30 = $180`.

**Cross-billing pauses** (indefinite, or finite spanning a billing date): the credit sits on the column until the customer's next *active* monthly billing; the `$8/week` fee covers the paused span meanwhile (unchanged). The adjustment applied on the first bill back is bounded by `+-4 weeks x weekly`. This is a deliberately simple carry - the within-period case is what the demo exercises.

### Files

- `db/schema.ts`: add `billingAdjustmentCents`.
- `lib/billing/pricing.ts`: the credit/charge become full-weekly. `pauseReimbursementCents` and `resumeChargeCents` either drop the `- PAUSE_FEE_CENTS` term or are replaced by a single `weeksToBilling x weekly` helper; their tests move to the new amounts.
- `lib/billing/quotes.ts`: `quotePause` returns the deferred credit (full weekly, all weeks to billing); `quoteResume` returns the deferred charge (full weekly). New/renamed fields make it explicit these adjust the next bill rather than move money now.
- `lib/billing/reconcile.ts`: thread `billingAdjustment` through `ReconInput`/`ReconResult`; apply-and-clear it on active monthly billing; add it (not a `resume_charge`) on auto-resume.
- `app/api/actions/pause/route.ts`, `resume/route.ts`: set the adjustment column instead of inserting `pause_credit`/`resume_charge`.
- `app/chat.tsx`: `PauseCard` and `ResumeCard` copy changes from "credited now" to "next bill" framing; the proposal payloads carry the next-bill figures.
- `lib/tools/subscription.ts`: the pause/resume tool `message` strings match the new framing.

### Tests

- `pricing.test.ts`, `quotes.test.ts`: new full-weekly amounts.
- `reconcile.test.ts`: adjustment applied and cleared on billing; auto-resume adds to it; ongoing `$8/week` fee unaffected.
- A new `lib/billing/round-trip.test.ts` (pure): pause-then-resume = 0; finite-pause net = paused weeks x weekly; a plan switch during resume charges at the new weekly.
- `tests/integration`: a pause -> resume -> skip-forward-to-billing flow asserts the single adjusted `monthly_billing` and no stray `pause_credit`/`resume_charge` rows.
- `tests/api/pause.test.ts`, `resume.test.ts`: routes write the column, not the transactions.

---

## F3 + B1 - Single-order card and date lookup

### F3 - the card

`lookup_order` already returns `orderView(focus)`. Add a single-order card so the model stops writing the fields out as prose.

- **New SSE event `order`** carrying the `OrderView`. `dispatch.ts` emits it on a successful `lookup_order` (mirroring how `list_orders` emits `history`), and feeds the model a note: the order is shown in a card, so give a short natural lead-in and do NOT restate the number, status, price, items, or dates - though it may still answer a specific question in prose.
- **`app/chat.tsx`**: a `Message.order?: OrderView` field, an `order` event handler, and an `OrderCard` that reuses the existing `OrderRow` component (already used by the history card and account panel) inside a titled wrapper with `data-testid="order-card"`. Rendered under the same `showResults` gate as the other cards.

### B1 - date lookup

- `OrderSelector` gains `date?: string` (ISO `YYYY-MM-DD`). `selectOrder` matches an order whose `deliveryDate` or the calendar day of `placedAt` equals `date`; ties resolve most-recent-first, as position does. Precedence stays: `orderNumber` > `date` > `position`/`kind`/`status`.
- `lookup_order`'s tool definition gains a `date` parameter (ISO), described as "the delivery or order date the customer named".
- **Today's date reaches the model.** `buildSystemPrompt` takes the turn's `now` and adds a `# Today` line (`Today is 25th July 2026 (25-07-2026).`). `runAgent` already computes `turnNow`; it passes it in. This lets the model resolve "25th July", "last Tuesday", "yesterday" to an ISO `date` instead of hallucinating an `order_number` (the reproduced failure).

### Tests

- `select-order.test.ts`: date matches on delivery date and on placed-at day; no match returns null; precedence with position.
- `prompt.test.ts`: the `# Today` line is present and formatted long-form.
- E2E: "show me my order from <seeded delivery date>" renders `order-card` for the right order and no history dump; "my last order" still renders the single card.

---

## F2 - Cratelyn

- `buildSystemPrompt`: identity line becomes "You are **Cratelyn**, FreshCrate's customer support assistant. ...".
- `app/chat.tsx` `Welcome`: "Hi{name}, I'm Cratelyn 👋" and a one-line intro naming Cratelyn.
- The header "FreshCrate Support" (product name) and the `document.title` are unchanged - Cratelyn is the assistant within the product.
- Test: `prompt.test.ts` asserts the identity names Cratelyn.

---

## B2 - Subscription-cost refusal

Reproduced on `main` in a multi-turn conversation following a subscription action: intermittently the first "subscription costs" question is misrouted to `get_subscription` (which has no pricing) and refused; then the model anchors on its own prior refusal and repeats it without searching (deterministic, 4/4). Prompt-only fix:

1. `# Knowledge answers` explicitly lists "plan and subscription **costs / pricing / how much a plan costs**" as a KB topic.
2. `# Subscription` clarifies `get_subscription` is for *this customer's own* live status, plan, dietary track, billing date, and pause length - never the generic price of plans, which is a knowledge-base question.
3. A new anti-stick rule: never repeat an earlier "I can't provide that" without searching first; a pricing, policy, or menu question always warrants a fresh `search_knowledge_base`, even if an earlier turn failed to answer it.
4. `# Confirmation outcomes` clarified: an unanswered prompt on screen never blocks answering an unrelated question - answer it normally.

Test: E2E replays the screenshot sequence (pause proposal in history -> "What are the subscription costs" -> "the meal subscription costs?") against the mock provider and asserts a KB answer with prices, not a refusal.

---

## B3 - Nudge backstop robustness

`shouldNudge` missed the reproduced phrasing "I can proceed to change your dietary track to gluten-free... Let me go ahead and initiate that change for you", because "I can proceed to" is not a claim marker, "proceed to" is not the "proceed with" it looks for, and the `DIETARY_TRACK` regex requires the track word before the diet noun. Targeted broadening (not a blanket widen, to avoid false nudges):

- `CLAIM_MARKER` / `PROPOSE_MARKER` gain: "i can proceed", "proceed to", "go ahead and", "let me go ahead", "i'll initiate", "i will initiate", "initiate that", "process that", "set that up", "apply that".
- `DIETARY_TRACK` matches the track word and the diet noun in **either order** within the window.
- New `nudge.test.ts` cases: the exact failed sentence nudges; "let me go ahead and initiate that change" (dietary context) nudges; a genuine question ("what's on the gluten-free menu?") and a real post-tool "please confirm below" do NOT nudge.

---

## Verification

Local gate `npm run test:all` (typecheck + unit + api + integration) then `npm run test:e2e`, in that order (E2E reseeds at its start). A schema change means `npm run db:reset` before the api/integration suites. F1's `billing_adjustment_cents` is additive; existing seeds default it to 0.

## Files touched (summary)

**New:** `lib/billing/round-trip.test.ts`, an `OrderCard` in `app/chat.tsx`, `docs` spec/plan.

**Modified:** `db/schema.ts`, `db/seed.ts` (default the new column), `lib/billing/{pricing,quotes,reconcile}.ts` + tests, `app/api/actions/{pause,resume}/route.ts` + tests, `lib/tools/{subscription,orders,select-order}.ts` + tests, `lib/domain/terms.ts` (OrderSelector), `lib/agent/{prompt,dispatch,nudge}.ts` + tests, `app/chat.tsx`, `lib/llm/mock-scripts.ts` + cypress specs, `docs/PROJECT_STATE.md`.
