import type { ComponentType } from "react";
import { CancelCard, DietCard, PauseCard, PlanCard, ReactivateCard, RefundCard, ResumeCard } from "./cards";
import type {
  AnyProposal,
  MessageProposals,
  ProposalEntry,
  ProposalKind,
  ProposalPayloads,
  ProposalState,
} from "./types";

/** Props every proposal card takes. Only RefundCard reads `paymentMethod`. */
export interface CardProps<P> {
  proposal: P;
  state: ProposalState;
  paymentMethod?: string | null;
  onConfirm: () => void;
  onDecline: () => void;
}

/** Everything one proposal kind needs: how it arrives, renders, and is applied. */
interface ProposalDescriptor<P> {
  /**
   * SSE event carrying this proposal. The server side of this contract is
   * PROPOSAL_EVENTS in lib/agent/dispatch.ts, which keys the same event names by
   * tool name - the two maps must stay in step.
   */
  event: string;
  card: ComponentType<CardProps<P>>;
  endpoint: string;
  /** POST body beyond `customerId`. */
  body: (proposal: P) => Record<string, unknown>;
  /** Whether confirming can change what the customer selector displays. */
  refreshesCustomers: boolean;
}

/**
 * Each entry is checked against its own payload type here; call sites only ever
 * know the kind as the union, so they get the erased view.
 */
function table(descriptors: { [K in ProposalKind]: ProposalDescriptor<ProposalPayloads[K]> }) {
  return descriptors as Record<ProposalKind, ProposalDescriptor<AnyProposal>>;
}

/** Declaration order is card render order. */
export const PROPOSALS = table({
  refund: {
    event: "refund_proposal",
    card: RefundCard,
    endpoint: "/api/actions/refund",
    body: (p) => ({ orderNumber: p.order_number, reason: p.reason }),
    // A refund cannot change the plan or status the selector shows.
    refreshesCustomers: false,
  },
  pause: {
    event: "pause_proposal",
    card: PauseCard,
    endpoint: "/api/actions/pause",
    body: (p) => ({ weeks: p.weeks, resumeDate: p.resume_date, indefinite: p.indefinite }),
    refreshesCustomers: true,
  },
  resume: {
    event: "resume_proposal",
    card: ResumeCard,
    endpoint: "/api/actions/resume",
    body: (p) => ({ newPlan: p.plan_changed ? p.plan : undefined }),
    refreshesCustomers: true,
  },
  reactivate: {
    event: "reactivate_proposal",
    card: ReactivateCard,
    endpoint: "/api/actions/reactivate",
    body: (p) => ({ newPlan: p.plan_changed ? p.plan : undefined }),
    refreshesCustomers: true,
  },
  plan: {
    event: "plan_change_proposal",
    card: PlanCard,
    endpoint: "/api/actions/change-plan",
    body: (p) => ({ plan: p.plan }),
    refreshesCustomers: true,
  },
  cancel: {
    event: "cancel_proposal",
    card: CancelCard,
    endpoint: "/api/actions/cancel",
    body: () => ({}),
    refreshesCustomers: true,
  },
  diet: {
    event: "diet_change_proposal",
    card: DietCard,
    endpoint: "/api/actions/dietary-track",
    body: (p) => ({ track: p.new_track }),
    refreshesCustomers: true,
  },
});

export const PROPOSAL_KINDS = Object.keys(PROPOSALS) as ProposalKind[];

const KIND_BY_EVENT = new Map(PROPOSAL_KINDS.map((kind) => [PROPOSALS[kind].event, kind]));

export function proposalKindForEvent(event: string): ProposalKind | undefined {
  return KIND_BY_EVENT.get(event);
}

/**
 * Append an entry to its kind's list, keeping earlier ones of that kind and
 * every other kind. Two proposals of the same kind in one turn both survive.
 * The cast re-asserts the kind → payload pairing a union-typed `kind` hides.
 */
export function appendProposal<K extends ProposalKind>(
  proposals: MessageProposals | undefined,
  kind: K,
  entry: ProposalEntry<K>,
): MessageProposals {
  const existing = (proposals?.[kind] ?? []) as ProposalEntry<K>[];
  return { ...proposals, [kind]: [...existing, entry] } as MessageProposals;
}

/** Replace the state of one entry, identified by kind and position in its list. */
export function setProposalEntryState(
  proposals: MessageProposals | undefined,
  kind: ProposalKind,
  entryIndex: number,
  state: ProposalState,
): MessageProposals {
  const existing = proposals?.[kind];
  if (!existing?.[entryIndex]) return proposals ?? {};
  const next = existing.map((e, i) => (i === entryIndex ? { ...e, state } : e));
  return { ...proposals, [kind]: next } as MessageProposals;
}
