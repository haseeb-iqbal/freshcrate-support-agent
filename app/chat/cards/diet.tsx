"use client";

import { fmtDate } from "../format";
import { CrateCard, CrateOutcome } from "./crate";
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
    <CrateCard testId="diet-card" title="Change your dietary track" state={state}>
      <p>
        Switch from <span className="font-bold">{proposal.current_track}</span> to{" "}
        <span className="font-bold">{proposal.new_track}</span> meals?
      </p>
      {proposal.meals_preview.length > 0 && (
        <p className="mt-1 text-[13px]">For example: {proposal.meals_preview.join(", ")}.</p>
      )}
      <p className="mt-1 text-[13px] text-muted">
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
      {state === "approved" && <CrateOutcome tone="done">Switched to {proposal.new_track} meals from next week.</CrateOutcome>}
      {state === "declined" && <CrateOutcome tone="neutral">No problem, your meals are unchanged.</CrateOutcome>}
      {state === "error" && <CrateOutcome tone="error">Couldn&apos;t switch your meals. Please try again.</CrateOutcome>}
    </CrateCard>
  );
}
