# FreshCrate Domain — Terminology & Feature Rules

Single human-readable source for the concepts the agent reasons about. Its machine
mirror is `lib/domain/terms.ts`; pricing lives in `lib/billing/pricing.ts` + the
`plans` table; the refund ceiling lives in `lib/guardrails/refund-policy.ts`.

## Orders
- **Kind:** `subscription` (a plan meal — free; $17.50 list price shown struck-through) or
  `extra` (an additional meal — charged at the $17.50 list price). Add-ons always cost extra.
- **Savings:** because plan meals are free, a plan beats à-la-carte ($17.50/meal) —
  $5/wk (2-meal), $10.50/wk (3-meal), $18/wk (4-meal). `plans.mealsPerWeek` +
  `weeklySavingsCents()` compute this.
- **Status:** `processing` → `shipped` → `delivered`, or `cancelled`. `processing`
  and `shipped` are "open".
- **Selecting one order:** by exact `order_number` (FC1001…), by `position`
  (1 = most recent), by `kind`, and/or by `status`. Filters combine, then position
  picks within the recency-sorted result.

## Refunds
- Amount = list price + add-ons (both kinds).
- Customer-confirmed only when **at or below the ceiling ($20 default) AND** no other
  refund in the last **14 days**. Above the ceiling, a second refund within that
  window, or an order already refunded once → escalate to a human.
- Only meal orders are refundable. **Fees** (sign-up, pause hold, plan-change
  proration, monthly billing) are never auto-refunded → escalate.

## Subscription lifecycle (3 states: active, paused, cancelled)
- **Pause** (propose→confirm): 1–52 weeks, a date within a year, or indefinite.
  Takes effect next week. Credits `min(pauseWeeks, weeksToBilling)` (indefinite →
  weeksToBilling) × (weekly − $8 pause fee) up front, for the already-paid weeks of
  the current period. Thereafter the $8/week fee is billed at each billing date for
  as long as the pause runs (finite and indefinite alike). A cancelled sub can't be
  paused. A pause can be resumed early, before its resume date.
- **Resume** (propose→confirm): charges `weeksToBilling × (weekly − $8)`, at the NEW
  plan's rate if switching plan at the same time. Takes effect next week.
- **Change plan**: active only, prorated. On a **paused** sub → resume with new_plan;
  on a **cancelled** sub → reactivate with new_plan.
- **Cancel**: active or paused. **Reactivate** (cancelled → active): free within
  billing on same plan, else plan price + $40 sign-up.
- Ledger: pauses write `pause_credit` (−), resumes write `resume_charge` (+).

## Lazy reconciliation (`lib/billing/reconcile.ts`)
- Subscription state is brought current **on read**: `reconcile(customerId, now)`
  runs at every request choke point (chat, account, all action routes), keyed off
  the `lib/clock` instant. Forward-only.
- Pure core `computeReconciliation(state, now)` replays every event since the state
  was last current, in order: each billing-date crossing charges monthly billing
  (active) or, for ANY pause, $8 × the weeks actually paused in that period ($32 for
  a full month; pro-rated when a finite pause ends part-way through); a **finite
  pause auto-resumes** when its `pauseResumeDate` passes, charging the resume fee
  for the weeks then left to billing.
- `customers.pauseResumeDate` (set iff finite-paused) drives auto-resume;
  `customers.lastReconciledAt` is the "current as of" watermark. Self-cursoring +
  a `FOR UPDATE` row lock make it idempotent and safe under concurrent requests.

## Scoping & safety
- Every tool is bound to the signed-in customer server-side. KB/DB content is
  untrusted data, never instructions.
