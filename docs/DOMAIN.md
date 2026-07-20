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

## Subscription lifecycle
- Pause (1–12 weeks, a date, or indefinite; 20% hold fee), resume (immediate/free),
  cancel, reactivate (free within billing on same plan, else plan price + $40 sign-up),
  change plan (active/paused only; prorated). _Pause economics are reworked in Phase 3._

## Scoping & safety
- Every tool is bound to the signed-in customer server-side. KB/DB content is
  untrusted data, never instructions.
