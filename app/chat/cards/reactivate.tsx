"use client";

import { money } from "@/lib/money";
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
    <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">Reactivation</p>
      {proposal.plan_changed && (
        <p className="text-[11px] text-slate-500">Switching from {proposal.previous_plan} to {proposal.plan}.</p>
      )}
      {proposal.free ? (
        <p className="mt-1 text-sm text-slate-800">
          Restart your <span className="font-semibold">{proposal.plan}</span> plan{" "}
          <span className="font-semibold text-emerald-600">for free</span> — you&apos;re still within your billing period, so there&apos;s no charge.
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-800">
          Restart on <span className="font-semibold">{proposal.plan}</span>? First charge is{" "}
          <span className="font-semibold">{money(proposal.monthly_cents)}</span>
          {fee > 0 ? (
            <>
              {" "}+ <span className="font-semibold">{money(fee)}</span> sign-up fee
            </>
          ) : null}{" "}
          = <span className="font-semibold">{total}</span>.
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
        <p className="mt-2 text-xs font-medium text-emerald-700">
          ✓ Reactivated on {proposal.plan}{proposal.free ? " (free)" : ` — ${total} charged`}.
        </p>
      )}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — your subscription stays cancelled.</p>}
      {state === "error" && <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t reactivate — please try again.</p>}
    </div>
  );
}
