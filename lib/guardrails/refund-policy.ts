const DEFAULT_CEILING_CENTS = 1000; // $10 — overridden by REFUND_CEILING_CENTS

/** The configured refund ceiling in cents. */
export function refundCeilingCents(): number {
  const v = Number(process.env.REFUND_CEILING_CENTS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CEILING_CENTS;
}

export type RefundDecision =
  | { kind: "over_ceiling"; ceilingCents: number }
  | { kind: "needs_confirmation"; ceilingCents: number };

/**
 * Pure refund policy (no DB, no model): refunds at or below the ceiling require
 * the customer's explicit confirmation; refunds above it can't be self-served
 * and must be escalated to a human. Used by both the issue_refund tool and the
 * write endpoint, so the rule lives in exactly one place.
 */
export function evaluateRefund(order: { totalCents: number }): RefundDecision {
  const ceilingCents = refundCeilingCents();
  return order.totalCents > ceilingCents
    ? { kind: "over_ceiling", ceilingCents }
    : { kind: "needs_confirmation", ceilingCents };
}
