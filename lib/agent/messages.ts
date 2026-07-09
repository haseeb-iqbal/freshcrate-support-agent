import type { AgentMessage } from "@/lib/llm/types";

/** Assemble the working transcript: system prompt + prior user/assistant turns. */
export function buildAgentMessages(
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
): AgentMessage[] {
  return [
    { role: "system", content: system },
    ...history.map((m): AgentMessage => ({ role: m.role, content: m.content })),
  ];
}
