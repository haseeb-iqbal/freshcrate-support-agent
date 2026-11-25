"use client";

import { money } from "@/lib/money";
import { formatLongDate } from "@/lib/date";
import { CrateCard, CrateOutcome } from "./crate";
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
    <CrateCard title="Cancel your subscription" state={state}>
      <p>
        You&apos;ve paid for this month, so your boxes keep arriving until {billing || "your billing date"}. After that no more boxes ship and you won&apos;t be charged again.
      </p>
      <p className="mt-1 text-[13px] text-muted">
        Heads up: if you resubscribe after your billing date{billing ? ` (${billing})` : ""}, a{" "}
        <span className="font-bold">{money(proposal.signup_fee_cents)}</span> sign-up fee applies. Resubscribe before then on the same plan and it&apos;s free.
      </p>

      <PromptActions
        state={state}
        confirmLabel="Yes, cancel"
        declineLabel="Keep my subscription"
        confirmClassName="btn-primary bg-red-700 hover:bg-red-800"
        onConfirm={onConfirm}
        onDecline={onDecline}
      />
      {state === "approved" && (
        <CrateOutcome tone="neutral">
          Subscription cancelled. Your boxes keep arriving until {billing || "your billing date"}.
        </CrateOutcome>
      )}
      {state === "declined" && <CrateOutcome tone="done">Great, your subscription is unchanged.</CrateOutcome>}
      {state === "error" && <CrateOutcome tone="error">Couldn&apos;t cancel. Please try again.</CrateOutcome>}
    </CrateCard>
  );
}
