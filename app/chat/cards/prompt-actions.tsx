"use client";

import type { ProposalState } from "../types";

/** States in which a card still shows its confirm/decline buttons (enabled or
 *  disabled) rather than a terminal outcome message. */
export function isPromptActive(state: ProposalState): boolean {
  return state === "pending" || state === "submitting" || state === "locked";
}

/**
 * The confirm/decline button row shared by every proposal card, so the
 * "disable while a write is in flight" (submitting) and "disable once the
 * customer moved on" (locked) behaviours live in exactly one place and can't
 * drift between cards.
 *
 * - submitting: both disabled, confirm reads "Processing…".
 * - locked: both disabled (greyed) — the prompt is no longer actionable.
 */
export function PromptActions({
  state,
  confirmLabel,
  declineLabel,
  onConfirm,
  onDecline,
  confirmClassName = "btn-primary",
}: {
  state: ProposalState;
  confirmLabel: string;
  declineLabel: string;
  onConfirm: () => void;
  onDecline: () => void;
  confirmClassName?: string;
}) {
  if (!isPromptActive(state)) return null;
  const submitting = state === "submitting";
  const disabled = submitting || state === "locked";
  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
      <button
        onClick={onConfirm}
        disabled={disabled}
        aria-busy={submitting || undefined}
        className={`btn ${confirmClassName}`}
      >
        {submitting ? "Processing…" : confirmLabel}
      </button>
      <button
        onClick={onDecline}
        disabled={disabled}
        className="btn btn-secondary"
      >
        {declineLabel}
      </button>
      {state === "pending" && <span className="text-[13px] text-muted">Nothing changes until you confirm.</span>}
    </div>
  );
}
