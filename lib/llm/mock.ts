import type { AgentStreamEvent, AgentTurnOptions, ChatProvider } from "./types";
import { MOCK_SCRIPTS, normalize } from "./mock-scripts";

/** Deterministic provider for tests/E2E. Picks a scripted response by the latest
 *  user message and whether a tool result is already present in the transcript. */
export class MockChatProvider implements ChatProvider {
  readonly defaultModel = "mock";

  async *streamAgentTurn(opts: AgentTurnOptions): AsyncIterable<AgentStreamEvent> {
    const lastUser = [...opts.messages].reverse().find((m) => m.role === "user");
    const key = lastUser && typeof lastUser.content === "string" ? normalize(lastUser.content) : "";
    const script = MOCK_SCRIPTS[key];
    if (!script) {
      yield { type: "text", value: "(mock) No script for this input." };
      return;
    }
    const hasToolResult = opts.messages.some((m) => m.role === "tool");
    for (const ev of hasToolResult ? script.post_tool : script.pre_tool) {
      yield ev;
    }
  }
}
