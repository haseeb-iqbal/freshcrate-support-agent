"use client";

import { money } from "@/lib/money";
import { CrateCard, CrateOutcome } from "./crate";
import { PromptActions } from "./prompt-actions";
import type { PlanChangeProposal, ProposalState } from "../types";

export function PlanCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: PlanChangeProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const p = proposal.proration_cents;
  const weeks = `${proposal.weeks_until_billing} week${proposal.weeks_until_billing === 1 ? "" : "s"}`;
  const proration =
    p > 0
      ? `You'll be charged ${money(p)} now (prorated for the ${weeks} until billing).`
      : p < 0
        ? `You'll be refunded ${money(-p)} (prorated for the ${weeks} until billing).`
        : "No proration is due this cycle.";
  return (
    <CrateCard testId="plan-card" title="Change your plan" state={state}>
      <p>
        Switch{proposal.current_plan ? ` from ${proposal.current_plan}` : ""} to{" "}
        <span className="font-bold">{proposal.plan}</span> at <span className="font-bold">{money(proposal.monthly_cents)}/month</span>?
      </p>
      {proposal.weekly_savings_cents != null && proposal.weekly_savings_cents > 0 && (
        <p className="mt-1 text-[13px] text-brand">
          That&apos;s <span className="font-bold">{money(proposal.weekly_savings_cents)}/week</span> less than buying those meals à la carte.
        </p>
      )}
      <p className="mt-1 text-[13px] text-muted">
        {proposal.paused
          ? "Your subscription stays paused. Nothing is charged now - the new plan's rate starts when you resume."
          : `${proration} Your new plan starts next week.`}
      </p>

      <PromptActions
        state={state}
        confirmLabel="Yes, switch plan"
        declineLabel="Not now"
        onConfirm={onConfirm}
        onDecline={onDecline}
      />
      {state === "approved" && (
        <CrateOutcome tone="done">
          Plan changed to {proposal.plan} ({money(proposal.monthly_cents)}/month){proposal.paused ? ", still paused" : ""}.
        </CrateOutcome>
      )}
      {state === "declined" && <CrateOutcome tone="neutral">No problem, your plan is unchanged.</CrateOutcome>}
      {state === "error" && <CrateOutcome tone="error">Couldn&apos;t change the plan. Please try again.</CrateOutcome>}
    </CrateCard>
  );
}
