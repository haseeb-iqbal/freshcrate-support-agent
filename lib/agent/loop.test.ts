import { describe, expect, it } from "vitest";
import { runAgent, type AgentDeps } from "./loop";
import type { AgentStreamEvent, ChatProvider, ToolCall } from "@/lib/llm/types";
import type { Tool } from "@/lib/tools/types";
import type { Decision } from "@/lib/decisions";

/** A provider that replays a fixed list of scripted turns. */
function fakeProvider(turns: AgentStreamEvent[][]): ChatProvider {
  let i = 0;
  return {
    defaultModel: "fake",
    async *streamAgentTurn() {
      const turn = turns[Math.min(i, turns.length - 1)];
      i++;
      for (const ev of turn) yield ev;
    },
  };
}

const textTurn = (s: string): AgentStreamEvent[] => [{ type: "text", value: s }];
const toolTurn = (name: string, text = ""): AgentStreamEvent[] => {
  const evs: AgentStreamEvent[] = [];
  if (text) evs.push({ type: "text", value: text });
  const tc: ToolCall = { id: "c1", name, arguments: "{}" };
  evs.push({ type: "tool_calls", value: [tc] });
  return evs;
};


/** A tool whose handler always rejects. */
const throwingTool = (name: string): Record<string, Tool> => ({
  [name]: {
    definition: { name, description: "", parameters: {} },
    handler: async () => {
      throw new Error("database exploded");
    },
  },
});

const okTool = (name: string, data: unknown): Record<string, Tool> => ({
  [name]: { definition: { name, description: "", parameters: {} }, handler: async () => ({ ok: true, summary: "ok", data }) },
});

