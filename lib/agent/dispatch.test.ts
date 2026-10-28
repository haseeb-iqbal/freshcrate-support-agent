import { describe, expect, it } from "vitest";
import { dispatchTool, type DispatchState } from "./dispatch";
import type { ToolCall } from "@/lib/llm/types";
import type { ToolResult } from "@/lib/tools/types";

const call = (name: string, id = "c1", args = "{}"): ToolCall => ({ id, name, arguments: args });
const freshState = (): DispatchState => ({ shownProposals: new Set() });

describe("dispatchTool", () => {

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

  it("surfaces two proposals of the same tool when their arguments differ", () => {
    const state = freshState();
    const proposalFor = (orderNumber: string): ToolResult => ({
      ok: true,
      summary: "proposed",
      data: { status: "needs_confirmation", proposal: { order_number: orderNumber } },
    });

    const first = dispatchTool(
      call("issue_refund", "c1", JSON.stringify({ order_number: "FC1002" })),
      proposalFor("FC1002"),
      state,
    );
    const second = dispatchTool(
      call("issue_refund", "c2", JSON.stringify({ order_number: "FC1007" })),
      proposalFor("FC1007"),
      state,
    );

    expect(first.events.some((e) => e.event === "refund_proposal")).toBe(true);
    expect(second.events.some((e) => e.event === "refund_proposal")).toBe(true);
  });

  it("withholds order details for list_orders and emits history", () => {
    const result: ToolResult = { ok: true, summary: "3 orders", data: { orders: [], transactions: [] } };
    const out = dispatchTool(call("list_orders"), result, freshState());
    expect(out.events.some((e) => e.event === "history")).toBe(true);
    expect(out.modelContent).toContain("do NOT list the orders");
  });

});
