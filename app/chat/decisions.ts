import type { DecisionSource } from "@/lib/decisions";
import type { Message } from "./types";

/**
 * Adapt a message's `proposals` map to the per-kind field shape lib/decisions
 * reads.
 *
 * The decisions module is server-side validation with its own vocabulary
 * (plan_change, dietary_track) and must not import from app/, so the mapping
 * between the two lives here at the boundary. It also bridges a shape mismatch:
 * the client groups proposals by kind into lists, while a DecisionSource carries
 * at most one proposal per kind - so a message becomes ONE DecisionSource per
 * entry, and two refunds on one message yield two decisions rather than one.
 */
export function toDecisionSources(m: Message): DecisionSource[] {
  const p = m.proposals;
  if (!p) return [];
  const out: DecisionSource[] = [];
  for (const e of p.refund ?? []) out.push({ proposal: { order_number: e.data.order_number }, proposalState: e.state });
  for (const e of p.pause ?? []) out.push({ pauseProposal: e.data, pauseState: e.state });
  for (const e of p.resume ?? []) out.push({ resumeProposal: e.data, resumeState: e.state });
  for (const e of p.reactivate ?? []) out.push({ reactivateProposal: e.data, reactivateState: e.state });
  for (const e of p.plan ?? []) out.push({ planProposal: e.data, planState: e.state });
  for (const e of p.cancel ?? []) out.push({ cancelProposal: e.data, cancelState: e.state });
  for (const e of p.diet ?? []) out.push({ dietProposal: e.data, dietState: e.state });
  return out;
}
