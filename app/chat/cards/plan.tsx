"use client";

import { money } from "@/lib/money";
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
    <div data-testid="plan-card" className="mt-3 rounded-lg border border-teal-200 bg-teal-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-700">Plan change</p>
      <p className="mt-1 text-sm text-slate-800">
        Switch{proposal.current_plan ? ` from ${proposal.current_plan}` : ""} to{" "}
        <span className="font-semibold">{proposal.plan}</span> at <span className="font-semibold">{money(proposal.monthly_cents)}/month</span>?
      </p>
      {proposal.weekly_savings_cents != null && proposal.weekly_savings_cents > 0 && (
        <p className="mt-1 text-xs text-emerald-600">
          That&apos;s <span className="font-medium">{money(proposal.weekly_savings_cents)}/week</span> less than buying those meals à la carte.
        </p>
      )}
      <p className="mt-1 text-xs text-slate-500">
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
        <p className="mt-2 text-xs font-medium text-emerald-700">
          ✓ Plan changed to {proposal.plan} ({money(proposal.monthly_cents)}/month){proposal.paused ? " - still paused" : ""}.
        </p>
      )}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — your plan is unchanged.</p>}
      {state === "error" && <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t change the plan — please try again.</p>}
    </div>
  );
}
