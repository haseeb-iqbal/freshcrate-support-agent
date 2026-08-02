import { describe, expect, it } from "vitest";
import { proposalIdentity, reconcileIncomingProposal } from "./dedup";
import type { AnyProposal, Message, PauseProposal, ProposalState } from "./types";

/** A pause payload carrying only the fields identity/rendering read. */
function pause(weeks: number | null, resume: string | null, indefinite = false): AnyProposal {
  return { indefinite, weeks, resume_date: resume } as PauseProposal;
}

/** An assistant message holding one pause entry in a given state. */
function withPause(data: AnyProposal, state: ProposalState): Message {
  return { role: "assistant", content: "", proposals: { pause: [{ data: data as PauseProposal, state }] } };
}

const userTurn: Message = { role: "user", content: "..." };
const emptyAssistant: Message = { role: "assistant", content: "" };

describe("proposalIdentity", () => {
  it("keys a finite pause on its length and resume date, not derived amounts", () => {
    expect(proposalIdentity("pause", pause(2, "2026-08-16"))).toBe(proposalIdentity("pause", pause(2, "2026-08-16")));
    expect(proposalIdentity("pause", pause(2, "2026-08-16"))).not.toBe(proposalIdentity("pause", pause(3, "2026-08-23")));
  });

  it("keys every indefinite pause the same regardless of week fields", () => {
    expect(proposalIdentity("pause", pause(null, null, true))).toBe("indefinite");
  });
});

describe("reconcileIncomingProposal", () => {
  it("appends a proposal to the latest assistant message when none is on screen", () => {
    const out = reconcileIncomingProposal([userTurn, emptyAssistant], "pause", pause(2, "2026-08-16"));
    expect(out[1].proposals?.pause).toHaveLength(1);
    expect(out[1].proposals?.pause?.[0].state).toBe("pending");
  });

  it("does NOT stack a second card for an identical pause still pending on screen", () => {
    const messages: Message[] = [withPause(pause(2, "2026-08-16"), "pending"), userTurn, emptyAssistant];
    const out = reconcileIncomingProposal(messages, "pause", pause(2, "2026-08-16"));
    // The existing card is re-used; the fresh assistant turn gets no duplicate.
    expect(out[0].proposals?.pause).toHaveLength(1);
    expect(out[2].proposals?.pause ?? []).toHaveLength(0);
  });

  it("re-activates a passed-over (locked) identical pause instead of duplicating it", () => {
    const messages: Message[] = [withPause(pause(2, "2026-08-16"), "locked"), userTurn, emptyAssistant];
    const out = reconcileIncomingProposal(messages, "pause", pause(2, "2026-08-16"));
    expect(out[0].proposals?.pause?.[0].state).toBe("pending");
    expect(out[2].proposals?.pause ?? []).toHaveLength(0);
  });

  it("gives a genuinely different pause (new length) its own card", () => {
    const messages: Message[] = [withPause(pause(2, "2026-08-16"), "locked"), userTurn, emptyAssistant];
    const out = reconcileIncomingProposal(messages, "pause", pause(4, "2026-08-30"));
    expect(out[0].proposals?.pause?.[0].state).toBe("locked"); // untouched
    expect(out[2].proposals?.pause).toHaveLength(1);
  });

  it("shows a fresh card when the customer explicitly declined the identical pause", () => {
    // Declining is a decision, not a passed-over prompt: asking again is new.
    const messages: Message[] = [withPause(pause(2, "2026-08-16"), "declined"), userTurn, emptyAssistant];
    const out = reconcileIncomingProposal(messages, "pause", pause(2, "2026-08-16"));
    expect(out[0].proposals?.pause?.[0].state).toBe("declined");
    expect(out[2].proposals?.pause).toHaveLength(1);
  });
});
