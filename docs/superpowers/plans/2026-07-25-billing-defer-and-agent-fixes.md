# Deferred Billing & Agent Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Defer the pause credit / resume charge to the next monthly bill (full weekly rate, round-tripping to zero), rename the assistant to Cratelyn, add a single-order card, and fix three agent bugs (date order lookup, subscription-cost sticky refusal, nudge robustness).

**Architecture:** F1 stores a running `billing_adjustment_cents` on the customer that `reconcile` applies to the next monthly bill; pause debits it and resume credits it, both at the full weekly rate, so an immediate pause+resume cancels exactly. The rest are prompt, tool, selector, and UI changes over existing seams.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind v3, Drizzle ORM + Postgres, Vitest (unit/api/integration), Cypress (`MOCK_LLM=1`).

## Global Constraints

- Branch `billing-defer-and-agent-fixes` is checked out; the spec is committed.
- **Never use the em dash character in new strings, comments, or docs. Use a plain hyphen `-`.**
- Pure logic in `lib/` with colocated `*.test.ts`; React in `app/`; `lib/` never imports from `app/`.
- The pause/resume **credit and charge use the full weekly rate** (no `- $8`). The `$8/week` pause fee (`PAUSE_FEE_CENTS`) is unchanged and applies only while paused across a billing date, via `reconcile`.
- **Round-trip invariant:** an immediate pause then resume must net to zero. Pause and resume both key off `weeksToBilling`, so the pause credit is the whole remaining cycle, NOT the pause length.
- `monthly_billing` is clamped to `max(0, monthly + adjustment)`; no residual carried.
- Money is integer cents. `money(cents)` from `@/lib/money` formats `$X.XX`.
- `npm run lint` does not work in this repo (no eslint) - never run it. Run `npm run test:all` BEFORE `npm run test:e2e`. A schema change needs `npm run db:reset` before the api/integration suites. Mock scripts must never call `search_knowledge_base` (real embeddings). `lib/llm/mock-scripts.test.ts` enforces a two-way spec/script binding.

---

### Task 1: Deferred-billing core (pricing, quotes, reconcile, pause/resume routes)

This is one cohesive behavioural change: the credit/charge semantics thread through the pure billing layer and both action routes, and their tests move together. Big, but a reviewer judges it as one unit.

**Files:**
- Modify: `db/schema.ts` (add `billingAdjustmentCents`)
- Modify: `lib/billing/pricing.ts`, `lib/billing/pricing.test.ts`
- Modify: `lib/billing/quotes.ts`, `lib/billing/quotes.test.ts`
- Modify: `lib/billing/reconcile.ts`, `lib/billing/reconcile.test.ts`
- Create: `lib/billing/round-trip.test.ts`
- Modify: `app/api/actions/pause/route.ts`, `tests/api/pause.test.ts`
- Modify: `app/api/actions/resume/route.ts`, `tests/api/resume.test.ts`

**Interfaces:**
- Consumes: nothing from later tasks.
- Produces:
  - `weeklyValueCents(weeklyCents: number, weeks: number): number` in `pricing.ts`
  - `PauseQuote` with `adjustment_cents`, `net_credit_cents` (replacing `reimbursement_cents`)
  - `ResumeQuote` with `charge_cents` (full-weekly), `monthly_cents`, `next_bill_cents`
  - `ReconInput`/`ReconResult` gain `billingAdjustmentCents: number`
  - `customers.billingAdjustmentCents` column

- [ ] **Step 1: Add the schema column**

In `db/schema.ts`, inside `customers`, after the `lastReconciledAt` line add:

```ts
  billingAdjustmentCents: integer("billing_adjustment_cents").notNull().default(0), // one-time +/- applied to the next monthly bill (deferred pause credit / resume charge)
```

`integer` is already imported. Then run:

```bash
npm run db:reset
```

Expected: `[✓] Changes applied` / `[✓] Pulling schema` and the seed summary. The column now exists with default 0.

- [ ] **Step 2: Write the failing pricing test**

In `lib/billing/pricing.test.ts`, change the import line to drop the two removed helpers and add the new one:

```ts
import {
  MEAL_LIST_PRICE_CENTS,
  PAUSE_FEE_CENTS,
  prorationCents,
  weeklyValueCents,
  weeklySavingsCents,
  weeksUntilDate,
  withinBillingPeriod,
} from "./pricing";
```

Delete the entire `describe("pauseReimbursementCents", ...)` and `describe("resumeChargeCents", ...)` blocks. Add:

```ts
describe("weeklyValueCents", () => {
  it("is the weekly rate times the weeks", () => {
    expect(weeklyValueCents(3000, 2)).toBe(6000);
    expect(weeklyValueCents(4200, 3)).toBe(12600);
  });

  it("is zero for zero or negative weeks", () => {
    expect(weeklyValueCents(3000, 0)).toBe(0);
    expect(weeklyValueCents(3000, -1)).toBe(0);
  });
});

describe("constants", () => {
  it("keeps the $8/week pause fee", () => {
    expect(PAUSE_FEE_CENTS).toBe(800);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test -- lib/billing/pricing.test.ts`
Expected: FAIL - `weeklyValueCents` is not exported.

- [ ] **Step 4: Replace the pricing helpers**

In `lib/billing/pricing.ts`, delete `pauseReimbursementCents` and `resumeChargeCents` (lines defining both functions and their doc comments) and add in their place:

```ts
/**
 * Plan value of a run of weeks at the given weekly rate - the basis of the
 * deferred pause credit and resume charge. Full weekly rate, NO fee netting:
 * the $8/week pause fee is applied separately, only while actually paused across
 * a billing date (see reconcile). Pass the resulting plan's weekly rate when the
 * customer switches plan while resuming.
 */
export function weeklyValueCents(weeklyCents: number, weeks: number): number {
  return Math.max(0, weeks) * weeklyCents;
}
```

- [ ] **Step 5: Run pricing tests green**

Run: `npm test -- lib/billing/pricing.test.ts`
Expected: PASS. (`lib/billing/quotes.ts` and `reconcile.ts` will not typecheck yet - that is fixed in the next steps; do not run the full suite until Step 12.)

- [ ] **Step 6: Rewrite the quote tests**

Replace `lib/billing/quotes.test.ts`'s pause and resume expectations. First read the file to see its existing structure, then update the pause and resume `describe` blocks so they assert the new fields. The pause quote no longer returns `reimbursement_cents`; it returns `adjustment_cents` (full remaining cycle) and `net_credit_cents` (display net). The resume quote's `charge_cents` is now full-weekly, plus `monthly_cents` and `next_bill_cents`.

Use these canonical cases (2-meal plan: weekly 3000, monthly 12000; billing 4 weeks out):

