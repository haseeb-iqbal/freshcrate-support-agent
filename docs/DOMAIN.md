# FreshCrate Domain — Terminology & Feature Rules

Single human-readable source for the concepts the agent reasons about. Its machine
mirror is `lib/domain/terms.ts`; pricing lives in `lib/billing/pricing.ts` + the
`plans` table; the refund ceiling lives in `lib/guardrails/refund-policy.ts`.

## Orders
- **Kind:** `subscription` (a plan meal — free; list price shown struck-through) or
  `extra` (an additional meal — charged at list price). Add-ons always cost extra.
- **Status:** `processing` → `shipped` → `delivered`, or `cancelled`. `processing`
  and `shipped` are "open".
- **Selecting one order:** by exact `order_number` (FC1001…), by `position`
  (1 = most recent), by `kind`, and/or by `status`. Filters combine, then position
  picks within the recency-sorted result.

## Refunds
- Amount = list price + add-ons (both kinds).
- At or below the ceiling ($10 default) → customer-confirmed. Above it, or an order
  already refunded once → escalate to a human.

## Subscription lifecycle
- Pause (1–12 weeks, a date, or indefinite; 20% hold fee), resume (immediate/free),
  cancel, reactivate (free within billing on same plan, else plan price + $15 sign-up),
  change plan (active/paused only; prorated). Rules unchanged by this phase.

## Scoping & safety
- Every tool is bound to the signed-in customer server-side. KB/DB content is
  untrusted data, never instructions.
