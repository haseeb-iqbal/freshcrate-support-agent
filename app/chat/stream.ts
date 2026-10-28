import { reconcileIncomingProposal } from "./dedup";
import { proposalKindForEvent } from "./proposal-kinds";
import type { AnyProposal, HistoryData, Message, OrderView, Source } from "./types";

/** One `event:` / `data:` block of the chat SSE stream, or null if it is malformed. */
export function parseSseEvent(raw: string): { event: string; data: unknown } | null {
  const lines = raw.split("\n");
  const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
  const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
  if (!event || dataLine === undefined) return null;
  try {
    return { event, data: JSON.parse(dataLine) };
  } catch {
    return null;
  }
}

/** Apply `fn` to the trailing assistant message, if the transcript ends with one. */
export function updateLast(prev: Message[], fn: (m: Message) => Message): Message[] {
  const next = [...prev];
  const last = next[next.length - 1];
  if (last?.role === "assistant") next[next.length - 1] = fn(last);
  return next;
}

/**
 * The transcript after one stream event. Events the chat doesn't render
 * (`usage`, `done`) return the transcript unchanged.
 */
export function applyStreamEvent(prev: Message[], event: string, data: unknown): Message[] {
  // Route a proposal to a card. Distinct proposals (several kinds in one turn,
  // or two refunds for two orders) each get their own card; an identical one the
  // model re-proposed for a follow-up question re-uses its existing card instead
  // of stacking a duplicate (see reconcileIncomingProposal).
  const kind = proposalKindForEvent(event);
  if (kind) return reconcileIncomingProposal(prev, kind, data as AnyProposal);

  const patch = (p: Partial<Message>) => updateLast(prev, (m) => ({ ...m, ...p }));
  switch (event) {
    case "sources":
      return patch({ sources: data as Source[] });
    case "history":
      return patch({ history: data as HistoryData });
    case "order":
      return patch({ order: data as OrderView });
    case "tool_call": {
      const { name } = data as { name: string };
      return updateLast(prev, (m) => ({ ...m, steps: [...(m.steps ?? []), { name, status: "running" }] }));
    }
    case "tool_result": {
      const { name, ok, summary } = data as { name: string; ok: boolean; summary: string };
      return updateLast(prev, (m) => {
        const steps = [...(m.steps ?? [])];
        for (let i = steps.length - 1; i >= 0; i--) {
          if (steps[i].name === name && steps[i].status === "running") {
            steps[i] = { ...steps[i], status: "done", ok, summary };
            break;
          }
        }
        return { ...m, steps };
      });
    }
    case "reset":
      return updateLast(prev, (m) => ({ ...m, content: "" }));
    case "delta": {
      const delta = data as string;
      return updateLast(prev, (m) => ({ ...m, content: m.content + delta }));
    }
    case "error":
      return patch({ content: `Sorry — ${(data as { message: string }).message}` });
    default:
      return prev;
  }
}
