import { getChatProvider } from "../llm";
import type { AgentMessage, ToolCall } from "../llm/types";
import { toolByName, toolDefinitions, type ToolResult } from "../tools";
import { AGENT_SYSTEM_PROMPT } from "./system-prompt";

/** Events the loop emits to the transport (SSE route). */
export type AgentEmit = (event: string, data: unknown) => void;

export interface RunAgentOptions {
  /** Trusted signed-in customer id (tools are bound to this, not model input). */
  customerId: string;
  /** Human label for the signed-in customer, e.g. "Ava Chen (active, 2 meals/week)". */
  customerLabel?: string;
  /** Prior conversation (user/assistant text only). */
  history: { role: "user" | "assistant"; content: string }[];
  emit: AgentEmit;
}

const MAX_ITERATIONS = Number(process.env.MAX_LOOP_ITERATIONS ?? 6);

/**
 * The agent loop: think → act → observe.
 *
 * Each iteration the model either writes a final answer (loop ends) or requests
 * tool calls. We run those tools (scoped to the customer), feed the results
 * back as tool messages, and loop so the model can reason over them. A hard
 * iteration ceiling guarantees termination and caps cost.
 */
export async function runAgent({
  customerId,
  customerLabel,
  history,
  emit,
}: RunAgentOptions): Promise<void> {
  const provider = getChatProvider();
  const system = customerLabel
    ? `${AGENT_SYSTEM_PROMPT}\n\nSigned-in customer: ${customerLabel}.`
    : AGENT_SYSTEM_PROMPT;

  const messages: AgentMessage[] = [
    { role: "system", content: system },
    ...history.map((m): AgentMessage => ({ role: m.role, content: m.content })),
  ];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let text = "";
    let toolCalls: ToolCall[] = [];

    // THINK: stream the model's turn — text goes to the user, tool calls collect.
    for await (const ev of provider.streamAgentTurn({ messages, tools: toolDefinitions })) {
      if (ev.type === "text") {
        text += ev.value;
        emit("delta", ev.value);
      } else {
        toolCalls = ev.value;
      }
    }

    // No tool calls → the model answered. Done.
    if (toolCalls.length === 0) {
      emit("done", {});
      return;
    }

    // Record the assistant's tool-call turn before running the tools.
    messages.push({ role: "assistant", content: text, toolCalls });

    // ACT + OBSERVE: run each tool, scoped to the customer, feed results back.
    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        // Malformed args — leave empty; the handler will report the problem.
      }
      emit("tool_call", { name: call.name, args });

      const tool = toolByName[call.name];
      const result: ToolResult = tool
        ? await tool.handler({ customerId }, args).catch((err) => ({
            ok: false,
            summary: `Tool error: ${err instanceof Error ? err.message : "unknown"}`,
          }))
        : { ok: false, summary: `Unknown tool: ${call.name}` };

      // KB search drives the citation chips in the UI.
      if (
        call.name === "search_knowledge_base" &&
        result.ok &&
        result.data &&
        Array.isArray((result.data as { excerpts?: unknown[] }).excerpts)
      ) {
        const excerpts = (result.data as { excerpts: { slug: string; heading: string }[] }).excerpts;
        emit("sources", excerpts.map((e) => ({ slug: e.slug, heading: e.heading })));
      }

      // A refund proposal surfaces a confirmation card; the actual write happens
      // only when the customer approves it (human-in-the-loop, Phase 4).
      if (
        call.name === "issue_refund" &&
        result.ok &&
        (result.data as { status?: string } | undefined)?.status === "needs_confirmation"
      ) {
        emit("refund_proposal", (result.data as { proposal: unknown }).proposal);
      }

      // A pause proposal surfaces a confirmation prompt (with resume date + fee).
      if (
        call.name === "pause_subscription" &&
        result.ok &&
        (result.data as { status?: string } | undefined)?.status === "needs_confirmation"
      ) {
        emit("pause_proposal", (result.data as { proposal: unknown }).proposal);
      }

      // Reactivate / plan-change proposals each surface their own card.
      if (
        call.name === "reactivate_subscription" &&
        result.ok &&
        (result.data as { status?: string } | undefined)?.status === "needs_confirmation"
      ) {
        emit("reactivate_proposal", (result.data as { proposal: unknown }).proposal);
      }
      if (
        call.name === "change_plan" &&
        result.ok &&
        (result.data as { status?: string } | undefined)?.status === "needs_confirmation"
      ) {
        emit("plan_change_proposal", (result.data as { proposal: unknown }).proposal);
      }

      // Only an explicit history request (list_orders) drives the orders card.
      if (
        call.name === "list_orders" &&
        result.ok &&
        Array.isArray((result.data as { orders?: unknown[] } | undefined)?.orders)
      ) {
        emit("orders", (result.data as { orders: unknown[] }).orders);
      }

      // Cancellation proposal surfaces its own confirmation card.
      if (
        call.name === "cancel_subscription" &&
        result.ok &&
        (result.data as { status?: string } | undefined)?.status === "needs_confirmation"
      ) {
        emit("cancel_proposal", (result.data as { proposal: unknown }).proposal);
      }

      emit("tool_result", { name: call.name, ok: result.ok, summary: result.summary });

      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify(result.data ?? { ok: result.ok, summary: result.summary }),
      });
    }
  }

  // Reached the iteration ceiling without a final answer.
  emit("delta", "\n\nI'm having trouble completing that — let me connect you with a human specialist.");
  emit("done", { truncated: true });
}
