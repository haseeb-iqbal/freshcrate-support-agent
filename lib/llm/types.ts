// Swappable chat-provider interface. The app depends on this, not on OpenAI
// directly, so the model backend (and later, the router) can change in one place.

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatStreamOptions {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatProvider {
  /** Model used when a request doesn't specify one. */
  readonly defaultModel: string;
  /** Stream a completion as a sequence of text deltas. */
  streamChat(opts: ChatStreamOptions): AsyncIterable<string>;
}
