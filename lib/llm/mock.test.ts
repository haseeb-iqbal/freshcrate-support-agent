import { describe, expect, it } from "vitest";
import { MockChatProvider } from "./mock";
import type { AgentMessage, AgentStreamEvent } from "./types";

async function collect(it: AsyncIterable<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const out: AgentStreamEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

const sys: AgentMessage = { role: "system", content: "" };
const user = (content: string): AgentMessage => ({ role: "user", content });

describe("MockChatProvider", () => {
  const p = new MockChatProvider();

  it("returns the pre_tool script (a tool call) on the first pass", async () => {
    const evs = await collect(p.streamAgentTurn({ messages: [sys, user("show my order history")] }));
    expect(evs.some((e) => e.type === "tool_calls")).toBe(true);
  });

  it("returns the post_tool script (final text) once a tool result exists", async () => {
    const evs = await collect(
      p.streamAgentTurn({
        messages: [sys, user("show my order history"), { role: "assistant", content: "" }, { role: "tool", toolCallId: "call_1", content: "{}" }],
      }),
    );
    expect(evs).toEqual([{ type: "text", value: "Here's your order history:" }]);
  });
});
