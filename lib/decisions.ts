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
  "dietary_track",
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
export type ProposalState = "pending" | "submitting" | "locked" | "approved" | "declined" | "error";

/** One confirmation prompt the chat showed, and where it stands. */
export interface DecisionSource {
  kind: DecisionKind;
  state: ProposalState;
  /** Refunds only - the order the prompt was about. */
  orderNumber?: string;
}

const OUTCOME_OF: Record<ProposalState, DecisionOutcome> = {
  approved: "confirmed",
  declined: "declined",
  pending: "awaiting_response",
  // A write is in flight — from the model's point of view still unanswered.
  submitting: "awaiting_response",
  // The customer moved on to a new message without answering; treat as passed
  // over, so the model responds to the new message instead of pointing them back
  // at a prompt whose buttons are now disabled.
  locked: "declined",
  error: "failed",
};

const MAX_DECISIONS = 20;
const ORDER_NUMBER = /^FC\d{1,12}$/;

/** One Decision per confirmation prompt shown, its state translated to an outcome. */
export function collectDecisions(sources: DecisionSource[]): Decision[] {
  return sources.map(({ kind, state, orderNumber }) => {
    const d: Decision = { kind, outcome: OUTCOME_OF[state] };
    if (orderNumber) d.orderNumber = orderNumber;
    return d;
  });
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
  dietary_track: "a dietary-track switch",
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
  const note = `Confirmation prompts already shown in this conversation: ${parts.join("; ")}.`;
  // A model asked a question about an open prompt has said "I haven't started
  // that yet, shall I?" - the prompt is already on screen, so say so.
  return decisions.some((d) => d.outcome === "awaiting_response")
    ? `${note} A prompt that is still unanswered is ALREADY on the customer's screen waiting for their Confirm: never say the action has not been started and never offer to start it, whatever they ask next.`
    : note;
}
