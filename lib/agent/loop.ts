import { now } from "@/lib/clock";
import type { Decision } from "@/lib/decisions";
import { getChatProvider } from "@/lib/llm";
import type { AgentMessage, ChatProvider, TokenUsage, ToolCall, ToolDefinition } from "@/lib/llm/types";
import { toolByName as realToolByName, toolDefinitions as realToolDefinitions, type Tool, type ToolResult } from "@/lib/tools";
import { buildAgentMessages } from "./messages";
import { buildSystemPrompt } from "./prompt";
import { dispatchTool, PROPOSAL_EVENTS, type DispatchState } from "./dispatch";
import { ORDER_CARD_TOOLS, shouldNudge, shouldNudgeOrderCard } from "./nudge";
import { isPureDecline } from "./decline";
import { isActionQuestion, isAddRequest, isCompanyTopicQuestion, mentionsDietaryTrack } from "./question";

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
  /** Wall-clock budget for the whole turn, in ms. Overridable in tests. */
  timeoutMs?: number;
}

const MAX_ITERATIONS = Number(process.env.MAX_LOOP_ITERATIONS ?? 6);

/** The model occasionally stalls mid-generation; cap the whole turn so a stuck
 *  request can never leave the customer watching a spinner forever. */
const DEFAULT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 45_000);

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
  let orderToolCallsMade = 0;
  const state: DispatchState = { shownProposals: new Set() };

  // A message that is ONLY a refusal ("no", "nah", "not now") of a prompt already
  // shown is a decline, never a request. gpt-4o-mini sometimes (re-)proposes the
  // action anyway; when it does this turn, we drop that proposal deterministically
  // rather than trust the model to read "nah" correctly (see the tool loop below).
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const declining = (decisions?.length ?? 0) > 0 && !!lastUser && isPureDecline(lastUser.content);

  // A question ABOUT an action ("how much does pausing cost?") is for the
  // knowledge base, not a request: drop any proposal made for it and make sure
  // the knowledge base was searched (see the tool loop and the nudge below).
  const askingAboutAction = !!lastUser && isActionQuestion(lastUser.content);
  // "can I add a Mango Lassi?" is a menu question too, but only when the model
  // answered it without calling any tool at all.
  // The same goes for a discount, storage or moving question the scope rule
  // makes the model wave off as out of scope without looking.
  const askingToAdd = !!lastUser && (isAddRequest(lastUser.content) || isCompanyTopicQuestion(lastUser.content));
  let searchedKb = false;
  let anyToolCalled = false;
  let kbNudged = false;
  // A track switch needs the conversation to be about a track or diet.
  const trackInPlay = mentionsDietaryTrack(history);

  // Orders whose refund the customer confirmed earlier in this conversation.
  const refundedThisChat = new Set(
    (decisions ?? []).filter((d) => d.kind === "refund" && d.outcome === "confirmed" && d.orderNumber).map((d) => d.orderNumber!),
  );

  // One deadline for the whole turn: if the model stalls, the signal aborts the
  // in-flight request and we fall to the catch below with a graceful message.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let anyStreamedText = false;
  // Tokens across every model call this turn, reported once as it ends (evals
  // price runs from it). Nothing is emitted when the provider reports none.
  const usage: TokenUsage = { promptTokens: 0, completionTokens: 0 };
  const finish = (data: Record<string, unknown>) => {
    if (usage.promptTokens || usage.completionTokens) emit("usage", usage);
    emit("done", data);
  };

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      let text = "";
      let toolCalls: ToolCall[] = [];
      let streamedText = false;

      for await (const ev of provider.streamAgentTurn({ messages, tools: definitions, signal: controller.signal })) {
        if (ev.type === "text") {
          text += ev.value;
          if (ev.value) {
            emit("delta", ev.value);
            streamedText = true;
            anyStreamedText = true;
          }
        } else if (ev.type === "tool_calls") {
          toolCalls = ev.value;
        } else {
          usage.promptTokens += ev.value.promptTokens;
          usage.completionTokens += ev.value.completionTokens;
        }
      }

      if (toolCalls.length === 0) {
        // A policy question needs the knowledge base, whatever else the model did.
        // It has its own flag so the generic nudge below can't use up the one retry.
        if (!kbNudged && !searchedKb && (askingAboutAction || (askingToAdd && !anyToolCalled))) {
          kbNudged = true;
          if (streamedText) emit("reset", {});
          if (text) messages.push({ role: "assistant", content: text });
          messages.push({
            role: "system",
            content:
              "The customer asked a question about FreshCrate's policy, fees or menu, not for an account action. Call search_knowledge_base now and answer only from the excerpts it returns. Do not answer from memory.",
          });
          continue;
        }
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
        if (shouldNudgeOrderCard({ assistantText: text, orderToolCallCount: orderToolCallsMade, alreadyNudged: nudged })) {
          nudged = true;
          if (streamedText) emit("reset", {});
          if (text) messages.push({ role: "assistant", content: text });
          messages.push({
            role: "system",
            content:
              "You introduced an order card but no tool was called, so nothing is shown. Call lookup_order now for one order (position 1 for the latest), or list_orders only if they asked to see their full history.",
          });
          continue;
        }
        finish({});
        return;
      }

      // A tool turn is never the final answer — clear any preamble it streamed.
      if (streamedText) emit("reset", {});
      anyToolCalled = true;
      messages.push({ role: "assistant", content: text, toolCalls });
      orderToolCallsMade += toolCalls.filter((c) => ORDER_CARD_TOOLS.has(c.name)).length;

      for (const call of toolCalls) {
        if (declining && PROPOSAL_EVENTS[call.name]) {
          // Customer's message was only a decline, yet the model tried to
          // (re-)propose. Skip it whole — no tool_call step, no card — and steer
          // the model to just acknowledge. A tool message keeps the transcript
          // valid without running the propose-only tool.
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: JSON.stringify({
              note: "The customer's last message was only a refusal, so they do NOT want this action - it has NOT been proposed or shown. Do not prepare, initiate, propose, or announce it. Reply with a brief, friendly acknowledgement (you've left things as they are) and offer further help.",
            }),
          });
          continue;
        }

        const notAnAction =
          PROPOSAL_EVENTS[call.name] &&
          (askingAboutAction
            ? "The customer asked a QUESTION about this action, not for the action itself, so it has NOT been proposed or shown. Call search_knowledge_base and answer their question in words from the excerpts."
            : call.name === "change_dietary_track" && !trackInPlay
              ? "The customer has not asked to change their dietary track, so no switch has been proposed or shown. Answer what they asked with search_knowledge_base. If they asked for a meal or add-on from another track, say it isn't on their own track's menu, name the track it belongs to, and offer to switch tracks if they want."
              : "");
        if (notAnAction) {
          messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify({ note: notAnAction }) });
          continue;
        }

        if (call.name === "search_knowledge_base") searchedKb = true;

        let args: Record<string, unknown> = {};
        try {
          args = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          // Malformed args — the handler will report the problem.
        }

        if (call.name === "issue_refund" && refundedThisChat.has(String(args.order_number ?? ""))) {
          // The customer already confirmed this order's refund in this chat, so
          // a further refund request ("another order") is about a different
          // one. gpt-4o-mini re-calls issue_refund for the same order, gets
          // already_refunded, and escalates; skip it and point it elsewhere.
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: JSON.stringify({
              note: `The refund for ${String(args.order_number)} was already confirmed earlier in this conversation, so the customer means a DIFFERENT order. Do not call issue_refund for ${String(args.order_number)} again and do not escalate. Find the other order with lookup_order, or ask which order they mean.`,
            }),
          });
          continue;
        }

        emit("tool_call", { name: call.name, args });

        const tool = registry[call.name];
        const result: ToolResult = tool
          ? await tool.handler({ customerId, now: turnNow, customerMessage: lastUser?.content }, args).catch((err) => ({
              ok: false,
              summary: `Tool error: ${err instanceof Error ? err.message : "unknown"}`,
            }))
          : { ok: false, summary: `Unknown tool: ${call.name}` };

        // An action call the tool redirected ("paused - use resume_subscription")
        // did not act, so it must not suppress the nudge either.
        if (PROPOSAL_EVENTS[call.name] && !(result.data as { redirect_to?: string } | undefined)?.redirect_to) {
          actionToolCallsMade++;
        }

        const { events, modelContent } = dispatchTool(call, result, state);
        for (const e of events) emit(e.event, e.data);
        messages.push({ role: "tool", toolCallId: call.id, content: modelContent });
      }
    }

    emit("delta", "\n\nI'm having trouble completing that — let me connect you with a human specialist.");
    finish({ truncated: true });
  } catch (err) {
    // The turn ran past its budget: abort the preamble and close on a calm note
    // rather than a spinner that never ends.
    if (controller.signal.aborted) {
      if (anyStreamedText) emit("reset", {});
      emit("delta", "Sorry — that's taking longer than usual on my end. Please try again in a moment.");
      finish({ timedOut: true });
      return;
    }
    throw err;
  } finally {
    clearTimeout(deadline);
  }
}
