import { eq } from "drizzle-orm";
import { db } from "../../db";
import { customers, subscriptionEvents, transactions, plans } from "../../db/schema";
import { PAUSE_FEE_CENTS, resumeChargeCents, weeksUntilDate } from "./pricing";

/** A monthly billing cycle is treated as 4 weeks for pause-fee purposes. */
const WEEKS_PER_PERIOD = 4;

/** A full month of pause, billed at $8/week. */
export const PAUSE_FEE_MONTHLY_CENTS = PAUSE_FEE_CENTS * WEEKS_PER_PERIOD; // $32/month

export type SubStatus = "active" | "paused" | "cancelled";

export interface ReconInput {
  status: SubStatus;
  billingDate: string; // ISO YYYY-MM-DD, the NEXT billing date
  pauseResumeDate: string | null; // ISO; set iff finite-paused (null = indefinite/active/cancelled)
  weeklyCents: number;
  monthlyCents: number;
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
 * Rules per billing-date crossing: an ACTIVE sub is charged its monthly plan
 * price; an INDEFINITE pause (no resume date) is charged the $8/week fee for the
 * month; a FINITE pause rolls its billing date with no charge (it was credited
 * up front); a CANCELLED sub is never billed. A finite pause auto-resumes the
 * moment its resume date passes, charging the resume fee for the weeks then left
 * to billing — after which normal billing resumes.
 *
 * Self-cursoring: billing dates advance past `now` and the resume date clears, so
 * re-running on the result is a no-op. Loop is capped as a runaway backstop.
 */
export function computeReconciliation(input: ReconInput, now: Date): ReconResult {
  let status = input.status;
  let billingDate = input.billingDate;
  let pauseResumeDate = input.pauseResumeDate;
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
      const charge = resumeChargeCents(input.weeklyCents, weeks);
      if (charge > 0) {
        transactions.push({ type: "resume_charge", amountCents: charge, description: "Auto-resume charge (pause ended)", date: pauseResumeDate! });
      }
      events.push({ eventType: "resumed", date: pauseResumeDate! });
      status = "active";
      pauseResumeDate = null;
    } else {
      if (status === "active") {
        transactions.push({ type: "monthly_billing", amountCents: input.monthlyCents, description: "Monthly billing", date: billingDate });
      } else if (status === "paused") {
        // $8 for each week actually paused in this period — a full 4 weeks for an
        // indefinite pause, fewer when a finite pause ends part-way through.
        const pausedWeeks = pauseResumeDate
          ? Math.min(WEEKS_PER_PERIOD, weeksUntilDate(pauseResumeDate, parse(billingDate)))
          : WEEKS_PER_PERIOD;
        if (pausedWeeks > 0) {
          transactions.push({
            type: "pause_fee",
            amountCents: pausedWeeks * PAUSE_FEE_CENTS,
            description: `Pause fee (${pausedWeeks} week${pausedWeeks === 1 ? "" : "s"} @ $8)`,
            date: billingDate,
          });
        }
      }
      billingDate = addMonth(billingDate);
    }
  }

  const changed = transactions.length > 0 || events.length > 0 || billingDate !== input.billingDate || status !== input.status || pauseResumeDate !== input.pauseResumeDate;
  return { status, billingDate, pauseResumeDate, transactions, events, changed };
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
      .set({ subscriptionStatus: result.status, billingDate: result.billingDate, pauseResumeDate: result.pauseResumeDate, lastReconciledAt: now })
      .where(eq(customers.id, customerId));
  });
}
