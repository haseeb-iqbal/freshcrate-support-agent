"use client";

import { money } from "@/lib/money";
import { PromptActions, isPromptActive } from "./prompt-actions";
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
  return (
    <div data-testid="refund-card" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Refund request</p>
      <p className="mt-1 text-sm text-slate-800">
        This order can be refunded. Order <span className="font-mono text-xs">{proposal.order_number}</span>{" "}
        will be refunded <span className="font-semibold">{amount}</span> to {card}.
      </p>
      {proposal.items && proposal.items.length > 0 && (
        <p className="mt-1 text-[11px] text-slate-500">{proposal.items.join(" · ")}</p>
      )}
      <p className="mt-0.5 text-xs text-slate-500">Reason: {proposal.reason}</p>

      {isPromptActive(state) && (
        <>
          <p className="mt-2 text-sm text-slate-700">Do you wish to initiate the refund?</p>
          <PromptActions
            state={state}
            confirmLabel="Yes, refund my order"
            declineLabel="Not now"
            onConfirm={onConfirm}
            onDecline={onDecline}
          />
        </>
      )}
      {state === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">✓ Refund of {amount} initiated to {card}.</p>
      )}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — no refund was made.</p>}
      {state === "error" && (
        <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t process the refund — please try again.</p>
      )}
    </div>
  );
}
