"use client";

import { money } from "@/lib/money";
import { formatLongDate } from "@/lib/date";
import { PromptActions } from "./prompt-actions";
import type { CancelProposal, ProposalState } from "../types";

export function CancelCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: CancelProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const billing = formatLongDate(proposal.billing_date);
  return (
    <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-700">Cancel subscription</p>
      <p className="mt-1 text-sm text-slate-800">
        Cancel your subscription? You&apos;ve paid for this month, so your boxes keep arriving until {billing || "your billing date"}. After that no more boxes ship and you won&apos;t be charged again.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Heads up: if you resubscribe after your billing date{billing ? ` (${billing})` : ""}, a{" "}
        <span className="font-medium">{money(proposal.signup_fee_cents)}</span> sign-up fee applies. Resubscribe before then on the same plan and it&apos;s free.
      </p>

      <PromptActions
        state={state}
        confirmLabel="Yes, cancel"
        declineLabel="Keep my subscription"
        confirmClassName="bg-rose-600 hover:bg-rose-700"
        onConfirm={onConfirm}
        onDecline={onDecline}
      />
      {state === "approved" && <p className="mt-2 text-xs font-medium text-slate-700">✓ Subscription cancelled. Your boxes keep arriving until {billing || "your billing date"}.</p>}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-emerald-700">Great — your subscription is unchanged.</p>}
      {state === "error" && <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t cancel — please try again.</p>}
    </div>
  );
}
