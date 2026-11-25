"use client";

import { money } from "@/lib/money";
import { CrateCard, CrateOutcome } from "./crate";
import { PromptActions } from "./prompt-actions";
import type { ProposalState, ResumeProposal } from "../types";

export function ResumeCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: ResumeProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const charge = money(proposal.charge_cents);
  const nextBill = money(proposal.next_bill_cents);
  const hasCharge = proposal.charge_cents > 0;
  return (
    <CrateCard testId="resume-card" title="Resume your subscription" state={state}>
      {proposal.plan_changed && (
        <p className="text-[13px] text-muted">Switching from {proposal.previous_plan} to {proposal.plan}.</p>
      )}
      <p>
        Resume your <span className="font-bold">{proposal.plan}</span> plan? It restarts from next week
        {hasCharge ? (
          <>, and resuming adds back <span className="font-bold">{charge}</span> for the weeks up to billing you&apos;ll now receive, so your next bill will be <span className="font-bold">{nextBill}</span>.</>
        ) : (
          <> at no extra charge this cycle (billing is due within the week).</>
        )}
      </p>

      <PromptActions
        state={state}
        confirmLabel="Resume"
        declineLabel="Not now"
        onConfirm={onConfirm}
        onDecline={onDecline}
      />
      {state === "approved" && (
        <CrateOutcome tone="done">
          Resumed on {proposal.plan}{hasCharge ? `. Next bill ${nextBill}` : ""}.
        </CrateOutcome>
      )}
      {state === "declined" && <CrateOutcome tone="neutral">No problem, your subscription stays paused.</CrateOutcome>}
      {state === "error" && <CrateOutcome tone="error">Couldn&apos;t resume the subscription. Please try again.</CrateOutcome>}
    </CrateCard>
  );
}
