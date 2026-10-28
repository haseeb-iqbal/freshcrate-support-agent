import { client } from "@/db";
import { PROPOSAL_EVENTS } from "@/lib/agent/dispatch";

/** Read-only queries behind the /dashboard page, over the traces table. */

export interface Totals {
  conversations: number;
  turns: number;
  costUsd: number;
  avgCostUsd: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  /** Share of turns where a guard stepped in, 0-1. */
  guardRate: number;
  /** Share of turns cut short (step cap, deadline or error), 0-1. */
  failureRate: number;
  /** Share of turns that showed a confirmation card, 0-1. */
  cardRate: number;
}

export interface TraceView {
  id: string;
  createdAt: Date;
  conversationId: string;
  turnIndex: number;
  customerName: string | null;
  userMessage: string | null;
  tools: string[];
  guards: string[];
  endReason: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

const PROPOSE_TOOLS = Object.keys(PROPOSAL_EVENTS);

/** Totals over turns created at or after `since` (all time when null). */
export async function totals(since: Date | null): Promise<Totals> {
  const from = since?.toISOString() ?? null;
  const [r] = await client<Record<string, string | number | null>[]>`
    select
      count(distinct conversation_id)::int as conversations,
      count(*)::int as turns,
      coalesce(sum(est_cost_usd), 0)::float as cost,
      coalesce(avg(est_cost_usd), 0)::float as avg_cost,
      coalesce(avg(latency_ms), 0)::float as avg_latency,
      coalesce(percentile_cont(0.95) within group (order by latency_ms), 0)::float as p95_latency,
      coalesce(avg(case when jsonb_array_length(coalesce(guards, '[]'::jsonb)) > 0 then 1 else 0 end), 0)::float as guard_rate,
      coalesce(avg(case when end_reason <> 'answered' then 1 else 0 end), 0)::float as failure_rate,
      coalesce(avg(case when tools_called ?| ${PROPOSE_TOOLS}::text[] then 1 else 0 end), 0)::float as card_rate
    from traces
    where ${from}::timestamptz is null or created_at >= ${from}::timestamptz
  `;
  return {
    conversations: Number(r.conversations),
    turns: Number(r.turns),
    costUsd: Number(r.cost),
    avgCostUsd: Number(r.avg_cost),
    avgLatencyMs: Number(r.avg_latency),
    p95LatencyMs: Number(r.p95_latency),
    guardRate: Number(r.guard_rate),
    failureRate: Number(r.failure_rate),
    cardRate: Number(r.card_rate),
  };
}

/** Turns per day for the last `days` days, oldest first, zero-filled. */
export async function turnsPerDay(days: number): Promise<{ day: string; turns: number; costUsd: number }[]> {
  return client<{ day: string; turns: number; costUsd: number }[]>`
    select to_char(d.day, 'YYYY-MM-DD') as day, count(t.id)::int as turns, coalesce(sum(t.est_cost_usd), 0)::float as "costUsd"
    from generate_series(current_date - (${days}::int - 1), current_date, interval '1 day') as d(day)
    left join traces t on t.created_at::date = d.day::date
    group by d.day
    order by d.day
  `;
}

/** How many times each tool ran, and how often each guard stepped in. */
export async function usageCounts(): Promise<{ tools: { name: string; count: number }[]; guards: { name: string; count: number }[] }> {
  const tools = await client<{ name: string; count: number }[]>`
    select name, count(*)::int as count
    from traces, jsonb_array_elements_text(coalesce(tools_called, '[]'::jsonb)) as name
    group by name order by count desc, name
  `;
  const guards = await client<{ name: string; count: number }[]>`
    select name, count(*)::int as count
    from traces, jsonb_array_elements_text(coalesce(guards, '[]'::jsonb)) as name
    group by name order by count desc, name
  `;
  return { tools: [...tools], guards: [...guards] };
}

/** Turns as the tables show them: the most recent, the slowest, or one conversation's in order. */
export async function listTraces(opts: { order: "recent" | "slowest"; limit: number } | { conversationId: string }): Promise<TraceView[]> {
  const rows =
    "conversationId" in opts
      ? await client`
          select t.*, c.name as customer_name from traces t left join customers c on c.id = t.customer_id
          where t.conversation_id = ${opts.conversationId} order by t.turn_index, t.created_at`
      : opts.order === "slowest"
        ? await client`
            select t.*, c.name as customer_name from traces t left join customers c on c.id = t.customer_id
            order by t.latency_ms desc nulls last limit ${opts.limit}`
        : await client`
            select t.*, c.name as customer_name from traces t left join customers c on c.id = t.customer_id
            order by t.created_at desc limit ${opts.limit}`;
  return rows.map((r) => ({
    id: r.id,
    createdAt: new Date(r.created_at),
    conversationId: r.conversation_id,
    turnIndex: r.turn_index,
    customerName: r.customer_name,
    userMessage: r.user_message,
    tools: (r.tools_called as string[] | null) ?? [],
    guards: (r.guards as string[] | null) ?? [],
    endReason: r.end_reason,
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    costUsd: Number(r.est_cost_usd ?? 0),
    latencyMs: r.latency_ms ?? 0,
  }));
}