```ts
const plan = { plan: "2 meals/week", mealsPerWeek: 2, weeklyCents: 3000, monthlyCents: 12000 };
const now = new Date("2026-07-20T00:00:00");
const billing = "2026-08-17"; // weeksUntilDate = 4

describe("quotePause (deferred)", () => {
  it("credits the whole remaining cycle to the next bill", () => {
    const q = quotePause({ status: "active", billingDate: billing, plan, indefinite: true, weeks: null, now });
    expect(q.adjustment_cents).toBe(12000); // 4 weeks x $30
    expect(q.net_credit_cents).toBe(12000); // indefinite: whole cycle
  });

  it("shows a finite pause's net as the weeks actually skipped", () => {
    const q = quotePause({ status: "active", billingDate: billing, plan, indefinite: false, weeks: 2, now });
    expect(q.adjustment_cents).toBe(12000); // still the whole cycle (round-trip)
    expect(q.net_credit_cents).toBe(6000); // min(2, 4) x $30
  });

  it("credits nothing when the subscription was already paused", () => {
    const q = quotePause({ status: "paused", billingDate: billing, plan, indefinite: true, weeks: null, now });
    expect(q.adjustment_cents).toBe(0);
    expect(q.net_credit_cents).toBe(0);
    expect(q.already_paused).toBe(true);
  });
});

describe("quoteResume (deferred)", () => {
  it("charges the remaining weeks to billing at the full weekly rate, onto the next bill", () => {
    const q = quoteResume({ currentPlan: "2 meals/week", billingDate: billing, plan, now });
    expect(q.charge_cents).toBe(12000);       // 4 x $30
    expect(q.monthly_cents).toBe(12000);
    expect(q.next_bill_cents).toBe(24000);    // monthly + charge
  });

  it("charges at the new plan's weekly rate when switching on resume", () => {
    const three = { plan: "3 meals/week", mealsPerWeek: 3, weeklyCents: 4200, monthlyCents: 16800 };
    const q = quoteResume({ currentPlan: "2 meals/week", billingDate: billing, plan: three, requestedPlan: "3 meals/week", now });
    expect(q.plan_changed).toBe(true);
    expect(q.charge_cents).toBe(16800);       // 4 x $42
    expect(q.next_bill_cents).toBe(33600);
  });
});
```

Keep any existing reactivate / plan-change quote tests unchanged.

- [ ] **Step 7: Run the quote tests and watch them fail**

Run: `npm test -- lib/billing/quotes.test.ts`
Expected: FAIL - `adjustment_cents` / `net_credit_cents` / `next_bill_cents` do not exist.

- [ ] **Step 8: Rewrite the quotes**

In `lib/billing/quotes.ts`:

Change the import from pricing to drop `pauseReimbursementCents, resumeChargeCents` and add `weeklyValueCents`:

```ts
import {
  PAUSE_FEE_CENTS,
  SIGNUP_FEE_CENTS,
  prorationCents,
  weeklyValueCents,
  weeklySavingsCents,
  weeksUntilDate,
  withinBillingPeriod,
} from "./pricing";
```

Replace the `PauseQuote` interface and `quotePause` body:

```ts
export interface PauseQuote {
  indefinite: boolean;
  weeks: number | null;
  resume_date: string | null;
  /** Applied to billing_adjustment_cents now: the whole remaining cycle at the
   *  weekly rate. Zero when the subscription was already paused. Keeping this the
   *  full cycle (not the pause length) is what makes pause+resume net to zero. */
  adjustment_cents: number;
  /** What the customer nets on their next bill once this pause runs as scheduled
   *  (finite: weeks actually skipped; indefinite: whole cycle). Display only. */
  net_credit_cents: number;
  weekly_fee_cents: number;
  weeks_to_billing: number;
  already_paused: boolean;
}

export function quotePause(input: {
  status: SubStatus;
  billingDate: string | null;
  plan: PlanRate | null;
  indefinite: boolean;
  weeks: number | null;
  resumeDate?: string | null;
  now: Date;
}): PauseQuote {
  const { status, billingDate, plan, indefinite, weeks, now } = input;
  const weeksToBilling = weeksUntilDate(billingDate, now);
  const alreadyPaused = status === "paused";
  const weekly = plan?.weeklyCents ?? 0;

  // Stored adjustment = the whole remaining cycle. Display net = the weeks the
  // customer actually skips (finite pauses auto-resume and claw the rest back).
  const adjustment = alreadyPaused ? 0 : weeklyValueCents(weekly, weeksToBilling);
  const skipped = indefinite ? weeksToBilling : Math.min(weeks ?? 0, weeksToBilling);
  const netCredit = alreadyPaused ? 0 : weeklyValueCents(weekly, skipped);

  return {
    indefinite,
    weeks: indefinite ? null : weeks,
    resume_date: indefinite ? null : (input.resumeDate ?? addWeeksIso(weeks ?? 0, now)),
    adjustment_cents: adjustment,
    net_credit_cents: netCredit,
    weekly_fee_cents: PAUSE_FEE_CENTS,
    weeks_to_billing: weeksToBilling,
    already_paused: alreadyPaused,
  };
}
```

Replace the `ResumeQuote` interface and `quoteResume` body:

```ts
export interface ResumeQuote {
  plan: string;
  previous_plan: string;
  plan_changed: boolean;
  weekly_cents: number;
  monthly_cents: number;
  /** Added to billing_adjustment_cents now: the weeks left to billing at the
   *  resulting plan's full weekly rate. */
  charge_cents: number;
  /** monthly + charge, for the resume card. */
  next_bill_cents: number;
  weeks_to_billing: number;
  billing_date: string | null;
}

export function quoteResume(input: {
  currentPlan: string;
  billingDate: string | null;
  plan: PlanRate;
  requestedPlan?: string;
  now: Date;
}): ResumeQuote {
  const { currentPlan, billingDate, plan, requestedPlan, now } = input;
  const weeksToBilling = weeksUntilDate(billingDate, now);
  const charge = weeklyValueCents(plan.weeklyCents, weeksToBilling);

  return {
    plan: plan.plan,
    previous_plan: currentPlan,
    plan_changed: !!requestedPlan && requestedPlan !== currentPlan,
    weekly_cents: plan.weeklyCents,
    monthly_cents: plan.monthlyCents,
    charge_cents: charge,
    next_bill_cents: plan.monthlyCents + charge,
    weeks_to_billing: weeksToBilling,
    billing_date: billingDate,
  };
}
```

Run: `npm test -- lib/billing/quotes.test.ts`
Expected: PASS.

- [ ] **Step 9: Thread the adjustment through reconcile (write the failing test first)**

In `lib/billing/reconcile.test.ts`, add `billingAdjustmentCents: 0` to the `base` object, and change the auto-resume test plus add new cases:

```ts
const base: ReconInput = {
  status: "active",
  billingDate: "2026-09-15",
  pauseResumeDate: null,
  weeklyCents: 3000,
  monthlyCents: 12000,
  billingAdjustmentCents: 0,
};
```

Replace the existing `"auto-resumes a finite pause ..."` test body with (auto-resume now adds to the adjustment instead of posting a `resume_charge`):

