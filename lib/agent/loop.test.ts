import { describe, expect, it } from "vitest";
import { runAgent, type AgentDeps } from "./loop";
import type { AgentStreamEvent, ChatProvider, ToolCall } from "@/lib/llm/types";
import type { Tool } from "@/lib/tools/types";

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

  it("does not nudge when the tool already ran and the final text describes it", async () => {
    const events: { event: string; data: unknown }[] = [];
    const deps: AgentDeps = {
      provider: fakeProvider([
        toolTurn("pause_subscription"),
        textTurn("I've paused your subscription — please confirm below."),
      ]),
      toolByName: okTool("pause_subscription", { status: "needs_confirmation", proposal: { weeks: 2 } }),
      toolDefinitions: [],
    };
    await runAgent({ customerId: "x", history: [{ role: "user", content: "pause my subscription" }], emit: (e, d) => events.push({ event: e, data: d }) }, deps);

    // The tool already ran — the closing sentence must not trigger a second round.
    expect(events.filter((e) => e.event === "tool_call").length).toBe(1);
    expect(events.some((e) => e.event === "reset")).toBe(false);
    expect(events.find((e) => e.event === "done")?.data).not.toMatchObject({ truncated: true });
  });

  it("does not nudge or reset a plain off-topic answer", async () => {
    const events: { event: string; data: unknown }[] = [];
    const deps: AgentDeps = { provider: fakeProvider([textTurn("I can only help with FreshCrate.")]), toolByName: {}, toolDefinitions: [] };
    await runAgent({ customerId: "x", history: [{ role: "user", content: "capital of France?" }], emit: (e, d) => events.push({ event: e, data: d }) }, deps);
    expect(events.some((e) => e.event === "reset")).toBe(false);
    expect(events.filter((e) => e.event === "delta").map((e) => e.data)).toEqual(["I can only help with FreshCrate."]);
  });

  it("terminates at the iteration ceiling", async () => {
    const events: { event: string; data: unknown }[] = [];
    const deps: AgentDeps = { provider: fakeProvider([toolTurn("lookup_order")]), toolByName: okTool("lookup_order", { order: {} }), toolDefinitions: [] };
    await runAgent({ customerId: "x", history: [{ role: "user", content: "hi" }], emit: (e, d) => events.push({ event: e, data: d }) }, deps);
    const done = events.find((e) => e.event === "done");
    expect(done?.data).toMatchObject({ truncated: true });
  });
});
