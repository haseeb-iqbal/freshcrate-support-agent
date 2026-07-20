const DEFAULT_CEILING_CENTS = 2000; // $20 — overridden by REFUND_CEILING_CENTS

/** A customer may self-serve at most one refund per this many days. */
export const REFUND_COOLDOWN_DAYS = 14;

/** The configured refund ceiling in cents. */
export function refundCeilingCents(): number {
  const v = Number(process.env.REFUND_CEILING_CENTS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CEILING_CENTS;
}

export type RefundDecision =
  | { kind: "over_ceiling"; ceilingCents: number }
  | { kind: "cooldown"; nextEligible: Date; cooldownDays: number }
  | { kind: "needs_confirmation"; ceilingCents: number };

/**
 * Pure refund policy (no DB, no model). Two independent self-service gates, plus
 * the confirm case:
 *  - value ceiling: a refund above the ceiling can't be self-served → escalate.
 *  - frequency: at most one refund per REFUND_COOLDOWN_DAYS; a second within the
 *    window → escalate. The window is measured from the customer's most recent
 *    confirmed refund (`lastRefundAt`); a declined proposal never sets it.
 * The ceiling is checked first so an oversized refund gets the amount-based
 * message even when it would also trip the cooldown. Used by both the
 * issue_refund tool and the write endpoint, so the rule lives in one place.
 */
export function evaluateRefund(input: { totalCents: number; now: Date; lastRefundAt: Date | null }): RefundDecision {
  const ceilingCents = refundCeilingCents();
  if (input.totalCents > ceilingCents) return { kind: "over_ceiling", ceilingCents };

  if (input.lastRefundAt) {
    const nextEligible = new Date(input.lastRefundAt.getTime() + REFUND_COOLDOWN_DAYS * 86_400_000);
    if (input.now.getTime() < nextEligible.getTime()) {
      return { kind: "cooldown", nextEligible, cooldownDays: REFUND_COOLDOWN_DAYS };
    }
  }

  return { kind: "needs_confirmation", ceilingCents };
}