```ts
  it("auto-resumes a finite pause by crediting the adjustment, not posting a charge", () => {
    // now is AFTER the billing date so both the auto-resume and the following
    // monthly billing come due in one catch-up.
    const r = computeReconciliation(
      { ...base, status: "paused", pauseResumeDate: "2026-08-25", billingDate: "2026-09-20" },
      at("2026-09-21"),
    );
    expect(r.status).toBe("active");
    expect(r.pauseResumeDate).toBeNull();
    // No resume_charge transaction; the resume adds weeks-to-billing x weekly to the adjustment.
    expect(typesOf(r)).not.toContain("resume_charge");
    // weeks to billing on 2026-08-25 from 2026-09-20 = 3 -> 3 x $30 = $90.
    // Then billing 2026-09-20 <= now: monthly + adjustment = 12000 + 9000 = 21000, adjustment cleared.
    expect(typesOf(r)).toEqual(["monthly_billing"]);
    expect(r.transactions[0].amountCents).toBe(21000);
    expect(r.billingAdjustmentCents).toBe(0);
    expect(r.events.map((e) => e.eventType)).toContain("resumed");
  });

  it("applies a stored credit to the next monthly bill and clears it", () => {
    const r = computeReconciliation(
      { ...base, billingDate: "2026-08-20", billingAdjustmentCents: -6000 },
      at("2026-09-01"),
    );
    expect(typesOf(r)).toEqual(["monthly_billing"]);
    expect(r.transactions[0].amountCents).toBe(6000); // 12000 - 6000
    expect(r.billingAdjustmentCents).toBe(0);
  });

  it("clamps a bill to zero when the credit exceeds one month, carrying no residual", () => {
    const r = computeReconciliation(
      { ...base, billingDate: "2026-08-20", billingAdjustmentCents: -20000 },
      at("2026-09-01"),
    );
    expect(r.transactions[0].amountCents).toBe(0);
    expect(r.billingAdjustmentCents).toBe(0);
  });

  it("applies the adjustment only to the first billing when several are due", () => {
    const r = computeReconciliation(
      { ...base, billingDate: "2026-07-15", billingAdjustmentCents: -3000 },
      at("2026-09-16"),
    );
    // Three crossings: first is 12000-3000=9000, the rest full 12000.
    expect(r.transactions.map((t) => t.amountCents)).toEqual([9000, 12000, 12000]);
    expect(r.billingAdjustmentCents).toBe(0);
  });
```

Run: `npm test -- lib/billing/reconcile.test.ts`
Expected: FAIL - `billingAdjustmentCents` missing from result; auto-resume still posts `resume_charge`.

- [ ] **Step 10: Implement the reconcile threading**

In `lib/billing/reconcile.ts`:

Change the pricing import to drop `resumeChargeCents` and add `weeklyValueCents`:

```ts
import { PAUSE_FEE_CENTS, weeklyValueCents, weeksUntilDate } from "./pricing";
```

Add `billingAdjustmentCents: number;` to `ReconInput` and to `ReconResult`.

In `computeReconciliation`, initialise the running value near the top:

```ts
  let billingAdjustment = input.billingAdjustmentCents;
```

In the `ev === "resume"` branch, replace the `resume_charge` push with an adjustment credit:

```ts
    if (ev === "resume") {
      const weeks = weeksUntilDate(billingDate, parse(pauseResumeDate!));
      billingAdjustment += weeklyValueCents(input.weeklyCents, weeks);
      events.push({ eventType: "resumed", date: pauseResumeDate! });
      status = "active";
      pauseResumeDate = null;
    } else {
```

In the `status === "active"` monthly-billing branch, apply and clear the adjustment:

```ts
      if (status === "active") {
        const amount = Math.max(0, input.monthlyCents + billingAdjustment);
        const note = billingAdjustment !== 0 ? ` (incl. ${billingAdjustment < 0 ? "-" : "+"}$${Math.abs(billingAdjustment) / 100} adjustment)` : "";
        transactions.push({ type: "monthly_billing", amountCents: amount, description: `Monthly billing${note}`, date: billingDate });
        billingAdjustment = 0;
      } else if (status === "paused") {
```

Update `changed` and the return:

```ts
  const changed =
    transactions.length > 0 ||
    events.length > 0 ||
    billingDate !== input.billingDate ||
    status !== input.status ||
    pauseResumeDate !== input.pauseResumeDate ||
    billingAdjustment !== input.billingAdjustmentCents;
  return { status, billingDate, pauseResumeDate, transactions, events, billingAdjustmentCents: billingAdjustment, changed };
```

In the `reconcile()` DB wrapper, add `billingAdjustmentCents: c.billingAdjustmentCents` to the `computeReconciliation` input object, and add `billingAdjustmentCents: result.billingAdjustmentCents` to the `.set({...})` update.

Run: `npm test -- lib/billing/reconcile.test.ts`
Expected: PASS.

- [ ] **Step 11: Add the round-trip test**

Create `lib/billing/round-trip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { quotePause, quoteResume } from "./quotes";

const plan = { plan: "2 meals/week", mealsPerWeek: 2, weeklyCents: 3000, monthlyCents: 12000 };
const three = { plan: "3 meals/week", mealsPerWeek: 3, weeklyCents: 4200, monthlyCents: 16800 };
const now = new Date("2026-07-20T00:00:00");
const billing = "2026-08-17"; // 4 weeks out

describe("pause/resume round-trip", () => {
  it("nets to zero for an immediate pause then resume", () => {
    const pause = quotePause({ status: "active", billingDate: billing, plan, indefinite: true, weeks: null, now });
    const resume = quoteResume({ currentPlan: plan.plan, billingDate: billing, plan, now });
    // pause debits adjustment_cents, resume credits charge_cents, at the same rate.
    expect(pause.adjustment_cents).toBe(resume.charge_cents);
    expect(-pause.adjustment_cents + resume.charge_cents).toBe(0);
  });

  it("nets a finite pause to the weeks actually skipped", () => {
    // Pause 1 week with 4 to billing, then resume 1 week later (3 to billing).
    const later = new Date("2026-07-27T00:00:00");
    const pause = quotePause({ status: "active", billingDate: billing, plan, indefinite: false, weeks: 1, now });
    const resume = quoteResume({ currentPlan: plan.plan, billingDate: billing, plan, now: later });
    // net on the bill = -adjustment(at pause) + charge(at resume) = -(4x30) + (3x30) = -1x30.
    expect(-pause.adjustment_cents + resume.charge_cents).toBe(-3000);
    expect(pause.net_credit_cents).toBe(3000); // display: 1 week skipped x $30
  });

  it("charges the new plan's rate when switching on resume", () => {
    const resume = quoteResume({ currentPlan: plan.plan, billingDate: billing, plan: three, requestedPlan: three.plan, now });
    expect(resume.charge_cents).toBe(16800); // 4 x $42
  });
});
```

Run: `npm test -- lib/billing/round-trip.test.ts`
Expected: PASS.

- [ ] **Step 12: Update the pause route and its tests**

