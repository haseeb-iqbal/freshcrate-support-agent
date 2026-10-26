import type { DecisionKind } from "@/lib/decisions";
import type { AnyProposal, MessageProposals, ProposalEntry, ProposalKind, ProposalPayloads, ProposalState } from "./types";

/**
 * Everything the chat client knows about a proposal kind except how it renders:
 * how it arrives, how it is applied, how the server's decisions log names it,
 * and what makes two proposals of it the same request. Adding a card kind is
 * one entry here plus its card in proposals.ts.
 *
 * Kept free of the JSX card table so the logic that reads it (dedup, the
 * decisions adapter, locking) stays unit-testable.
 */
interface KindDescriptor<P> {
  /**
   * SSE event carrying this proposal. The server side of this contract is
   * PROPOSAL_EVENTS in lib/agent/dispatch.ts, which keys the same event names by
   * tool name - the two maps must stay in step.
   */
  event: string;
  endpoint: string;
  /** POST body beyond `customerId`. */
  body: (proposal: P) => Record<string, unknown>;
  /** Whether confirming can change what the customer selector displays. */
  refreshesCustomers: boolean;
  /** The name lib/decisions gives this kind in the decisions payload. */
  decision: DecisionKind;
  /**
   * What makes two proposals of this kind "the same action" - the fields the
   * customer chose, not the derived amounts. Two pauses of the same length that
   * resume on the same day are one request; a different length is another.
   */
  identity: (proposal: P) => string;
  /** The order the decision is about, for kinds tied to one order. */
  orderNumber?: (proposal: P) => string | undefined;
}

/**
 * Each entry is checked against its own payload type here; call sites only ever
 * know the kind as the union, so they get the erased view.
 */
function table(descriptors: { [K in ProposalKind]: KindDescriptor<ProposalPayloads[K]> }) {
  return descriptors as Record<ProposalKind, KindDescriptor<AnyProposal>>;
}

/** Declaration order is card render order. */
export const PROPOSAL_KIND_TABLE = table({
  refund: {
    event: "refund_proposal",
    endpoint: "/api/actions/refund",
    body: (p) => ({ orderNumber: p.order_number, reason: p.reason }),
    // A refund cannot change the plan or status the selector shows.
    refreshesCustomers: false,
    decision: "refund",
    identity: (p) => p.order_number,
    orderNumber: (p) => p.order_number,
  },
  pause: {
    event: "pause_proposal",
    endpoint: "/api/actions/pause",
    body: (p) => ({ weeks: p.weeks, resumeDate: p.resume_date, indefinite: p.indefinite }),
    refreshesCustomers: true,
    decision: "pause",
    identity: (p) => (p.indefinite ? "indefinite" : `${p.weeks}:${p.resume_date}`),
  },
  resume: {
    event: "resume_proposal",
    endpoint: "/api/actions/resume",
    body: (p) => ({ newPlan: p.plan_changed ? p.plan : undefined }),
    refreshesCustomers: true,
    decision: "resume",
    identity: (p) => p.plan,
  },
  reactivate: {
    event: "reactivate_proposal",
    endpoint: "/api/actions/reactivate",
    body: (p) => ({ newPlan: p.plan_changed ? p.plan : undefined }),
    refreshesCustomers: true,
    decision: "reactivate",
    identity: (p) => p.plan,
  },
  plan: {
    event: "plan_change_proposal",
    endpoint: "/api/actions/change-plan",
    body: (p) => ({ plan: p.plan }),
    refreshesCustomers: true,
    decision: "plan_change",
    identity: (p) => p.plan,
  },
  cancel: {
    event: "cancel_proposal",
    endpoint: "/api/actions/cancel",
    body: () => ({}),
    refreshesCustomers: true,
    decision: "cancel",
    identity: () => "cancel",
  },
  diet: {
    event: "diet_change_proposal",
    endpoint: "/api/actions/dietary-track",
    body: (p) => ({ track: p.new_track }),
    refreshesCustomers: true,
    decision: "dietary_track",
    identity: (p) => p.new_track,
  },
});

export const PROPOSAL_KINDS = Object.keys(PROPOSAL_KIND_TABLE) as ProposalKind[];

const KIND_BY_EVENT = new Map(PROPOSAL_KINDS.map((kind) => [PROPOSAL_KIND_TABLE[kind].event, kind]));

export function proposalKindForEvent(event: string): ProposalKind | undefined {
  return KIND_BY_EVENT.get(event);
}

/** Every entry on a message, each with its kind - the one walk over the per-kind lists. */
export function proposalEntries(proposals: MessageProposals | undefined): { kind: ProposalKind; entry: ProposalEntry }[] {
  if (!proposals) return [];
  return PROPOSAL_KINDS.flatMap((kind) => (proposals[kind] ?? []).map((entry) => ({ kind, entry: entry as ProposalEntry })));
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

/**
 * Lock every still-pending prompt in a message: the customer sent a new message
 * without answering, so those prompts are no longer actionable (their buttons
 * disable). Returns the same reference when nothing was pending, so callers can
 * skip a needless re-render. Only `pending` is affected — a `submitting` write
 * in flight or an already-resolved prompt is left as-is.
 */
export function lockPendingProposals(proposals: MessageProposals | undefined): MessageProposals | undefined {
  if (!proposals) return proposals;
  let next = proposals;
  for (const kind of PROPOSAL_KINDS) {
    const entries = proposals[kind];
    if (!entries?.some((e) => e.state === "pending")) continue;
    const locked = entries.map((e) => (e.state === "pending" ? { ...e, state: "locked" as const } : e));
    next = { ...next, [kind]: locked } as MessageProposals;
  }
  return next;
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
