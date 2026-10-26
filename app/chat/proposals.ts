import type { ComponentType } from "react";
import { CancelCard, DietCard, PauseCard, PlanCard, ReactivateCard, RefundCard, ResumeCard } from "./cards";
import { PROPOSAL_KIND_TABLE } from "./proposal-kinds";
import type { AnyProposal, ProposalKind, ProposalPayloads, ProposalState } from "./types";

export {
  PROPOSAL_KINDS,
  appendProposal,
  lockPendingProposals,
  proposalKindForEvent,
  setProposalEntryState,
} from "./proposal-kinds";

/** Props every proposal card takes. Only RefundCard reads `paymentMethod`. */
export interface CardProps<P> {
  proposal: P;
  state: ProposalState;
  paymentMethod?: string | null;
  onConfirm: () => void;
  onDecline: () => void;
}

/** The card each proposal kind renders as. Everything else about a kind lives in proposal-kinds.ts. */
const CARDS: { [K in ProposalKind]: ComponentType<CardProps<ProposalPayloads[K]>> } = {
  refund: RefundCard,
  pause: PauseCard,
  resume: ResumeCard,
  reactivate: ReactivateCard,
  plan: PlanCard,
  cancel: CancelCard,
  diet: DietCard,
};

/** Each kind's descriptor with its card: how it arrives, renders, and is applied. */
export const PROPOSALS = Object.fromEntries(
  (Object.keys(PROPOSAL_KIND_TABLE) as ProposalKind[]).map((kind) => [
    kind,
    { ...PROPOSAL_KIND_TABLE[kind], card: CARDS[kind] as ComponentType<CardProps<AnyProposal>> },
  ]),
) as Record<ProposalKind, (typeof PROPOSAL_KIND_TABLE)[ProposalKind] & { card: ComponentType<CardProps<AnyProposal>> }>;
