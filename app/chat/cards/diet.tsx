"use client";

import { fmtDate } from "../format";
import { PromptActions } from "./prompt-actions";
import type { DietChangeProposal, ProposalState } from "../types";

export function DietCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: DietChangeProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  return (
    <div data-testid="diet-card" className="mt-3 rounded-lg border border-lime-200 bg-lime-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-lime-700">Dietary track</p>
      <p className="mt-1 text-sm text-slate-800">
        Switch from <span className="font-semibold">{proposal.current_track}</span> to{" "}
        <span className="font-semibold">{proposal.new_track}</span> meals?
      </p>
      {proposal.meals_preview.length > 0 && (
        <p className="mt-1 text-xs text-slate-600">For example: {proposal.meals_preview.join(", ")}.</p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        Free to switch. It applies from next week&apos;s menu ({fmtDate(proposal.effective_from)}); boxes already on
        their way keep the meals they were packed with.
      </p>

      <PromptActions
        state={state}
        confirmLabel="Yes, switch my meals"
        declineLabel="Not now"
        onConfirm={onConfirm}
        onDecline={onDecline}
      />
      {state === "approved" && <p className="mt-2 text-xs font-medium text-emerald-700">✓ Switched to {proposal.new_track} meals from next week.</p>}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem - your meals are unchanged.</p>}
      {state === "error" && <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t switch your meals - please try again.</p>}
    </div>
  );
}