In `app/api/actions/pause/route.ts`, replace the credit block. Remove the `transactions` insert for `pause_credit`; set the adjustment column and change the event metadata + response. The full handler body after the `quote` is computed:

```ts
  const adjustment = quote.adjustment_cents; // full remaining cycle; 0 if already paused

  await db
    .update(customers)
    .set({
      subscriptionStatus: "paused",
      pauseResumeDate: quote.resume_date,
      billingAdjustmentCents: customer.billingAdjustmentCents - adjustment,
      lastReconciledAt: now,
    })
    .where(eq(customers.id, customer.id));
  await db.insert(subscriptionEvents).values({
    customerId: customer.id,
    eventType: "paused",
    metadata: { weeks, resumeDate: quote.resume_date, indefinite, adjustmentCents: adjustment },
  });

  return Response.json({
    ok: true,
    weeks,
    indefinite,
    resume_date: quote.resume_date,
    net_credit_cents: quote.net_credit_cents,
    adjustment_cents: adjustment,
  });
```

Remove the now-unused `transactions` import if nothing else uses it (the `subscriptionEvents` and `customers` imports stay).

In `tests/api/pause.test.ts`, update the assertions. `txnsOf(ID)` is now always `[]` (no immediate transaction); assert `billingAdjustmentCents` on the customer instead. Replace the three behavioural tests:

```ts
  it("pauses for a finite term, defers the credit to the next bill, and sets the resume date", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    const res = await postJson(POST, { customerId: ID, weeks: 2 });

    expect(res.status).toBe(200);
    // stored adjustment = whole cycle (4 x $30 = $120); display net = 2 skipped weeks x $30 = $60.
    expect(await res.json()).toMatchObject({ ok: true, weeks: 2, adjustment_cents: 12000, net_credit_cents: 6000, resume_date: "2026-08-03" });

    const c = await customerOf(ID);
    expect(c.subscriptionStatus).toBe("paused");
    expect(c.pauseResumeDate).toBe("2026-08-03");
    expect(c.billingAdjustmentCents).toBe(-12000);
    expect(await txnsOf(ID)).toEqual([]); // deferred, not an immediate transaction
    expect(await eventsOf(ID)).toEqual(["paused"]);
  });

  it("defers the whole cycle for an indefinite pause and stores no resume date", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    const res = await postJson(POST, { customerId: ID, indefinite: true });

    expect(await res.json()).toMatchObject({ indefinite: true, adjustment_cents: 12000, net_credit_cents: 12000, resume_date: null });
    const c = await customerOf(ID);
    expect(c.pauseResumeDate).toBeNull();
    expect(c.billingAdjustmentCents).toBe(-12000);
    expect(await txnsOf(ID)).toEqual([]);
  });

  it("credits at most once: a replayed confirmation does not double-defer", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    await postJson(POST, { customerId: ID, weeks: 2 });
    const second = await postJson(POST, { customerId: ID, weeks: 2 });

    expect(second.status).toBe(200);
    expect((await customerOf(ID)).billingAdjustmentCents).toBe(-12000); // not doubled
  });

  it("lets an already-paused customer extend the pause without a second credit", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    await postJson(POST, { customerId: ID, weeks: 2 });
    const extend = await postJson(POST, { customerId: ID, weeks: 4 });

    expect(extend.status).toBe(200);
    expect((await customerOf(ID)).pauseResumeDate).toBe("2026-08-17");
    expect((await customerOf(ID)).billingAdjustmentCents).toBe(-12000); // unchanged by the extension
    expect(await eventsOf(ID)).toEqual(["paused", "paused"]);
  });
```

Keep the "rejects a missing customerId", "rejects a week count outside 1-52", "refuses to pause a cancelled subscription", and "404s an unknown customer" tests, but in the week-count test change `expect(await txnsOf(ID)).toEqual([])` to also assert `expect((await customerOf(ID)).billingAdjustmentCents).toBe(0)` (nothing deferred on a rejected call).

- [ ] **Step 13: Update the resume route and its tests**

In `app/api/actions/resume/route.ts`, replace the charge block. Remove the `resume_charge` transaction insert; add the charge to the adjustment column:

```ts
  await db
    .update(customers)
    .set({
      subscriptionStatus: "active",
      plan: effectivePlan,
      pauseResumeDate: null,
      billingAdjustmentCents: customer.billingAdjustmentCents + quote.charge_cents,
    })
    .where(eq(customers.id, customer.id));
```

Keep the `resumed` and `plan_changed` event inserts. Remove the `if (charge > 0) { transactions.insert(...) }` block and the now-unused `charge`/`transactions` references, but keep returning the charge in the response:

```ts
  return Response.json({ ok: true, plan: effectivePlan, plan_changed: planChanged, charge_cents: quote.charge_cents, next_bill_cents: quote.next_bill_cents });
```

Read `tests/api/resume.test.ts` and update its charge assertions to the full-weekly amounts and the `billingAdjustmentCents` column (charge deferred, no `resume_charge` transaction). Follow the same shape as the pause test edits: assert `customerOf(ID).billingAdjustmentCents` increased by the full-weekly charge, and `txnsOf(ID)` has no `resume_charge`.

- [ ] **Step 14: Full gate for Task 1**

```bash
npm run db:reset
```
```bash
npm run test:all
```
Expected: typecheck clean; unit, api, integration all green. If `tests/integration` has a reconcile/seed test that references the old `pause_credit`/`resume_charge` rows, update it to the deferred model (assert `billingAdjustmentCents` and the adjusted `monthly_billing`, not the removed transactions). The pause->resume->skip-forward flow the spec mentions is covered by the combination of `round-trip.test.ts` (pure math), `reconcile.test.ts` (adjustment applied on billing), and the api pause/resume tests (routes write the column against the real DB); a separate integration test is not added. Fix any red before committing.

- [ ] **Step 15: Commit**

```bash
git add db/schema.ts lib/billing app/api/actions/pause/route.ts app/api/actions/resume/route.ts tests/api/pause.test.ts tests/api/resume.test.ts
git commit -m "feat: defer the pause credit and resume charge to the next monthly bill"
```

---

### Task 2: Pause / resume card and tool-message copy

**Files:**
- Modify: `app/chat.tsx` (`PauseProposal`, `ResumeProposal` interfaces; `PauseCard`, `ResumeCard`)
- Modify: `lib/tools/subscription.ts` (pause/resume tool `message` + `summary` strings)

**Interfaces:**
- Consumes: `PauseQuote.adjustment_cents`/`net_credit_cents`, `ResumeQuote.charge_cents`/`next_bill_cents`/`monthly_cents` from Task 1.
- Produces: nothing later depends on.

- [ ] **Step 1: Update the proposal payload shapes in the tools**

In `lib/tools/subscription.ts`, `pauseSubscription` returns `proposal` (the `quotePause` result) - it now carries `adjustment_cents`/`net_credit_cents` automatically. Update the `summary` and `message` strings so they describe the deferred credit, not an immediate one. Replace the pause return `summary`/`message`:

