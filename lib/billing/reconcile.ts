import { eq } from "drizzle-orm";
import { db } from "../../db";
import { customers, subscriptionEvents, transactions, plans } from "../../db/schema";
import { pausedWeekReductionCents, weeksUntilDate } from "./pricing";
import { money } from "../money";

/** A monthly billing cycle is treated as 4 weeks for pause purposes. */
const WEEKS_PER_PERIOD = 4;

export type SubStatus = "active" | "paused" | "cancelled";

export interface ReconInput {
  status: SubStatus;
  billingDate: string; // ISO YYYY-MM-DD, the NEXT billing date
  pauseResumeDate: string | null; // ISO; set iff finite-paused (null = indefinite/active/cancelled)
  weeklyCents: number;
  monthlyCents: number;
  billingAdjustmentCents: number;
}

export interface ReconTxn {
  type: string;
  amountCents: number; // +charge / −credit
  description: string;
  date: string; // ISO YYYY-MM-DD the event is dated to
}

export interface ReconEvent {
  eventType: string;
  date: string;
}

export interface ReconResult {
  status: SubStatus;
  billingDate: string;
  pauseResumeDate: string | null;
  transactions: ReconTxn[];
  events: ReconEvent[];
  billingAdjustmentCents: number;
  changed: boolean;
}

// Local-calendar formatting (matches pricing.ts's local startOfDay). Using
// toISOString here would shift the day by the UTC offset and drift each month.
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => new Date(`${s}T00:00:00`);

/** Same day next month (JS clamps overflow, e.g. Jan 31 → Mar 3 — fine for a demo). */
function addMonth(isoDate: string): string {
  const d = parse(isoDate);
  d.setMonth(d.getMonth() + 1);
  return iso(d);
}

/**
 * Pure catch-up: given a subscription's state and the current instant, compute
 * every billing/pause event that has come due since it was last current, in
 * chronological order, and return the resulting state plus the transactions and
 * status-change events to record. No DB, no clock — deterministic in `now`.
 *
 * Rules per billing-date crossing: every non-cancelled sub is charged its
 * monthly plan price plus any deferred adjustment, floored at zero. A paused
 * week is billed at the $8 pause fee instead of the plan's weekly rate, which the
 * adjustment carries as a (weekly − $8) reduction per paused week - so a
 * fully-paused month bills 4 × $8. A sub still paused after a crossing pre-loads
 * the next period's full-period reduction; a resume claws back the weeks that go
 * active again. A finite pause auto-resumes the moment its resume date passes,
 * adding (weekly − $8) × weeks-then-left-to-billing to billingAdjustmentCents. A
 * CANCELLED sub is never billed.
 *
 * Self-cursoring: billing dates advance past `now` and the resume date clears, so
 * re-running on the result is a no-op. Loop is capped as a runaway backstop.
 */
export function computeReconciliation(input: ReconInput, now: Date): ReconResult {
  let status = input.status;
  let billingDate = input.billingDate;
  let pauseResumeDate = input.pauseResumeDate;
  let billingAdjustment = input.billingAdjustmentCents;
  const transactions: ReconTxn[] = [];
  const events: ReconEvent[] = [];
  const nowMs = now.getTime();

  for (let guard = 0; guard < 600; guard++) {
    const resumeMs = status === "paused" && pauseResumeDate ? parse(pauseResumeDate).getTime() : null;
    const billMs = status !== "cancelled" ? parse(billingDate).getTime() : null;

    // Pick the earliest event that has already come due (resume wins ties).
    let ev: "resume" | "bill" | null = null;
    let evMs = Infinity;
    if (resumeMs !== null && resumeMs <= nowMs) {
      ev = "resume";
      evMs = resumeMs;
    }
    if (billMs !== null && billMs <= nowMs && billMs < evMs) {
      ev = "bill";
      evMs = billMs;
    }
    if (!ev) break;

    if (ev === "resume") {
      const weeks = weeksUntilDate(billingDate, parse(pauseResumeDate!));
      billingAdjustment += pausedWeekReductionCents(input.weeklyCents) * weeks;
      events.push({ eventType: "resumed", date: pauseResumeDate! });
      status = "active";
      pauseResumeDate = null;
    } else {
      // Bill the period that just ended: monthly plus any deferred adjustment,
      // floored at zero. The same for an active or a still-paused sub — the
      // adjustment already carries this period's paused weeks as a (weekly − $8)
      // reduction each, so a fully-paused month bills 4 × $8.
      const amount = Math.max(0, input.monthlyCents + billingAdjustment);
      const note = billingAdjustment !== 0 ? ` (incl. ${billingAdjustment < 0 ? "-" : "+"}${money(Math.abs(billingAdjustment))} adjustment)` : "";
      transactions.push({ type: "monthly_billing", amountCents: amount, description: `Monthly billing${note}`, date: billingDate });
      billingAdjustment = 0;
      // Still paused into the next period → pre-load its full-period reduction; a
      // later resume claws back the weeks that go active again.
      if (status === "paused") {
        billingAdjustment = -pausedWeekReductionCents(input.weeklyCents) * WEEKS_PER_PERIOD;
      }
      billingDate = addMonth(billingDate);
    }
  }

  const changed =
    transactions.length > 0 ||
    events.length > 0 ||
    billingDate !== input.billingDate ||
    status !== input.status ||
    pauseResumeDate !== input.pauseResumeDate ||
    billingAdjustment !== input.billingAdjustmentCents;
  return { status, billingDate, pauseResumeDate, transactions, events, billingAdjustmentCents: billingAdjustment, changed };
}

/**
 * Lazy reconcile: bring ONE customer's subscription up to date as of `now`,
 * persisting any billing / pause-fee / auto-resume effects. Called at every
 * request choke point (chat, account, action routes) so state is always current
 * on read. A row lock (`FOR UPDATE`) serialises concurrent reconciles for the
 * same customer, so a double request can't double-charge; no-ops don't write.
 */
export async function reconcile(customerId: string, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, customerId)).for("update");
    if (!c || !c.billingDate) return;
    const [plan] = await tx.select().from(plans).where(eq(plans.plan, c.plan)).limit(1);
    if (!plan) return;

    const result = computeReconciliation(
      {
        status: c.subscriptionStatus as SubStatus,
        billingDate: c.billingDate,
        pauseResumeDate: c.pauseResumeDate,
        weeklyCents: plan.weeklyCents,
        monthlyCents: plan.monthlyCents,
        billingAdjustmentCents: c.billingAdjustmentCents,
      },
      now,
    );
    if (!result.changed) return; // nothing came due — state is already current

    if (result.transactions.length) {
      await tx.insert(transactions).values(
        result.transactions.map((t) => ({ customerId, type: t.type, amountCents: t.amountCents, description: t.description, createdAt: parse(t.date) })),
      );
    }
    if (result.events.length) {
      await tx.insert(subscriptionEvents).values(result.events.map((e) => ({ customerId, eventType: e.eventType, createdAt: parse(e.date), metadata: {} })));
    }
    await tx
      .update(customers)
      .set({
        subscriptionStatus: result.status,
        billingDate: result.billingDate,
        pauseResumeDate: result.pauseResumeDate,
        billingAdjustmentCents: result.billingAdjustmentCents,
        lastReconciledAt: now,
      })
      .where(eq(customers.id, customerId));
  });
}
