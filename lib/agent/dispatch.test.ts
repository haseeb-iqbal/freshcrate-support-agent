import { describe, expect, it } from "vitest";
import { dispatchTool, type DispatchState } from "./dispatch";
import type { ToolCall } from "@/lib/llm/types";
import type { ToolResult } from "@/lib/tools/types";

const call = (name: string, id = "c1"): ToolCall => ({ id, name, arguments: "{}" });
const freshState = (): DispatchState => ({ shownProposals: new Set() });

describe("dispatchTool", () => {
  it("emits sources for search_knowledge_base, then tool_result", () => {
    const result: ToolResult = {
      ok: true,
      summary: "2 hits",
      data: { excerpts: [{ slug: "pause-resume", heading: "How pausing works" }] },
    };
    const out = dispatchTool(call("search_knowledge_base"), result, freshState());
    expect(out.events[0].event).toBe("sources");
    expect(out.events.at(-1)?.event).toBe("tool_result");
  });

  it("emits a proposal event once and suppresses the duplicate", () => {
    const state = freshState();
    const result: ToolResult = {
      ok: true,
      summary: "proposed",
      data: { status: "needs_confirmation", proposal: { order_number: "FC1002" } },
    };
    const first = dispatchTool(call("issue_refund"), result, state);
    expect(first.events.some((e) => e.event === "refund_proposal")).toBe(true);

    const second = dispatchTool(call("issue_refund"), result, state);
    expect(second.events.some((e) => e.event === "refund_proposal")).toBe(false);
    expect(second.modelContent).toContain("already shown");
  });

  it("withholds order details for list_orders and emits history", () => {
    const result: ToolResult = { ok: true, summary: "3 orders", data: { orders: [], transactions: [] } };
    const out = dispatchTool(call("list_orders"), result, freshState());
    expect(out.events.some((e) => e.event === "history")).toBe(true);
    expect(out.modelContent).toContain("do NOT list the orders");
  });

  it("feeds back the raw data for a generic tool", () => {
    const result: ToolResult = { ok: true, summary: "ok", data: { status: "active", plan: "2 meals/week" } };
    const out = dispatchTool(call("get_subscription"), result, freshState());
    expect(JSON.parse(out.modelContent)).toEqual({ status: "active", plan: "2 meals/week" });
  });
});
