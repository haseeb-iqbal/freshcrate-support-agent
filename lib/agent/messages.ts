import { describeDecisions, type Decision } from "@/lib/decisions";
import type { AgentMessage } from "@/lib/llm/types";

/**
 * Assemble the working transcript: system prompt + prior user/assistant turns,
 * then a system note describing what the customer did with any confirmation
 * prompt already on screen.
 *
 * The note goes last, after the newest user turn: it describes the state of the
 * UI right now, and burying it behind older turns makes it easy to overlook.
 */
export function buildAgentMessages(
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
  decisions: Decision[] = [],
): AgentMessage[] {
  const messages: AgentMessage[] = [
    { role: "system", content: system },
    ...history.map((m): AgentMessage => ({ role: m.role, content: m.content })),
  ];
  const note = describeDecisions(decisions);
  if (note) messages.push({ role: "system", content: note });
  return messages;
}
