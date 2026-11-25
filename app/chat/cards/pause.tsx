"use client";

import { money } from "@/lib/money";
import { formatLongDate } from "@/lib/date";
import { CrateCard, CrateFacts, CrateOutcome } from "./crate";
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
    <CrateCard testId="pause-card" title="Pause your subscription" state={state}>
      <CrateFacts
        rows={[
          [
            "Pauses",
            proposal.indefinite
              ? "from next week, until you resume it"
              : `from next week, for ${proposal.weeks} week${proposal.weeks === 1 ? "" : "s"}`,
          ],
          ["Resumes", proposal.indefinite ? "when you ask" : resume],
          ["While paused", `${fee} a week instead of your plan price`],
        ]}
      />

      <PromptActions
        state={state}
        confirmLabel="Yes, pause it"
        declineLabel="Not now"
        onConfirm={onConfirm}
        onDecline={onDecline}
      />
      {state === "approved" && (
        <CrateOutcome tone="done">
          Paused{proposal.indefinite ? " indefinitely" : `. Your boxes restart on ${resume}`} ({fee}/week while paused).
        </CrateOutcome>
      )}
      {state === "declined" && <CrateOutcome tone="neutral">No problem, your subscription is unchanged.</CrateOutcome>}
      {state === "error" && <CrateOutcome tone="error">Couldn&apos;t pause the subscription. Please try again.</CrateOutcome>}
    </CrateCard>
  );
}