```ts
    const credit = money(proposal.net_credit_cents);
    return {
      ok: true,
      summary: indefinite
        ? `Proposed indefinite pause (next bill drops ~${credit}, then ${PAUSE_FEE_PER_WEEK} billed monthly)`
        : `Proposed ${weeks}-week pause (resumes ${proposal.resume_date}, next bill drops ~${credit})`,
      data: {
        status: "needs_confirmation",
        proposal,
        message:
          `A confirmation prompt is shown. Nothing is charged or credited now: the customer's NEXT monthly bill is reduced by about ${credit} for the weeks they skip, and while they stay paused past a billing date the ${PAUSE_FEE_PER_WEEK} pause fee applies. The plan pauses from next week (this week's box still ships) and they can resume early. Briefly relay it and ask them to confirm. Do NOT say it's paused until they confirm.${proposal.already_paused ? " NOTE: already paused, so no new credit is due - do not promise one." : ""}`,
      },
    };
```

In `resumeSubscription`, replace the `charge` line and the return `summary`/`message`:

```ts
    const charge = money(proposal.charge_cents);
    const nextBill = money(proposal.next_bill_cents);
    return {
      ok: true,
      summary: proposal.plan_changed
        ? `Proposed resume on ${proposal.plan} - next bill ${nextBill}`
        : `Proposed resume - next bill ${nextBill}`,
      data: {
        status: "needs_confirmation",
        proposal,
        message:
          `A confirmation prompt shows the resume. Nothing is charged now: the weeks left until billing (${charge} at the plan's weekly rate) are ADDED to the customer's next monthly bill, making it about ${nextBill}. The plan resumes from next week. Ask them to confirm; do NOT say it's resumed until they confirm.`,
      },
    };
```

- [ ] **Step 2: Update the card interfaces and copy**

In `app/chat.tsx`, change `PauseProposal` to replace `reimbursement_cents` with the two new fields, and `ResumeProposal` to add the two new fields:

```ts
interface PauseProposal {
  indefinite: boolean;
  weeks: number | null;
  resume_date: string | null;
  adjustment_cents: number;
  net_credit_cents: number;
  weekly_fee_cents: number;
  weeks_to_billing: number;
}
```
```ts
interface ResumeProposal {
  plan: string;
  previous_plan?: string | null;
  plan_changed: boolean;
  weekly_cents: number;
  monthly_cents: number;
  charge_cents: number;
  next_bill_cents: number;
  weeks_to_billing: number;
  billing_date?: string | null;
}
```

In `PauseCard`, replace the `credit`/`hasCredit` lines and the explanatory paragraph and confirmation line so they say the credit lands on the next bill:

```ts
  const resume = formatLongDate(proposal.resume_date);
  const credit = money(proposal.net_credit_cents);
  const fee = money(proposal.weekly_fee_cents);
  const hasCredit = proposal.net_credit_cents > 0;
```

Replace the `<p className="mt-1 text-xs text-slate-500">...` explanation with:

```tsx
      <p className="mt-1 text-xs text-slate-500">
        {hasCredit ? (
          <>Your <span className="font-medium">next bill drops by about {credit}</span> for the weeks you skip. </>
        ) : (
          <>No credit is due this cycle (billing is within the week). </>
        )}
        If you stay paused past a billing date, {fee}/week applies while paused.
      </p>
```

Replace the `state === "approved"` line:

```tsx
      {state === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">
          ✓ Paused{proposal.indefinite ? " indefinitely" : ` — resumes ${resume}`}{hasCredit ? ` (next bill drops ~${credit})` : ""}.
        </p>
      )}
```

In `ResumeCard`, replace the `charge`/`hasCharge` lines and the sentence:

```ts
  const charge = money(proposal.charge_cents);
  const nextBill = money(proposal.next_bill_cents);
  const hasCharge = proposal.charge_cents > 0;
```

Replace the main paragraph:

```tsx
      <p className="mt-1 text-sm text-slate-800">
        Resume your <span className="font-semibold">{proposal.plan}</span> plan? It restarts from next week
        {hasCharge ? (
          <> — the weeks left until billing (<span className="font-semibold">{charge}</span>) are added to your next bill, making it about <span className="font-semibold">{nextBill}</span>.</>
        ) : (
          <> at no extra charge this cycle (billing is due within the week).</>
        )}
      </p>
```

Replace the confirm button label (it currently reads `Pay ${charge} & resume`, which is wrong now that nothing is paid up front) with a plain "Resume", and replace the approved line:

```tsx
          <button onClick={onConfirm} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark">
            Resume
          </button>
```
```tsx
      {state === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">
          ✓ Resumed on {proposal.plan}{hasCharge ? ` — next bill ~${nextBill}` : ""}.
        </p>
      )}
```

- [ ] **Step 3: Typecheck and browser-verify**

Run: `npm run typecheck`
Expected: clean.

Start the mock dev server (`npm run dev:mock` via the preview tooling), sign in as Ava, ask "pause my subscription for 2 weeks", and confirm the pause card reads "next bill drops by about $X" (not "credited now"). Ask Diego (paused) "resume my subscription" and confirm the resume card reads "added to your next bill, making it about $Y". If the dev server cannot start, say so in the report.

- [ ] **Step 4: Commit**

```bash
git add app/chat.tsx lib/tools/subscription.ts
git commit -m "feat: reword the pause and resume cards for deferred billing"
```

---

### Task 3: Date-based order lookup

**Files:**
- Modify: `lib/domain/terms.ts` (`OrderSelector`)
- Modify: `lib/tools/select-order.ts`, `lib/tools/select-order.test.ts`
- Modify: `lib/tools/orders.ts` (`lookup_order` param + wiring)

**Interfaces:**
- Consumes: nothing.
- Produces: `OrderSelector.date?: string`; `SelectableOrder.deliveryDate?: string | null`; `lookup_order` accepts a `date` argument.

- [ ] **Step 1: Write the failing selector test**

In `lib/tools/select-order.test.ts`, extend the `mk` helper to carry a delivery date and add date cases:

```ts
const mk = (orderNumber: string, iso: string, over: Partial<SelectableOrder> = {}): SelectableOrder => ({
  orderNumber,
  kind: "subscription",
  status: "delivered",
  placedAt: new Date(iso),
  deliveryDate: null,
  ...over,
});
```

Add:

```ts
  it("matches an order by its delivery date", () => {
    const withDelivery = [mk("FC1010", "2026-07-01T00:00:00Z", { deliveryDate: "2026-07-25" }), A, B];
    expect(selectOrder(withDelivery, { date: "2026-07-25" })?.orderNumber).toBe("FC1010");
  });

  it("matches an order by the calendar day it was placed", () => {
    expect(selectOrder(orders, { date: "2026-06-23" })?.orderNumber).toBe("FC1004");
  });

  it("returns null when no order is on that date", () => {
    expect(selectOrder(orders, { date: "2020-01-01" })).toBeNull();
  });

  it("prefers order_number over date", () => {
    expect(selectOrder(orders, { orderNumber: "FC1006", date: "2026-06-23" })?.orderNumber).toBe("FC1006");
  });
