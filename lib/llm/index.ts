import { MockChatProvider } from "./mock";
import { OpenAIChatProvider } from "./openai";
import type { ChatProvider } from "./types";

let cached: ChatProvider | null = null;

/** Returns the active chat provider (singleton). MOCK_LLM=1 → deterministic mock. */
export function getChatProvider(): ChatProvider {
  if (!cached) cached = process.env.MOCK_LLM === "1" ? new MockChatProvider() : new OpenAIChatProvider();
  return cached;
}

export type * from "./types";
