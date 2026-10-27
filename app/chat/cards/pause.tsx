"use client";

import { money } from "@/lib/money";
import { formatLongDate } from "@/lib/date";
import { PromptActions } from "./prompt-actions";
import type { PauseProposal, ProposalState } from "../types";

export function PauseCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: PauseProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const resume = formatLongDate(proposal.resume_date);
  const fee = money(proposal.weekly_fee_cents);
  return (
    <div data-testid="pause-card" className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Pause request</p>
      {proposal.indefinite ? (
        <p className="mt-1 text-sm text-slate-800">
          Pause your subscription <span className="font-semibold">indefinitely</span>? Your plan pauses from next week and stays paused until you resume it.
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-800">
          Pause your subscription for <span className="font-semibold">{proposal.weeks} week{proposal.weeks === 1 ? "" : "s"}</span>?
          Your plan pauses from next week and resumes on <span className="font-semibold">{resume}</span>.
        </p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        While paused, each week is billed at <span className="font-medium">{fee}/week</span> instead of your usual plan rate, until it resumes{proposal.indefinite ? "" : ` on ${resume}`}.
      </p>

      <PromptActions
        state={state}
        confirmLabel="Yes, pause it"
        declineLabel="Not now"
        onConfirm={onConfirm}
        onDecline={onDecline}
      />
      {state === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">
          ✓ Paused{proposal.indefinite ? " indefinitely" : ` — resumes ${resume}`} ({fee}/week while paused).
        </p>
      )}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — your subscription is unchanged.</p>}
      {state === "error" && (
        <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t pause the subscription — please try again.</p>
      )}
    </div>
  );
}