describe("runAgent", () => {
  it("resets a tool turn's preamble so only the final text survives (no double text)", async () => {
    const events: { event: string; data: unknown }[] = [];
    const deps: AgentDeps = {
      provider: fakeProvider([toolTurn("lookup_order", "Let me check that. "), textTurn("Your order FC1005 has shipped.")]),
      toolByName: okTool("lookup_order", { order: { order_number: "FC1005" } }),
      toolDefinitions: [],
    };
    await runAgent({ customerId: "x", history: [{ role: "user", content: "where is my 2nd last order" }], emit: (e, d) => events.push({ event: e, data: d }) }, deps);

    const kinds = events.map((e) => e.event);
    expect(kinds).toContain("reset");
    const deltas = events.filter((e) => e.event === "delta").map((e) => e.data);
    // Preamble was streamed then reset; final answer is the last delta.
    expect(deltas.at(-1)).toBe("Your order FC1005 has shipped.");
    expect(kinds.filter((k) => k === "done").length).toBe(1);
  });

  it("reports the turn's token usage, summed across model calls, just before done", async () => {
    const events: { event: string; data: unknown }[] = [];
    const usage = (p: number, c: number): AgentStreamEvent => ({ type: "usage", value: { promptTokens: p, completionTokens: c } });
    const deps: AgentDeps = {
      provider: fakeProvider([[...toolTurn("lookup_order"), usage(1000, 20)], [...textTurn("It has shipped."), usage(1200, 10)]]),
      toolByName: okTool("lookup_order", { order: { order_number: "FC1005" } }),
      toolDefinitions: [],
    };
    await runAgent({ customerId: "x", history: [{ role: "user", content: "where is my order" }], emit: (e, d) => events.push({ event: e, data: d }) }, deps);

    expect(events.at(-2)).toEqual({ event: "usage", data: { promptTokens: 2200, completionTokens: 30 } });
    expect(events.at(-1)?.event).toBe("done");
  });

  it("shows the tool's fixed lead-in beside a card and drops the model's own text", async () => {
    // The model rewrote "Here's the pause - confirm below" into "I've initiated
    // your pause" before anything happened. On a card turn the customer now sees
    // only the tool's sentence; the model's text never streams.
    const events: { event: string; data: unknown }[] = [];
    const leadIn = "Here's a 2-week pause from next week. Confirm below to go ahead.";
    const deps: AgentDeps = {
      provider: fakeProvider([toolTurn("pause_subscription", "Sure! "), textTurn("I've initiated your pause, all done!")]),
      toolByName: okTool("pause_subscription", { status: "needs_confirmation", proposal: { weeks: 2 }, lead_in: leadIn }),
      toolDefinitions: [],
    };
    await runAgent({ customerId: "x", history: [{ role: "user", content: "pause my subscription for 2 weeks" }], emit: (e, d) => events.push({ event: e, data: d }) }, deps);

    const afterLastReset = events.slice(events.map((e) => e.event).lastIndexOf("reset") + 1);
    const visible = afterLastReset.filter((e) => e.event === "delta").map((e) => e.data).join("");
    expect(visible).toBe(leadIn);
    expect(events.some((e) => e.event === "delta" && String(e.data).includes("initiated"))).toBe(false);
    expect(events.some((e) => e.event === "pause_proposal")).toBe(true);
    expect(events.at(-1)?.event).toBe("done");
  });

  it("keeps the model's words when it re-proposes a card already on screen", async () => {
    // "That $40 fee is outrageous, waive it": the model re-called reactivate and
    // explained it can't waive the fee. The card is the one already shown, so
    // its fixed lead-in would hide the actual answer.
    const events: { event: string; data: unknown }[] = [];
    const deps: AgentDeps = {
      provider: fakeProvider([toolTurn("reactivate_subscription"), textTurn("I can't waive the sign-up fee, sorry.")]),
      toolByName: okTool("reactivate_subscription", { status: "needs_confirmation", proposal: { plan: "3 meals/week" }, lead_in: "Fixed lead-in." }),
      toolDefinitions: [],
    };
    await runAgent(
      {
        customerId: "x",
        history: [
          { role: "user", content: "reactivate on the 3 meals/week plan" },
          { role: "assistant", content: "Fixed lead-in." },
          { role: "user", content: "that $40 fee is outrageous, waive it" },
        ],
        decisions: [{ kind: "reactivate", outcome: "declined" }],
        emit: (e, d) => events.push({ event: e, data: d }),
      },
      deps,
    );

    expect(events.filter((e) => e.event === "delta").map((e) => e.data)).toEqual(["I can't waive the sign-up fee, sorry."]);
  });

  it("offers no action tools for a question about an action, and all of them for a request", async () => {
    // "how much does pausing cost?" once drew a pause call that the loop dropped,
    // and the model then talked about pausing instead of answering. With the
    // action tools withheld it can only search and answer.
    const defs = ["search_knowledge_base", "get_subscription", "pause_subscription", "issue_refund"].map((name) => ({ name, description: "", parameters: {} }));
    const offered = async (content: string) => {
      const seen: string[][] = [];
      const provider: ChatProvider = {
        defaultModel: "fake",
        async *streamAgentTurn({ tools }) {
          seen.push((tools ?? []).map((t) => t.name));
          yield { type: "text", value: "ok" };
        },
      };
      await runAgent({ customerId: "x", history: [{ role: "user", content }], emit: () => {} }, { provider, toolByName: {}, toolDefinitions: defs });
      return seen[0];
    };

    for (const q of ["how much does pausing cost?", "how do refunds work?", "how does pausing work?"]) {
      expect(await offered(q), q).toEqual(["search_knowledge_base", "get_subscription"]);
    }
    for (const r of ["pause my subscription for 2 weeks", "refund my order FC1008", "can you pause my subscription?"]) {
      expect(await offered(r), r).toEqual(["search_knowledge_base", "get_subscription", "pause_subscription", "issue_refund"]);
    }
  });

  it("tells the model which customer is signed in", async () => {
    let system = "";
    const provider: ChatProvider = {
      defaultModel: "fake",
      async *streamAgentTurn({ messages }) {
        system = messages[0].content as string;
        yield { type: "text", value: "Hi" };
      },
    };
    await runAgent(
      { customerId: "x", customerLabel: "Ava Chen (active, 2 meals/week)", history: [{ role: "user", content: "hi" }], emit: () => {} },
      { provider, toolByName: {}, toolDefinitions: [] },
    );
    expect(system).toContain("Signed-in customer: Ava Chen (active, 2 meals/week).");
  });

  it("nudges once when an action was requested but no tool was called", async () => {
    const events: { event: string; data: unknown }[] = [];
    const deps: AgentDeps = {
      provider: fakeProvider([textTurn("I'll pause that for you."), toolTurn("pause_subscription")]),
      toolByName: okTool("pause_subscription", { status: "needs_confirmation", proposal: { weeks: 2 } }),
      toolDefinitions: [],
    };
    await runAgent({ customerId: "x", history: [{ role: "user", content: "pause my subscription" }], emit: (e, d) => events.push({ event: e, data: d }) }, deps);

    // The pre-nudge text was reset, and the pause tool eventually ran.
    expect(events.some((e) => e.event === "reset")).toBe(true);
    expect(events.some((e) => e.event === "pause_proposal")).toBe(true);
  });

  it("terminates at the iteration ceiling", async () => {
    const events: { event: string; data: unknown }[] = [];
    const deps: AgentDeps = { provider: fakeProvider([toolTurn("lookup_order")]), toolByName: okTool("lookup_order", { order: {} }), toolDefinitions: [] };
    await runAgent({ customerId: "x", history: [{ role: "user", content: "hi" }], emit: (e, d) => events.push({ event: e, data: d }) }, deps);
    const done = events.find((e) => e.event === "done");
    expect(done?.data).toMatchObject({ truncated: true });
  });

  it("turns a rejecting tool handler into a failed tool result, not an unhandled rejection", async () => {
    const events: { event: string; data: unknown }[] = [];
    const deps: AgentDeps = {
      provider: fakeProvider([toolTurn("lookup_order"), textTurn("Something went wrong on my side.")]),
      toolByName: throwingTool("lookup_order"),
      toolDefinitions: [],
    };
    await runAgent({ customerId: "x", history: [{ role: "user", content: "where is my order" }], emit: (e, d) => events.push({ event: e, data: d }) }, deps);

    const result = events.find((e) => e.event === "tool_result");
    expect(result?.data).toMatchObject({ ok: false });
    expect((result?.data as { summary: string }).summary).toContain("database exploded");
    expect(events.filter((e) => e.event === "done")).toHaveLength(1);
  });

  it("drops a re-proposed action when the customer's message was only a decline", async () => {
    // The "nah" bug: a pause prompt was shown, the customer typed "nah", and the
    // model re-called pause_subscription. The guard skips it whole — no step, no
    // card — regardless of what the model does.
    const events: { event: string; data: unknown }[] = [];
    const declined: Decision[] = [{ kind: "pause", outcome: "declined" }];
    const deps: AgentDeps = {
      provider: fakeProvider([toolTurn("pause_subscription", "Sure — "), textTurn("No problem, I've left your subscription as it is.")]),
      toolByName: okTool("pause_subscription", { status: "needs_confirmation", proposal: { weeks: 3 } }),
      toolDefinitions: [],
    };
    await runAgent(
      {
        customerId: "x",
        history: [
          { role: "user", content: "pause my subscription for 3 weeks" },
          { role: "assistant", content: "Here's your pause request." },
          { role: "user", content: "nah" },
        ],
        decisions: declined,
        emit: (e, d) => events.push({ event: e, data: d }),
      },
      deps,
    );

    expect(events.some((e) => e.event === "pause_proposal")).toBe(false); // no card
    expect(events.some((e) => e.event === "tool_call")).toBe(false); // no "Preparing a pause" step
    expect(events.filter((e) => e.event === "delta").map((e) => e.data).at(-1)).toContain("left your subscription");
    expect(events.some((e) => e.event === "done")).toBe(true);
  });

  it("skips a refund for an order whose refund the customer already confirmed this conversation", async () => {
    // "I also want a refund for another order": gpt-4o-mini re-called
    // issue_refund for the order just refunded, got already_refunded, and
    // escalated - instead of finding the OTHER order.
    const events: { event: string; data: unknown }[] = [];
    const toolMessages: string[] = [];
    let i = 0;
    const turns = [
      [{ type: "tool_calls", value: [{ id: "c1", name: "issue_refund", arguments: '{"order_number":"FC1008"}' }] }],
      textTurn("Which other order would you like refunded?"),
    ] as AgentStreamEvent[][];
    const provider: ChatProvider = {
      defaultModel: "fake",
      async *streamAgentTurn({ messages }) {
        for (const m of messages) if (m.role === "tool") toolMessages.push(m.content);
        yield* turns[Math.min(i++, turns.length - 1)];
      },
    };
    let refundCalls = 0;
    const deps: AgentDeps = {
      provider,
      toolByName: {
        issue_refund: {
          definition: { name: "issue_refund", description: "", parameters: {} },
          handler: async () => {
            refundCalls++;
            return { ok: true, summary: "already refunded", data: { status: "already_refunded" } };
          },
        },
      },
      toolDefinitions: [],
    };
    await runAgent(
      {
        customerId: "x",
        history: [{ role: "user", content: "I also want a refund for another order" }],
        decisions: [{ kind: "refund", outcome: "confirmed", orderNumber: "FC1008" }],
        emit: (e, d) => events.push({ event: e, data: d }),
      },
      deps,
    );

    expect(refundCalls).toBe(0);
    expect(events.some((e) => e.event === "tool_call")).toBe(false);
    expect(toolMessages.join(" ")).toContain("FC1008");
    expect(toolMessages.join(" ")).toMatch(/different order/i);
  });

  it("ends a stalled turn with a graceful message instead of hanging", async () => {
    const events: { event: string; data: unknown }[] = [];
    // A provider that never yields and only settles once the deadline aborts it —
    // the stuck-in-thinking case.
    const stalling: ChatProvider = {
      defaultModel: "fake",
      async *streamAgentTurn(opts) {
        await new Promise<void>((_, reject) => {
          opts.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
        yield { type: "text", value: "unreachable" };
      },
    };
    await runAgent(
      { customerId: "x", history: [{ role: "user", content: "hi" }], emit: (e, d) => events.push({ event: e, data: d }) },
      { provider: stalling, toolByName: {}, toolDefinitions: [], timeoutMs: 20 },
    );

    const delta = events.filter((e) => e.event === "delta").map((e) => e.data).join("");
    expect(delta).toMatch(/taking longer|try again/i);
    expect(events.find((e) => e.event === "done")?.data).toMatchObject({ timedOut: true });
  });

});
