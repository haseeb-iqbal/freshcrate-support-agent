import type { ToolCall } from "@/lib/llm/types";
import type { ToolResult } from "@/lib/tools/types";

/** tool name → SSE event for a needs_confirmation proposal. */
export const PROPOSAL_EVENTS: Record<string, string> = {
  issue_refund: "refund_proposal",
  pause_subscription: "pause_proposal",
  resume_subscription: "resume_proposal",
  reactivate_subscription: "reactivate_proposal",
  change_plan: "plan_change_proposal",
  cancel_subscription: "cancel_proposal",
};

export interface DispatchState {
  /** Idempotency keys of proposals already surfaced this turn (dedupes duplicate cards). */
  shownProposals: Set<string>;
}

/** Stable stringify — key order must not affect the idempotency key. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}

/**
 * Dedupe on tool name + arguments, not name alone: two refunds for two different
 * orders in one turn are distinct proposals and must BOTH reach the customer.
 */
function proposalKey(call: ToolCall): string {
  let args: unknown;
  try {
    args = call.arguments ? JSON.parse(call.arguments) : {};
  } catch {
    args = call.arguments; // unparseable — key off the raw string
  }
  return `${call.name}:${canonical(args)}`;
}

export interface EmitEvent {
  event: string;
  data: unknown;
}

export interface DispatchOutput {
  events: EmitEvent[];
  /** JSON string fed back to the model as the tool message content. */
  modelContent: string;
}

/**
 * Pure mapping from a tool result to (a) the SSE events the UI should receive and
 * (b) the content fed back to the model. Mutates only `state.shownProposals`.
 */
export function dispatchTool(call: ToolCall, result: ToolResult, state: DispatchState): DispatchOutput {
  const data = result.data as Record<string, unknown> | undefined;
  const events: EmitEvent[] = [];

  // KB search drives the citation chips.
  if (call.name === "search_knowledge_base" && result.ok && Array.isArray(data?.excerpts)) {
    const excerpts = data.excerpts as { slug: string; heading: string }[];
    events.push({ event: "sources", data: excerpts.map((e) => ({ slug: e.slug, heading: e.heading })) });
  }

  // needs_confirmation results surface an action card — but only once.
  let duplicateProposal = false;
  if (result.ok && data?.status === "needs_confirmation" && PROPOSAL_EVENTS[call.name]) {
    const key = proposalKey(call);
    if (state.shownProposals.has(key)) {
      duplicateProposal = true;
    } else {
      state.shownProposals.add(key);
      events.push({ event: PROPOSAL_EVENTS[call.name], data: data.proposal });
    }
  }

  // An explicit history request drives the orders/transactions card.
  if (call.name === "list_orders" && result.ok) {
    events.push({ event: "history", data });
  }

  events.push({ event: "tool_result", data: { name: call.name, ok: result.ok, summary: result.summary } });

  let modelContent: string;
  if (duplicateProposal) {
    modelContent = JSON.stringify({
      note: "This exact confirmation prompt is already shown to the customer. Do NOT repeat it — just reply with a short sentence asking them to confirm.",
    });
  } else if (call.name === "list_orders") {
    modelContent = JSON.stringify({
      shown: true,
      note: "The order history has been shown to the customer in a card. Reply with only a short lead-in like 'Here's your order history:' and do NOT list the orders in text.",
    });
  } else {
    modelContent = JSON.stringify(result.data ?? { ok: result.ok, summary: result.summary });
  }

  return { events, modelContent };
}
