import type { ToolDefinition } from "../llm/types";

/** Result returned by a tool handler. */
export interface ToolResult {
  ok: boolean;
  /** Short human-readable status surfaced to the UI (tool_result event). */
  summary: string;
  /** Structured payload returned to the model (stringified into a tool message). */
  data?: unknown;
}

/** Trusted, server-side context every tool runs under. */
export interface ToolContext {
  /** The signed-in customer. Tools act ONLY on this id, never on model input. */
  customerId: string;
  /**
   * "Now" for this request, read once at the boundary so every tool in a turn
   * agrees on the date. Comes from lib/clock, never from `new Date()`.
   */
  now: Date;
}

export interface Tool {
  definition: ToolDefinition;
  handler(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}
