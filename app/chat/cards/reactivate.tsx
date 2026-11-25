"use client";

import { money } from "@/lib/money";
import { CrateCard, CrateOutcome } from "./crate";
import { PromptActions } from "./prompt-actions";
import type { ProposalState, ReactivateProposal } from "../types";

export function ReactivateCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: ReactivateProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const fee = proposal.signup_fee_cents;
  const total = money(proposal.total_cents);
  return (
    <CrateCard title="Reactivate your subscription" state={state}>
      {proposal.plan_changed && (
        <p className="text-[13px] text-muted">Switching from {proposal.previous_plan} to {proposal.plan}.</p>
      )}
      {proposal.free ? (
        <p>
          Restart your <span className="font-bold">{proposal.plan}</span> plan{" "}
          <span className="font-bold text-brand">for free</span>. You&apos;re still within your billing period, so there&apos;s no charge.
        </p>
      ) : (
        <p>
          Restart on <span className="font-bold">{proposal.plan}</span>? First charge is{" "}
          <span className="font-bold">{money(proposal.monthly_cents)}</span>
          {fee > 0 ? (
            <>
              {" "}+ <span className="font-bold">{money(fee)}</span> sign-up fee
            </>
          ) : null}{" "}
          = <span className="font-bold">{total}</span>.
        </p>
      )}

      <PromptActions
        state={state}
        confirmLabel={proposal.free ? "Reactivate for free" : `Pay ${total} & reactivate`}
        declineLabel="Not now"
        onConfirm={onConfirm}
        onDecline={onDecline}
      />
      {state === "approved" && (
        <CrateOutcome tone="done">
          Reactivated on {proposal.plan}{proposal.free ? " (free)" : `, ${total} charged`}.
        </CrateOutcome>
      )}
      {state === "declined" && <CrateOutcome tone="neutral">No problem, your subscription stays cancelled.</CrateOutcome>}
      {state === "error" && <CrateOutcome tone="error">Couldn&apos;t reactivate. Please try again.</CrateOutcome>}
    </CrateCard>
  );
}
