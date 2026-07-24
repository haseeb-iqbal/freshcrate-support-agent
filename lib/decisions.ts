/**
 * What the customer did with each confirmation prompt.
 *
 * The chat client already tracks a per-message proposal state, but never told
 * the server, so the next turn's model could not tell a refund the customer
 * confirmed from one they ignored. This module turns that client state into a
 * small enum-only payload, validates it on the way in, and renders it into the
 * sentence the model reads.
 *
 * Enum-only is the security-relevant part: there is no free-text field, so
 * nothing a browser sends can become an instruction to the model.
 */

export const DECISION_KINDS = [
  "refund",
  "pause",
  "resume",
  "reactivate",
  "plan_change",
  "cancel",
] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const DECISION_OUTCOMES = ["confirmed", "declined", "awaiting_response", "failed"] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export interface Decision {
  kind: DecisionKind;
  outcome: DecisionOutcome;
  /** Refunds only - the order the prompt was about. */
  orderNumber?: string;
}

/** Mirrors app/chat.tsx's ProposalState. lib/ must not import from app/. */
export type ProposalState = "pending" | "approved" | "declined" | "error";

/** Structural view of a chat message - only the fields decisions care about. */
export interface DecisionSource {
  proposal?: { order_number?: string };
  proposalState?: ProposalState;
  pauseProposal?: unknown;
  pauseState?: ProposalState;
  resumeProposal?: unknown;
  resumeState?: ProposalState;
  reactivateProposal?: unknown;
  reactivateState?: ProposalState;
  planProposal?: unknown;
  planState?: ProposalState;
  cancelProposal?: unknown;
  cancelState?: ProposalState;
}

const OUTCOME_OF: Record<ProposalState, DecisionOutcome> = {
  approved: "confirmed",
  declined: "declined",
  pending: "awaiting_response",
  error: "failed",
};

const MAX_DECISIONS = 20;
const ORDER_NUMBER = /^FC\d{1,12}$/;

/** Walk the transcript into one Decision per confirmation prompt shown. */
export function collectDecisions(messages: DecisionSource[]): Decision[] {
  const out: Decision[] = [];
  for (const m of messages) {
    if (m.proposal) {
      const d: Decision = { kind: "refund", outcome: OUTCOME_OF[m.proposalState ?? "pending"] };
      if (m.proposal.order_number) d.orderNumber = m.proposal.order_number;
      out.push(d);
    }
    if (m.pauseProposal) out.push({ kind: "pause", outcome: OUTCOME_OF[m.pauseState ?? "pending"] });
    if (m.resumeProposal) out.push({ kind: "resume", outcome: OUTCOME_OF[m.resumeState ?? "pending"] });
    if (m.reactivateProposal) {
      out.push({ kind: "reactivate", outcome: OUTCOME_OF[m.reactivateState ?? "pending"] });
    }
    if (m.planProposal) out.push({ kind: "plan_change", outcome: OUTCOME_OF[m.planState ?? "pending"] });
    if (m.cancelProposal) out.push({ kind: "cancel", outcome: OUTCOME_OF[m.cancelState ?? "pending"] });
  }
  return out;
}

/**
 * Validate a decisions payload from the browser.
 *
 * Rebuilds each entry from scratch rather than filtering in place, so unknown
 * keys cannot survive. Unknown kinds and outcomes drop the whole entry; a
 * malformed order number drops just that field.
 */
export function parseDecisions(raw: unknown): Decision[] {
  if (!Array.isArray(raw)) return [];
  const out: Decision[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { kind, outcome, orderNumber } = item as Record<string, unknown>;
    if (!DECISION_KINDS.includes(kind as DecisionKind)) continue;
    if (!DECISION_OUTCOMES.includes(outcome as DecisionOutcome)) continue;
    const decision: Decision = { kind: kind as DecisionKind, outcome: outcome as DecisionOutcome };
    if (typeof orderNumber === "string" && ORDER_NUMBER.test(orderNumber)) {
      decision.orderNumber = orderNumber;
    }
    out.push(decision);
    if (out.length >= MAX_DECISIONS) break;
  }
  return out;
}

const KIND_LABEL: Record<DecisionKind, string> = {
  refund: "a refund",
  pause: "a pause",
  resume: "a resume",
  reactivate: "a reactivation",
  plan_change: "a plan change",
  cancel: "a cancellation",
};

const OUTCOME_LABEL: Record<DecisionOutcome, string> = {
  confirmed: "the customer CONFIRMED it",
  declined: "the customer DECLINED it",
  awaiting_response: "still on screen, still unanswered",
  failed: "it FAILED to apply",
};

/** Render the decisions into the system note the model reads. Built here, on the
 *  server, from the validated enums - never from client text. */
export function describeDecisions(decisions: Decision[]): string {
  if (decisions.length === 0) return "";
  const parts = decisions.map((d) => {
    const what = d.kind === "refund" && d.orderNumber ? `a refund for ${d.orderNumber}` : KIND_LABEL[d.kind];
    return `${what} - ${OUTCOME_LABEL[d.outcome]}`;
  });
  return `Confirmation prompts already shown in this conversation: ${parts.join("; ")}.`;
}
