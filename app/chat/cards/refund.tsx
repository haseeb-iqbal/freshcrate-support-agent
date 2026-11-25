"use client";

import { money } from "@/lib/money";
import { CrateCard, CrateFacts, CrateOutcome } from "./crate";
import { PromptActions } from "./prompt-actions";
import type { ProposalState, RefundProposal } from "../types";

export function RefundCard({
  proposal,
  state,
  paymentMethod,
  onConfirm,
  onDecline,
}: {
  proposal: RefundProposal;
  state: ProposalState;
  paymentMethod?: string | null;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const amount = money(proposal.amount_cents);
  const card = paymentMethod ?? "your card on file";
  const rows: [string, string][] = [["Order", proposal.order_number]];
  if (proposal.items && proposal.items.length > 0) rows.push(["Meal", proposal.items.join(", ")]);
  rows.push(["Refund", `${amount} to ${card}`], ["Reason", proposal.reason]);
  return (
    <CrateCard testId="refund-card" title="Refund this order" state={state}>
      <CrateFacts rows={rows} />

      <PromptActions
        state={state}
        confirmLabel="Yes, refund my order"
        declineLabel="Not now"
        onConfirm={onConfirm}
        onDecline={onDecline}
      />
      {state === "approved" && (
        <CrateOutcome tone="done">
          Refund of {amount} initiated to {card}.
        </CrateOutcome>
      )}
      {state === "declined" && <CrateOutcome tone="neutral">No problem, no refund was made.</CrateOutcome>}
      {state === "error" && <CrateOutcome tone="error">Couldn&apos;t process the refund. Please try again.</CrateOutcome>}
    </CrateCard>
  );
}
