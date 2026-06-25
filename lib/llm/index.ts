import { OpenAIChatProvider } from "./openai";
import type { ChatProvider } from "./types";

let cached: ChatProvider | null = null;

/** Returns the active chat provider (singleton). */
export function getChatProvider(): ChatProvider {
  if (!cached) cached = new OpenAIChatProvider();
  return cached;
}

export type { ChatProvider, ChatMessage, ChatRole, ChatStreamOptions } from "./types";
