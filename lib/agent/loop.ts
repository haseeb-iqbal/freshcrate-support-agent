import { now } from "@/lib/clock";
import type { Decision } from "@/lib/decisions";
import { getChatProvider } from "@/lib/llm";
import type { AgentMessage, ChatProvider, ToolCall, ToolDefinition } from "@/lib/llm/types";
import { toolByName as realToolByName, toolDefinitions as realToolDefinitions, type Tool, type ToolResult } from "@/lib/tools";
import { buildAgentMessages } from "./messages";
import { buildSystemPrompt } from "./prompt";
import { dispatchTool, PROPOSAL_EVENTS, type DispatchState } from "./dispatch";
import { shouldNudge } from "./nudge";

export type AgentEmit = (event: string, data: unknown) => void;

export interface RunAgentOptions {
  customerId: string;
  customerLabel?: string;
  history: { role: "user" | "assistant"; content: string }[];
  /** What the customer did with any confirmation prompt already on screen. */
  decisions?: Decision[];
  emit: AgentEmit;
}

/** Injectable collaborators — real ones in production, fakes in tests. */
export interface AgentDeps {
  provider?: ChatProvider;
  toolByName?: Record<string, Tool>;
  toolDefinitions?: ToolDefinition[];
}

const MAX_ITERATIONS = Number(process.env.MAX_LOOP_ITERATIONS ?? 6);

/**
 * The agent loop: think → act → observe. Only the FINAL turn's text reaches the
 * user; any earlier turn that streamed text (because it made tool calls or is
 * about to be nudged) emits `reset` to clear that preamble.
 */
export async function runAgent(opts: RunAgentOptions, deps: AgentDeps = {}): Promise<void> {
  const { customerId, customerLabel, history, decisions, emit } = opts;
  const provider = deps.provider ?? getChatProvider();
  const registry = deps.toolByName ?? realToolByName;
  const definitions = deps.toolDefinitions ?? realToolDefinitions;

  // One timestamp for the whole turn, so tools can't disagree about the date.
  const turnNow = now();
  const base = buildSystemPrompt(turnNow);
  const system = customerLabel ? `${base}\n\nSigned-in customer: ${customerLabel}.` : base;
  const messages: AgentMessage[] = buildAgentMessages(system, history, decisions);

  let nudged = false;
  // Only action tools that surface a confirmation prompt suppress the nudge — a
  // read-only lookup must not (see shouldNudge). Counting every tool here let a
  // "looked up the order, then described a refund" turn escape the nudge.
  let actionToolCallsMade = 0;
  const state: DispatchState = { shownProposals: new Set() };

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let text = "";
    let toolCalls: ToolCall[] = [];
    let streamedText = false;

    for await (const ev of provider.streamAgentTurn({ messages, tools: definitions })) {
      if (ev.type === "text") {
        text += ev.value;
        if (ev.value) {
          emit("delta", ev.value);
          streamedText = true;
        }
      } else {
        toolCalls = ev.value;
      }
    }

    if (toolCalls.length === 0) {
      if (shouldNudge({ assistantText: text, actionToolCallCount: actionToolCallsMade, alreadyNudged: nudged })) {
        nudged = true;
        if (streamedText) emit("reset", {}); // discard the pre-nudge preamble
        if (text) messages.push({ role: "assistant", content: text });
        messages.push({
          role: "system",
          content:
            "The customer asked for an account action but no tool was called. Call the correct tool now to show the confirmation prompt — do not merely describe or promise it.",
        });
        continue;
      }
      emit("done", {});
      return;
    }

    // A tool turn is never the final answer — clear any preamble it streamed.
    if (streamedText) emit("reset", {});
    messages.push({ role: "assistant", content: text, toolCalls });
    actionToolCallsMade += toolCalls.filter((c) => PROPOSAL_EVENTS[c.name]).length;

    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        // Malformed args — the handler will report the problem.
      }
      emit("tool_call", { name: call.name, args });

      const tool = registry[call.name];
      const result: ToolResult = tool
        ? await tool.handler({ customerId, now: turnNow }, args).catch((err) => ({
            ok: false,
            summary: `Tool error: ${err instanceof Error ? err.message : "unknown"}`,
          }))
        : { ok: false, summary: `Unknown tool: ${call.name}` };

      const { events, modelContent } = dispatchTool(call, result, state);
      for (const e of events) emit(e.event, e.data);
      messages.push({ role: "tool", toolCallId: call.id, content: modelContent });
    }
  }

  emit("delta", "\n\nI'm having trouble completing that — let me connect you with a human specialist.");
  emit("done", { truncated: true });
}