```

Run: `npm test -- lib/tools/select-order.test.ts`
Expected: FAIL - `date` is not handled; `deliveryDate` not on the type.

- [ ] **Step 2: Add `date` to the selector type**

In `lib/domain/terms.ts`, add to `OrderSelector`:

```ts
  /** ISO YYYY-MM-DD; matches an order delivered or placed on that day. */
  date?: string;
```

- [ ] **Step 3: Implement date matching**

In `lib/tools/select-order.ts`, add `deliveryDate` to `SelectableOrder` and a date filter (after the `orderNumber` short-circuit, before position):

```ts
export interface SelectableOrder {
  orderNumber: string;
  kind: OrderKind;
  status: OrderStatus;
  placedAt: Date;
  deliveryDate?: string | null;
}
```

Replace the filtering section:

```ts
  let pool = orders;
  if (sel.kind) pool = pool.filter((o) => o.kind === sel.kind);
  if (sel.status) pool = pool.filter((o) => o.status === sel.status);
  if (sel.date) {
    const placedDay = (o: T) =>
      `${o.placedAt.getFullYear()}-${String(o.placedAt.getMonth() + 1).padStart(2, "0")}-${String(o.placedAt.getDate()).padStart(2, "0")}`;
    pool = pool.filter((o) => o.deliveryDate === sel.date || placedDay(o) === sel.date);
  }
  const sorted = [...pool].sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime());
```

Run: `npm test -- lib/tools/select-order.test.ts`
Expected: PASS.

- [ ] **Step 4: Wire the `date` argument into `lookup_order`**

In `lib/tools/orders.ts`, add a `date` property to the tool's `parameters.properties` and to the `sel` object.

In `definition.parameters.properties`, after `status`:

```ts
        date: { type: "string", description: "A day the customer named, as YYYY-MM-DD - matches an order delivered or placed that day. Use the # Today date to resolve phrases like 'yesterday' or '25th July'." },
```

Update the tool `description` to mention it: append to the existing sentence `"... or 'my most recent extra meal'"`:

```ts
      "... Use this — NOT list_orders — whenever the customer means a single order, including 'my last order', 'my 2nd last order', 'my order on 25th July', or 'my most recent extra meal'. list_orders is only for showing the full history.",
```

In the handler's `sel` object, add:

```ts
      date: typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : undefined,
```

The DB `select()` returns rows with `deliveryDate` already, so `selectOrder(all as unknown as SelectableOrder[], sel)` needs no other change.

Run: `npm test -- lib/tools/select-order.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/terms.ts lib/tools/select-order.ts lib/tools/select-order.test.ts lib/tools/orders.ts
git commit -m "feat: look up a single order by the date the customer names"
```

---

### Task 4: Today's date in the system prompt

**Files:**
- Modify: `lib/agent/prompt.ts`, `lib/agent/prompt.test.ts`
- Modify: `lib/agent/loop.ts`

**Interfaces:**
- Consumes: `formatLongDate` from `@/lib/date` (already exists).
- Produces: `buildSystemPrompt(now: Date)` - signature gains a required `now`.

- [ ] **Step 1: Write the failing prompt test**

In `lib/agent/prompt.test.ts`, the file builds `const prompt = buildSystemPrompt();` once. Change it to pass a fixed date and add a test:

```ts
  const prompt = buildSystemPrompt(new Date("2026-07-25T00:00:00"));
```
```ts
  it("tells the model today's date so it can resolve relative dates", () => {
    expect(prompt).toContain("# Today");
    expect(prompt).toContain("25th July 2026 (25-07-2026)");
  });
```

Run: `npm test -- lib/agent/prompt.test.ts`
Expected: FAIL - `buildSystemPrompt` takes no argument; no `# Today` section.

- [ ] **Step 2: Add the `# Today` section**

In `lib/agent/prompt.ts`, add the import and change the signature + add the section as the first entry after the identity line:

```ts
import { formatLongDate } from "@/lib/date";
```
```ts
export function buildSystemPrompt(now: Date): string {
  const today = formatLongDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
  return [
    "You are FreshCrate's customer support assistant. FreshCrate is a weekly meal-kit subscription service. You help the currently signed-in customer with support questions and account actions, using the tools available to you.",

    `# Today\nToday is ${today}. Use it to resolve relative dates the customer gives ("yesterday", "last Tuesday", "25th July") into a YYYY-MM-DD date for tools.`,
    // ... the rest of the sections unchanged ...
```

Leave the identity line as "FreshCrate's customer support assistant" here - Task 6 owns the Cratelyn rename.

- [ ] **Step 3: Pass `now` from the loop**

In `lib/agent/loop.ts`, `turnNow` is computed at `const turnNow = now();`. Move that line ABOVE the `buildSystemPrompt()` call, and pass it in:

```ts
  const turnNow = now();
  const base = buildSystemPrompt(turnNow);
  const system = customerLabel ? `${base}\n\nSigned-in customer: ${customerLabel}.` : base;
```

Remove the later duplicate `const turnNow = now();` line.

- [ ] **Step 4: Run and commit**

Run: `npm test -- lib/agent/prompt.test.ts lib/agent/loop.test.ts && npm run typecheck`
Expected: PASS, clean. (`loop.test.ts` builds the agent through `runAgent`, which now passes `turnNow` - if any loop test called `buildSystemPrompt()` directly, give it a date.)

```bash
git add lib/agent/prompt.ts lib/agent/prompt.test.ts lib/agent/loop.ts
git commit -m "feat: give the model today's date for resolving relative dates"
```

---

### Task 5: Single-order card

**Files:**
- Modify: `lib/agent/dispatch.ts`, `lib/agent/dispatch.test.ts`
- Modify: `app/chat.tsx` (`Message.order`, `order` event handler, `OrderCard`)

**Interfaces:**
- Consumes: `lookup_order` returns `data.order` (an `OrderView`) - already the case.
- Produces: an `order` SSE event carrying the `OrderView`.

- [ ] **Step 1: Write the failing dispatch test**

In `lib/agent/dispatch.test.ts`, add a case asserting a successful `lookup_order` emits an `order` event and tells the model not to restate details. Follow the file's existing `dispatchTool` test shape (read it first for the helper style):

```ts
  it("emits an order card and tells the model not to restate the order for lookup_order", () => {
    const call = { id: "c1", name: "lookup_order", arguments: "{}" };
    const result = { ok: true, summary: "Order FC1001", data: { order: { order_number: "FC1001", status: "delivered" }, open_order_count: 1 } };
    const out = dispatchTool(call as any, result as any, { shownProposals: new Set() });
    expect(out.events.map((e) => e.event)).toContain("order");
    expect(out.events.find((e) => e.event === "order")?.data).toMatchObject({ order_number: "FC1001" });
    expect(out.modelContent).toContain("card");
  });
