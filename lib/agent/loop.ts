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

/** tool name → SSE event for a needs_confirmation proposal. */
const PROPOSAL_EVENTS: Record<string, string> = {
  issue_refund: "refund_proposal",
  pause_subscription: "pause_proposal",
  reactivate_subscription: "reactivate_proposal",
  change_plan: "plan_change_proposal",
  cancel_subscription: "cancel_proposal",
};

/** Detects when the customer is clearly requesting an account action, so we can
 *  nudge the model to actually call the tool if it only described it (bug: the
 *  model sometimes answers "I'll do that…" without emitting the tool call). */
const ACTION_INTENT =
  /\b(re-?activat|resume|un-?pause|pause|cancel|refund|switch|change|plan|subscribe|sign-?up|restart)\b/i;

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
  const lastUserText = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  let nudged = false;
  const shownProposals = new Set<string>(); // dedupe duplicate confirmation cards

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

    if (toolCalls.length === 0) {
      // The model answered with text but didn't act. If the customer clearly
      // asked for an action, nudge it once to actually call the tool.
      if (!nudged && ACTION_INTENT.test(lastUserText)) {
        nudged = true;
        if (text) messages.push({ role: "assistant", content: text });
        messages.push({
          role: "system",
          content:
            "The customer asked you to perform an account action but no tool was called. Call the correct tool NOW to show the confirmation prompt — do not merely describe or promise it.",
        });
        continue;
      }
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

      const data = result.data as Record<string, unknown> | undefined;

      // KB search drives the citation chips.
      if (call.name === "search_knowledge_base" && result.ok && Array.isArray(data?.excerpts)) {
        const excerpts = data.excerpts as { slug: string; heading: string }[];
        emit("sources", excerpts.map((e) => ({ slug: e.slug, heading: e.heading })));
      }

      // needs_confirmation results surface their action-specific card — but only
      // once, even if the model calls the tool again (avoids duplicate cards).
      let duplicateProposal = false;
      if (result.ok && data?.status === "needs_confirmation" && PROPOSAL_EVENTS[call.name]) {
        if (shownProposals.has(call.name)) {
          duplicateProposal = true;
        } else {
          shownProposals.add(call.name);
          emit(PROPOSAL_EVENTS[call.name], data.proposal);
        }
      }

      // An explicit history request drives the transactions/orders card.
      if (call.name === "list_orders" && result.ok) {
        emit("history", data);
      }

      emit("tool_result", { name: call.name, ok: result.ok, summary: result.summary });

      // Message fed back to the model:
      //  - duplicate proposal → tell it the prompt is already shown, stop calling.
      //  - list_orders → withhold the order details (else it re-lists them in text).
      //  - otherwise → the tool's data.
      let modelContent: string;
      if (duplicateProposal) {
        modelContent = JSON.stringify({
          note: "The confirmation prompt is already shown to the customer. Do NOT call this tool again — just reply with a short sentence asking them to confirm.",
        });
      } else if (call.name === "list_orders") {
        modelContent = JSON.stringify({
          shown: true,
          note: "The order history has been shown to the customer in a card. Reply with only a short lead-in like 'Here's your order history:' and do NOT list the orders in text.",
        });
      } else {
        modelContent = JSON.stringify(result.data ?? { ok: result.ok, summary: result.summary });
      }

      messages.push({ role: "tool", toolCallId: call.id, content: modelContent });
    }
  }

  // Reached the iteration ceiling without a final answer.
  emit("delta", "\n\nI'm having trouble completing that — let me connect you with a human specialist.");
  emit("done", { truncated: true });
}
