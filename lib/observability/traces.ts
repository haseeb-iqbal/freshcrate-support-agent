import { db } from "@/db";
import { traces } from "@/db/schema";
import type { TurnSummary } from "@/lib/agent/loop";
import { estimateCostUsd } from "@/lib/llm/pricing";

export interface TraceInput {
  conversationId: string;
  customerId: string;
  turnIndex: number;
  userMessage: string;
  latencyMs: number;
  /** What the turn did, or null when it threw before finishing. */
  summary: TurnSummary | null;
}

/** The traces row for one chat turn. Pure, so the mapping is testable without a DB. */
export function traceRow(t: TraceInput): typeof traces.$inferInsert {
  const s = t.summary;
  return {
    conversationId: t.conversationId,
    customerId: t.customerId,
    turnIndex: t.turnIndex,
    userMessage: t.userMessage,
    modelUsed: s?.model ?? null,
    toolsCalled: s?.tools ?? [],
    inputTokens: s?.promptTokens ?? 0,
    outputTokens: s?.completionTokens ?? 0,
    estCostUsd: s ? estimateCostUsd(s.model, s.promptTokens, s.completionTokens).toFixed(6) : "0",
    latencyMs: t.latencyMs,
    guards: s?.guards ?? [],
    endReason: s?.end ?? "error",
  };
}

/**
 * Log one chat turn to the traces table, for the /dashboard page. Called after
 * the response has finished, and never throws: a failed write is logged and
 * dropped, so tracing can't break or slow down the chat. Skipped when
 * TRACES_DISABLED=1 (the eval runner sets it so evals don't fill the log).
 */
export async function recordTrace(t: TraceInput): Promise<void> {
  if (process.env.TRACES_DISABLED === "1") return;
  try {
    await db.insert(traces).values(traceRow(t));
  } catch (err) {
    console.warn("trace write failed:", err instanceof Error ? err.message : err);
  }
}
