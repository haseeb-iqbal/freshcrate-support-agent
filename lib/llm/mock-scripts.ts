import type { AgentStreamEvent } from "./types";

interface Script {
  pre_tool: AgentStreamEvent[]; // model's first turn (before any tool result)
  post_tool: AgentStreamEvent[]; // model's turn after a tool result exists
}

const t = (value: string): AgentStreamEvent => ({ type: "text", value });
const call = (name: string, args: object): AgentStreamEvent => ({
  type: "tool_calls",
  value: [{ id: "call_1", name, arguments: JSON.stringify(args) }],
});

/**
 * Keyed on the normalized latest user message. Order numbers match db/seed.ts.
 *
 * The four `lib/example-prompts.ts` suggestion chips must each have an entry, or
 * clicking one in MOCK_LLM demo mode answers "(mock) No script for this input".
 * Those four are written for Marcus Bell, who has a processing order, a shipped
 * order and two delivered ones. Fixture text must not state a delivery DATE:
 * seed dates are relative to seeding time, so a hard-coded one would rot.
 */
export const MOCK_SCRIPTS: Record<string, Script> = {
  "where's my latest order?": {
    pre_tool: [call("lookup_order", { position: 1 })],
    post_tool: [t("Your latest order, FC1004, is still processing. I'll let you know as soon as it ships.")],
  },
  "show me my order history": {
    pre_tool: [call("list_orders", {})],
    post_tool: [t("Here's your order history:")],
  },
  "my last box arrived damaged — i'd like a refund": {
    pre_tool: [call("issue_refund", { order_number: "FC1006", reason: "damaged box" })],
    post_tool: [t("I can refund that box — please confirm below to send it back to your original payment method.")],
  },
  "where's my 2nd last order": {
    pre_tool: [call("lookup_order", { position: 2 })],
    post_tool: [t("Your 2nd most recent order, FC1005, has shipped and is on its way.")],
  },
  "show my order history": {
    // Deliberate preamble text BEFORE the tool call — exercises the reset fix.
    pre_tool: [t("Sure, let me pull that up. "), call("list_orders", {})],
    post_tool: [t("Here's your order history:")],
  },
  "pause my subscription for 2 weeks": {
    pre_tool: [call("pause_subscription", { weeks: 2 })],
    post_tool: [t("I've set up a 2-week pause — confirm below to apply it.")],
  },
  "resume my subscription": {
    pre_tool: [call("resume_subscription", {})],
    post_tool: [t("Here's what resuming looks like — confirm below to restart your plan next week.")],
  },
  "switch me to the 4 meals/week plan": {
    pre_tool: [call("change_plan", { new_plan: "4 meals/week" })],
    post_tool: [t("Your subscription is paused, so I can resume you on the 4 meals/week plan at the same time — want me to do that?")],
  },
  "refund my last order, it was damaged": {
    pre_tool: [call("issue_refund", { order_number: "FC1020", reason: "damaged box" })],
    post_tool: [t("That refund is above what I can approve automatically, so I've escalated it to a specialist.")],
  },
  "refund my latest box, it arrived damaged": {
    pre_tool: [call("issue_refund", { order_number: "FC1015", reason: "damaged box" })],
    post_tool: [t("You've already had a refund in the last two weeks, so I've escalated this one to a specialist to review.")],
  },
  "refund my delivered box, it was damaged": {
    pre_tool: [call("issue_refund", { order_number: "FC1008", reason: "damaged box" })],
    post_tool: [t("I can refund that box — please confirm below to send it back to your original payment method.")],
  },
  "what's the capital of france?": {
    pre_tool: [t("I can only help with FreshCrate orders, subscriptions, and policies — anything about your account I can help with?")],
    post_tool: [],
  },
  "cancel my order": {
    pre_tool: [t("You have two open orders, FC1004 and FC1005 — which one would you like to cancel?")],
    post_tool: [],
  },
};

export function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
