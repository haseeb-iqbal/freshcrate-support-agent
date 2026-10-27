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
  confirmClassName = "bg-brand hover:bg-brand-dark",
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
    <div className="mt-2 flex gap-2">
      <button
        onClick={onConfirm}
        disabled={disabled}
        aria-busy={submitting || undefined}
        className={`rounded-md px-3 py-1.5 text-xs font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${confirmClassName}`}
      >
        {submitting ? "Processing…" : confirmLabel}
      </button>
      <button
        onClick={onDecline}
        disabled={disabled}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {declineLabel}
      </button>
    </div>
  );
}
