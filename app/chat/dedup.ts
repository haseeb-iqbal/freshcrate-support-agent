import type { AnyProposal, Message, MessageProposals, ProposalKind, ProposalState } from "./types";

/**
 * Keep the model's re-proposals from stacking duplicate cards.
 *
 * gpt-4o-mini sometimes re-calls an action tool for a follow-up question ("what
 * do you mean after the pause is applied?") rather than answering in words. Each
 * call emits a fresh proposal event, and the client would otherwise append a
 * second identical card the customer never asked for. This module routes an
 * incoming proposal to the right card: an identical one still on screen is
 * re-used, and only a genuinely new request gets its own card.
 *
 * Kept free of the JSX card table (proposals.ts) so it can be unit-tested.
 */

/**
 * What makes two proposals of a kind "the same action" — the fields the customer
 * chose, not the derived amounts. Two pauses of the same length that resume on
 * the same day are one request; a different length is a different request.
 */
export function proposalIdentity(kind: ProposalKind, data: AnyProposal): string {
  switch (kind) {
    case "refund":
      return (data as { order_number: string }).order_number;
    case "pause": {
      const p = data as { indefinite: boolean; weeks: number | null; resume_date: string | null };
      return p.indefinite ? "indefinite" : `${p.weeks}:${p.resume_date}`;
    }
    case "resume":
    case "reactivate":
    case "plan":
      return (data as { plan: string }).plan;
    case "diet":
      return (data as { new_track: string }).new_track;
    case "cancel":
      return "cancel";
  }
}

/** A proposal in one of these states is still on screen and unresolved, so an
 *  identical re-proposal should re-use it rather than stack a duplicate card.
 *  `approved`/`declined` are decisions the customer already made, so asking for
 *  that action again is genuinely new and earns its own card. */
const ABSORBS_DUPLICATE: ProposalState[] = ["pending", "submitting", "locked", "error"];

/**
 * Route an incoming proposal. An identical proposal still on screen (see
 * ABSORBS_DUPLICATE) is re-activated in place — re-enabling a passed-over card
 * rather than duplicating it — while anything genuinely new appends to the
 * latest assistant message. A different length/plan/track has a different
 * identity, so a real change still gets its own card.
 */
export function reconcileIncomingProposal(
  messages: Message[],
  kind: ProposalKind,
  data: AnyProposal,
): Message[] {
  const id = proposalIdentity(kind, data);
  for (let i = messages.length - 1; i >= 0; i--) {
    const entries = messages[i].proposals?.[kind];
    if (!entries) continue;
    const idx = entries.findIndex(
      (e) => ABSORBS_DUPLICATE.includes(e.state) && proposalIdentity(kind, e.data) === id,
    );
    if (idx >= 0) {
      const next = entries.map((e, j) => (j === idx ? { ...e, state: "pending" as const, data } : e));
      return messages.map((m, mi) =>
        mi === i ? { ...m, proposals: { ...m.proposals, [kind]: next } as MessageProposals } : m,
      );
    }
  }
  const lastIdx = messages.length - 1;
  return messages.map((m, mi) => {
    if (mi !== lastIdx || m.role !== "assistant") return m;
    const existing = (m.proposals?.[kind] ?? []) as NonNullable<MessageProposals[typeof kind]>;
    return {
      ...m,
      proposals: { ...m.proposals, [kind]: [...existing, { data, state: "pending" }] } as MessageProposals,
    };
  });
}
