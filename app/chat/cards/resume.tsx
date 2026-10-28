"use client";

import { money } from "@/lib/money";
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
    <div data-testid="resume-card" className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Resume request</p>
      {proposal.plan_changed && (
        <p className="text-[11px] text-slate-500">Switching from {proposal.previous_plan} to {proposal.plan}.</p>
      )}
      <p className="mt-1 text-sm text-slate-800">
        Resume your <span className="font-semibold">{proposal.plan}</span> plan? It restarts from next week
        {hasCharge ? (
          <> — resuming adds back <span className="font-semibold">{charge}</span> for the weeks up to billing you&apos;ll now receive, so your next bill will be <span className="font-semibold">{nextBill}</span>.</>
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
        <p className="mt-2 text-xs font-medium text-emerald-700">
          ✓ Resumed on {proposal.plan}{hasCharge ? ` — next bill ${nextBill}` : ""}.
        </p>
      )}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — your subscription stays paused.</p>}
      {state === "error" && (
        <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t resume the subscription — please try again.</p>
      )}
    </div>
  );
}
