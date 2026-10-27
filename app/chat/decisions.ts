import type { DecisionSource } from "@/lib/decisions";
import { PROPOSAL_KIND_TABLE, proposalEntries } from "./proposal-kinds";
import type { Message } from "./types";

/**
 * One DecisionSource per proposal entry on a message, named in the decisions
 * vocabulary (plan_change, dietary_track) by the kind table. lib/decisions is
 * server-side validation and must not import from app/, so the mapping lives
 * here at the boundary. Two refunds on one message yield two decisions.
 */
export function toDecisionSources(m: Message): DecisionSource[] {
  return proposalEntries(m.proposals).map(({ kind, entry }) => {
    const { decision, orderNumber } = PROPOSAL_KIND_TABLE[kind];
    const source: DecisionSource = { kind: decision, state: entry.state };
    const order = orderNumber?.(entry.data);
    if (order) source.orderNumber = order;
    return source;
  });
}
