import { describe, expect, it } from "vitest";
import { collectDecisions } from "@/lib/decisions";
import { toDecisionSources } from "./decisions";
import type { Message, MessageProposals, ProposalPayloads, ProposalState } from "./types";

/** A proposal entry whose payload is filled only where the adapter reads it. */
function entry<K extends keyof ProposalPayloads>(state: ProposalState, data: Partial<ProposalPayloads[K]> = {}) {
  return { data: data as ProposalPayloads[K], state };
}

function msg(proposals?: MessageProposals): Message {
  return { role: "assistant", content: "", proposals };
}

/** The exact chain app/chat.tsx runs before POSTing decisions to the server. */
const decisionsFor = (messages: Message[]) => collectDecisions(messages.flatMap(toDecisionSources));

describe("toDecisionSources", () => {
  it("maps a confirmed refund to a confirmed decision carrying its order number", () => {
    const out = decisionsFor([msg({ refund: [entry<"refund">("approved", { order_number: "FC1001" })] })]);
    expect(out).toEqual([{ kind: "refund", outcome: "confirmed", orderNumber: "FC1001" }]);
  });

  it("translates each state to its outcome", () => {
    expect(decisionsFor([msg({ pause: [entry<"pause">("declined")] })])).toEqual([{ kind: "pause", outcome: "declined" }]);
    expect(decisionsFor([msg({ resume: [entry<"resume">("pending")] })])).toEqual([{ kind: "resume", outcome: "awaiting_response" }]);
    expect(decisionsFor([msg({ cancel: [entry<"cancel">("error")] })])).toEqual([{ kind: "cancel", outcome: "failed" }]);
  });

  it("maps the client kind names to the decisions vocabulary", () => {
    expect(decisionsFor([msg({ plan: [entry<"plan">("approved")] })])[0].kind).toBe("plan_change");
    expect(decisionsFor([msg({ diet: [entry<"diet">("approved")] })])[0].kind).toBe("dietary_track");
  });

  it("emits one decision per entry when a turn proposes the same kind twice", () => {
    // The whole point of issue 1: two refunds for two orders must BOTH survive
    // the round-trip, not collapse to one.
    const out = decisionsFor([
      msg({
        refund: [
          entry<"refund">("approved", { order_number: "FC1001" }),
          entry<"refund">("declined", { order_number: "FC1002" }),
        ],
      }),
    ]);
    expect(out).toEqual([
      { kind: "refund", outcome: "confirmed", orderNumber: "FC1001" },
      { kind: "refund", outcome: "declined", orderNumber: "FC1002" },
    ]);
  });

  it("carries decisions across several messages and mixed kinds", () => {
    const out = decisionsFor([
      msg({ refund: [entry<"refund">("approved", { order_number: "FC1001" })] }),
      msg(),
      msg({ pause: [entry<"pause">("declined")], diet: [entry<"diet">("pending")] }),
    ]);
    expect(out).toEqual([
      { kind: "refund", outcome: "confirmed", orderNumber: "FC1001" },
      { kind: "pause", outcome: "declined" },
      { kind: "dietary_track", outcome: "awaiting_response" },
    ]);
  });

  it("yields nothing for messages without proposals", () => {
    expect(decisionsFor([msg(), { role: "user", content: "hi" }])).toEqual([]);
  });
});
