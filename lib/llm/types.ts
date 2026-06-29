// Swappable chat-provider interface. The agent depends on this, not on OpenAI
// directly, so the model backend (and later, the router) can change in one place.

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** An OpenAI-style function/tool the model may call. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema describing the args
}

/** A tool invocation requested by the model. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // raw JSON string emitted by the model
}

/** A message in the agent's working transcript. */
export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

/** What a streamed agent turn yields: text deltas, then (if any) tool calls. */
export type AgentStreamEvent =
  | { type: "text"; value: string }
  | { type: "tool_calls"; value: ToolCall[] };

export interface AgentTurnOptions {
  messages: AgentMessage[];
  tools?: ToolDefinition[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatProvider {
  /** Model used when a request doesn't specify one. */
  readonly defaultModel: string;
  /**
   * Stream one agent turn. Yields `text` events as the model writes, and a
   * single `tool_calls` event at the end if the model chose to call tools.
   */
  streamAgentTurn(opts: AgentTurnOptions): AsyncIterable<AgentStreamEvent>;
}