```

Run: `npm test -- lib/agent/dispatch.test.ts`
Expected: FAIL - no `order` event.

- [ ] **Step 2: Emit the `order` event in dispatch**

In `lib/agent/dispatch.ts`, after the `list_orders` history block, add a lookup_order block:

```ts
  // A single-order lookup drives the single-order card.
  if (call.name === "lookup_order" && result.ok && data?.order) {
    events.push({ event: "order", data: data.order });
  }
```

And in the `modelContent` selection, add a branch (before the final `else`):

```ts
  } else if (call.name === "lookup_order" && result.ok && data?.order) {
    modelContent = JSON.stringify({
      order: data.order,
      note: "This order is shown to the customer in a card. Give a short natural lead-in and do NOT restate its number, status, price, items, or dates. You may still answer a specific question about it in a sentence.",
    });
  } else {
```

Run: `npm test -- lib/agent/dispatch.test.ts`
Expected: PASS.

- [ ] **Step 3: Render the card in the client**

In `app/chat.tsx`:

Add to the `Message` interface: `order?: OrderView;`.

In `handleEvent`, add a branch alongside the other `else if` events:

```ts
    } else if (event === "order") {
      patchLast({ order: data as OrderView });
```

In `MessageBubble`, after the `history` card block, add (gated by `showResults` like the others):

```tsx
        {!isUser && showResults && message.order && <OrderCard order={message.order} />}
```

Add the `showThinking` guard term `&& !message.order` to the existing `showThinking` boolean so a bare order lookup doesn't show the spinner beside the card.

Add the component near `HistoryCard`:

```tsx
function OrderCard({ order }: { order: OrderView }) {
  return (
    <div data-testid="order-card" className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Order</p>
      <OrderRow o={order} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck and browser-verify**

Run: `npm run typecheck`
Expected: clean.

With the mock dev server, sign in as Marcus, ask "show me my last order", and confirm a single `order-card` renders with the order details and the reply text is a short lead-in (no order fields restated). If the dev server cannot start, note it.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/dispatch.ts lib/agent/dispatch.test.ts app/chat.tsx
git commit -m "feat: show a single-order card instead of the model writing the details"
```

---

### Task 6: Rename the assistant to Cratelyn

**Files:**
- Modify: `lib/agent/prompt.ts`, `lib/agent/prompt.test.ts`
- Modify: `app/chat.tsx` (`Welcome`)

**Interfaces:** none shared.

- [ ] **Step 1: Write the failing prompt test**

In `lib/agent/prompt.test.ts`, add:

```ts
  it("introduces itself as Cratelyn", () => {
    expect(prompt).toContain("You are Cratelyn");
  });
```

Run: `npm test -- lib/agent/prompt.test.ts`
Expected: FAIL only if Task 4 has not already renamed the identity line; if Task 4 ran first this passes. Either way, ensure the identity line in `lib/agent/prompt.ts` reads:

```ts
    "You are Cratelyn, FreshCrate's customer support assistant. FreshCrate is a weekly meal-kit subscription service. You help the currently signed-in customer with support questions and account actions, using the tools available to you.",
```

- [ ] **Step 2: Name Cratelyn in the welcome bubble**

In `app/chat.tsx`, the `Welcome` component's heading currently reads `Hi{customer ? ...} 👋`. Change it to introduce Cratelyn:

```tsx
      <h2 className="text-base font-semibold text-slate-800">
        Hi{customer ? `, ${customer.name.split(" ")[0]}` : ""} - I&apos;m Cratelyn 👋
      </h2>
```

Leave the header "FreshCrate Support" and `document.title` unchanged.

- [ ] **Step 3: Run and commit**

Run: `npm test -- lib/agent/prompt.test.ts && npm run typecheck`
Expected: PASS, clean.

```bash
git add lib/agent/prompt.ts lib/agent/prompt.test.ts app/chat.tsx
git commit -m "feat: name the assistant Cratelyn"
```

---

### Task 7: Fix the subscription-cost refusal

**Files:**
- Modify: `lib/agent/prompt.ts`, `lib/agent/prompt.test.ts`

**Interfaces:** none shared.

- [ ] **Step 1: Write the failing prompt test**

In `lib/agent/prompt.test.ts`, add:

```ts
  it("routes subscription/plan pricing to the knowledge base, not get_subscription", () => {
    const knowledge = prompt.slice(prompt.indexOf("# Knowledge answers"), prompt.indexOf("# Orders"));
    expect(knowledge.toLowerCase()).toContain("cost");
    expect(knowledge.toLowerCase()).toContain("pricing");
  });

  it("tells the model never to repeat a prior refusal without searching", () => {
    expect(prompt).toContain("search_knowledge_base");
    expect(prompt.toLowerCase()).toContain("even if an earlier");
  });
```

Run: `npm test -- lib/agent/prompt.test.ts`
Expected: FAIL.

- [ ] **Step 2: Apply the four prompt changes**

In `lib/agent/prompt.ts`:

(a) In `# Knowledge answers`, add plan/subscription costs to the topic list - change "plans and pricing" to:

```
plans, plan and subscription COSTS / PRICING / how much a plan costs, dietary tracks,
```

and append a sentence to that section:

```
 Never repeat an earlier "I don't have that" / "I can't provide that" without searching again first: a pricing, policy, or menu question ALWAYS warrants a fresh search_knowledge_base, even if an earlier turn failed to answer it.
```

(b) In `# Subscription`, change the opening so `get_subscription` is scoped to the customer's own account, not generic pricing. Replace the first sentence:

```
For a question about THIS customer's own subscription - their live status, plan, dietary track, next billing date, or how long they are paused - you MUST call get_subscription and answer from its result, never from memory. get_subscription is NOT for the generic price of plans: "what do plans cost" / "subscription costs" are knowledge-base questions (see # Knowledge answers), never get_subscription.
```

(c) In `# Confirmation outcomes`, append:

```
 A prompt still on screen never blocks other questions: if the customer asks about something unrelated (pricing, an order, a policy) while a prompt is unanswered, just answer it normally.
```

Run: `npm test -- lib/agent/prompt.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/prompt.ts lib/agent/prompt.test.ts
git commit -m "fix: route subscription-cost questions to the KB and stop sticky refusals"
```

---

### Task 8: Harden the nudge backstop

**Files:**
- Modify: `lib/agent/nudge.ts`, `lib/agent/nudge.test.ts`

**Interfaces:** none shared.

- [ ] **Step 1: Write the failing tests**

In `lib/agent/nudge.test.ts`, add (follow the file's existing `shouldNudge` call shape):

```ts
  it("nudges the reproduced 'I can proceed to change ... let me go ahead and initiate' phrasing", () => {
    const text =
      "I can proceed to change your dietary track to gluten-free, and it will take effect from next week's menu. Let me go ahead and initiate that change for you.";
    expect(shouldNudge({ assistantText: text, actionToolCallCount: 0, alreadyNudged: false })).toBe(true);
  });

  it("nudges 'let me go ahead and initiate that switch to the vegetarian menu'", () => {
    // Marker and target in ONE sentence - claimsStateChange is per-sentence by
    // design (avoids false positives from a marker and a target that merely
    // co-occur in unrelated sentences).
    const text = "Let me go ahead and initiate that switch to the vegetarian menu.";
    expect(shouldNudge({ assistantText: text, actionToolCallCount: 0, alreadyNudged: false })).toBe(true);
  });

  it("does NOT nudge a plain menu question", () => {
    const text = "What's on the gluten-free menu this week? Here are a few options.";
    expect(shouldNudge({ assistantText: text, actionToolCallCount: 0, alreadyNudged: false })).toBe(false);
  });

  it("does NOT nudge a real post-tool confirmation ask", () => {
    const text = "I've set that up - please confirm below to apply it.";
    expect(shouldNudge({ assistantText: text, actionToolCallCount: 1, alreadyNudged: false })).toBe(false);
  });
```

Run: `npm test -- lib/agent/nudge.test.ts`
Expected: FAIL on the first two.

- [ ] **Step 2: Broaden the markers**

In `lib/agent/nudge.ts`, extend `CLAIM_MARKER` and `PROPOSE_MARKER`, and make `DIETARY_TRACK` order-independent. Replace those three constants:

```ts
// New markers are FIRST-PERSON only. Bare second-person forms ("go ahead and",
// "proceed to", "apply that") would fire on legitimate self-service guidance
// ("you can go ahead and cancel from settings"), which must NOT nudge - that is
// the "targeted, not blanket" constraint.
const CLAIM_MARKER =
  /\b(?:i've|i have|i'll|i will|i'm going to|i am going to|i can proceed|i'll initiate|i will initiate|let me|gone ahead|gone ahead and|has been|have been|is now|are now|you're now|you are now)\b/i;

// Unchanged from the original - do NOT add "proceed to" (fires on "proceed to cancel your sub yourself").
const PROPOSE_MARKER = /\b(?:propose|please confirm|proceed with|go ahead with)\b/i;

/** Dietary-track switch: a track word and a diet noun in either order in one sentence. */
const DIETARY_TRACK =
  /\b(?:vegetarian|gluten-free|dairy-free|standard)\b[^.!?]{0,30}\b(?:menu|track|meals?|diet)\b|\b(?:menu|track|meals?|diet)\b[^.!?]{0,30}\b(?:vegetarian|gluten-free|dairy-free|standard)\b/i;
```

Run: `npm test -- lib/agent/nudge.test.ts`
Expected: PASS (all four, plus the pre-existing tests).

- [ ] **Step 3: Full unit run and commit**

Run: `npm test`
Expected: all unit tests pass (guards against a broadened marker firing on an existing negative case).

```bash
git add lib/agent/nudge.ts lib/agent/nudge.test.ts
git commit -m "fix: catch more describe-instead-of-call phrasings in the nudge backstop"
```

---

### Task 9: E2E coverage, mock scripts, docs, and the full gate

**Files:**
- Modify: `lib/llm/mock-scripts.ts`
- Modify: `cypress/e2e/agent.cy.ts`, `cypress/e2e/confirm.cy.ts`
- Modify: `docs/PROJECT_STATE.md`

**Interfaces:** consumes everything above.

- [ ] **Step 1: Add mock scripts for the new specs**

In `lib/llm/mock-scripts.ts`, add entries (text-only where possible; none may call `search_knowledge_base`). Use Marcus's seeded orders for the date lookup - read `db/seed.ts` for a real delivery date to key the question on, and match the question text exactly to the spec `ask()` strings you write in Step 2. Add:

```ts
  "show me my last order": {
    pre_tool: [call("lookup_order", { position: 1 })],
    post_tool: [t("Here's your most recent order:")],
  },
  "what are the subscription costs?": {
    // The sticky-refusal spec asserts this ANSWERS. Text-only fixture with the prices,
    // since a search_knowledge_base call is banned in E2E.
    pre_tool: [t("Our plans are 2 meals/week at $30, 3 at $42, and 4 at $52 per week.")],
    post_tool: [],
  },
```

For the date-lookup spec, add a script keyed on the exact question you will ask (e.g. `"show me my order from <delivery-date-phrase>"`) whose `pre_tool` calls `lookup_order` with the matching `date`.

- [ ] **Step 2: Add the E2E specs**

In `cypress/e2e/agent.cy.ts`, add read-only specs:

```ts
  it("shows a single-order card for a positional lookup", () => {
    signInAs("Marcus Bell");
    ask("show me my last order");
    cy.get('[data-testid="order-card"]').should("have.length", 1);
    cy.get('[data-testid="assistant-text"]').should("not.contain.text", "FC1004"); // details are in the card, not the text
  });

  it("answers subscription costs and does not stick on a refusal", () => {
    signInAs("Ava Chen");
    ask("what are the subscription costs?");
    cy.get('[data-testid="assistant-text"]').should("contain.text", "$30");
  });
```

Add the date-lookup spec matching the mock script from Step 1.

- [ ] **Step 3: Verify the mock-scripts contract**

Run: `npm test -- lib/llm/mock-scripts.test.ts`
Expected: PASS. If it fails, an `ask()` string does not match a script key after `normalize` (lowercase, trimmed, collapsed whitespace) - align them.

- [ ] **Step 4: Update the confirm spec for deferred billing**

The pause confirm spec in `cypress/e2e/confirm.cy.ts` asserts the card text after confirming. Update any assertion that expects "credited"/"Paused ($X credited)" to the new "next bill drops" wording. Read the file and adjust the pause-confirm assertion to match the Task 2 copy.

- [ ] **Step 5: Run the whole gate**

```bash
npm run db:reset
```
```bash
npm run test:all
```
Expected: green. Then:
```bash
npm run test:e2e
```
Expected: all specs pass. If a pre-existing spec fails on a wholesale basis, check for an orphaned `node.exe` on port 3000 (Windows) and kill it by PID before debugging.

- [ ] **Step 6: Update the docs**

In `docs/PROJECT_STATE.md`:
- §7 Business rules, the Pause/Resume bullets: change "credited up front" / "charges ... up front" to "deferred to the next monthly bill at the full weekly rate (round-trips to zero on an immediate pause+resume); the $8/week fee still applies while paused across a billing date."
- §5/§8: note the `order` SSE event and the single-order card; note the assistant is named Cratelyn; note `lookup_order` accepts a `date`.
- §9: update the E2E spec count from the real Cypress run output (do not guess).

- [ ] **Step 7: Commit**

```bash
git add lib/llm/mock-scripts.ts cypress/e2e docs/PROJECT_STATE.md
git commit -m "test: cover deferred billing, the order card, date lookup and cost routing; refresh docs"
```

- [ ] **Step 8: Push and open a draft PR**

```bash
git push -u origin billing-defer-and-agent-fixes
```
```bash
gh pr create --draft --title "Deferred pause/resume billing + agent fixes" --body "Implements docs/superpowers/specs/2026-07-25-billing-defer-and-agent-fixes-design.md"
```

The user reviews and merges manually.
