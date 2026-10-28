import Link from "next/link";
import { listTraces, totals, turnsPerDay, usageCounts, type Totals, type TraceView } from "@/lib/observability/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const usd = (n: number) => (n === 0 ? "$0" : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * Observability for the demo: what chat turns cost, how long they take, which
 * tools run and how often a guard has to step in. Reads the traces table, one
 * row per chat turn. Read-only, and like the rest of the demo it has no login.
 */
export default async function Dashboard({ searchParams }: { searchParams: { conversation?: string } }) {
  const conversation = searchParams.conversation && UUID.test(searchParams.conversation) ? searchParams.conversation : null;
  if (conversation) return <ConversationView id={conversation} />;

  const now = Date.now();
  const [today, week, all, days, usage, recent, slowest] = await Promise.all([
    totals(new Date(new Date().setHours(0, 0, 0, 0))),
    totals(new Date(now - 7 * 86_400_000)),
    totals(null),
    turnsPerDay(14),
    usageCounts(),
    listTraces({ order: "recent", limit: 20 }),
    listTraces({ order: "slowest", limit: 5 }),
  ]);
  const maxDay = Math.max(1, ...days.map((d) => d.turns));
  const maxTool = Math.max(1, ...usage.tools.map((t) => t.count));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/" className="text-sm text-brand hover:underline">
        ← Back to chat
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every chat turn, logged after it finishes. Costs are estimates at gpt-4o-mini list prices. Evals are not logged.
      </p>

      {all.turns === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No chat turns logged yet. Ask the assistant something and come back.
        </p>
      ) : (
        <>
          <section className="mt-6 grid gap-4 md:grid-cols-3">
            <TotalsCard title="Today" t={today} />
            <TotalsCard title="Last 7 days" t={week} />
            <TotalsCard title="All time" t={all} />
          </section>

          <section className="mt-6 grid gap-4 md:grid-cols-2">
            <Panel title="Turns per day (last 14 days)">
              <ul className="space-y-1">
                {days.map((d) => (
                  <li key={d.day} className="flex items-center gap-2 text-xs">
                    <span className="w-20 shrink-0 text-slate-500">{d.day.slice(5)}</span>
                    <span className="h-3 rounded-sm bg-brand/70" style={{ width: `${(d.turns / maxDay) * 100}%`, minWidth: d.turns ? 4 : 0 }} />
                    <span className="shrink-0 text-slate-600">
                      {d.turns} {d.turns ? `· ${usd(d.costUsd)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Tool usage">
              {usage.tools.length === 0 ? (
                <p className="text-xs text-slate-500">No tools called yet.</p>
              ) : (
                <ul className="space-y-1">
                  {usage.tools.map((t) => (
                    <li key={t.name} className="flex items-center gap-2 text-xs">
                      <span className="w-44 shrink-0 truncate font-mono text-slate-700">{t.name}</span>
                      <span className="h-3 rounded-sm bg-slate-400" style={{ width: `${(t.count / maxTool) * 100}%` }} />
                      <span className="shrink-0 text-slate-600">{t.count}</span>
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Guards that stepped in</h3>
              {usage.guards.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">None yet.</p>
              ) : (
                <p className="mt-1 text-xs text-slate-700">
                  {usage.guards.map((g) => `${g.name} ×${g.count}`).join(" · ")}
                </p>
              )}
            </Panel>
          </section>

          <Panel title="Slowest turns" className="mt-6">
            <TraceTable rows={slowest} />
          </Panel>
          <Panel title="20 most recent turns" className="mt-6">
            <TraceTable rows={recent} />
          </Panel>
        </>
      )}
    </main>
  );
}

async function ConversationView({ id }: { id: string }) {
  const rows = await listTraces({ conversationId: id });
  const cost = rows.reduce((s, r) => s + r.costUsd, 0);
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/dashboard" className="text-sm text-brand hover:underline">
        ← Back to dashboard
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">Conversation</h1>
      <p className="mt-1 font-mono text-xs text-slate-500">{id}</p>
      <p className="mt-2 text-sm text-slate-600">
        {rows[0]?.customerName ?? "Unknown customer"} · {rows.length} turn{rows.length === 1 ? "" : "s"} · {usd(cost)}
      </p>
      <Panel title="Turns in order" className="mt-6">
        <TraceTable rows={rows} showConversationLink={false} />
      </Panel>
    </main>
  );
}

function TotalsCard({ title, t }: { title: string; t: Totals }) {
  const stats: [string, string][] = [
    ["Conversations", String(t.conversations)],
    ["Turns", String(t.turns)],
    ["Total cost", usd(t.costUsd)],
    ["Avg cost / turn", usd(t.avgCostUsd)],
    ["Avg latency", secs(t.avgLatencyMs)],
    ["p95 latency", secs(t.p95LatencyMs)],
    ["Turns with a card", pct(t.cardRate)],
    ["Guard stepped in", pct(t.guardRate)],
    ["Cut short", pct(t.failureRate)],
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[10px] text-slate-500">{label}</dt>
            <dd className="text-sm font-semibold text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Panel({ title, className = "", children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function TraceTable({ rows, showConversationLink = true }: { rows: TraceView[]; showConversationLink?: boolean }) {
  if (rows.length === 0) return <p className="text-xs text-slate-500">No turns.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="py-1.5 pr-3 font-medium">{showConversationLink ? "Time" : "Turn"}</th>
            <th className="py-1.5 pr-3 font-medium">Customer</th>
            <th className="py-1.5 pr-3 font-medium">Message</th>
            <th className="py-1.5 pr-3 font-medium">Tools</th>
            <th className="py-1.5 pr-3 font-medium">Guards / end</th>
            <th className="py-1.5 pr-3 text-right font-medium">Tokens in/out</th>
            <th className="py-1.5 pr-3 text-right font-medium">Cost</th>
            <th className="py-1.5 text-right font-medium">Latency</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-700">
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="whitespace-nowrap py-1.5 pr-3 text-slate-500">
                {showConversationLink ? (
                  <Link href={`/dashboard?conversation=${r.conversationId}`} className="text-brand hover:underline" title="Open this conversation">
                    {r.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </Link>
                ) : (
                  `#${r.turnIndex + 1}`
                )}
              </td>
              <td className="whitespace-nowrap py-1.5 pr-3">{r.customerName ?? "-"}</td>
              <td className="max-w-[16rem] py-1.5 pr-3" title={r.userMessage ?? ""}>
                <span className="line-clamp-2">{r.userMessage ?? "-"}</span>
              </td>
              <td className="py-1.5 pr-3 font-mono text-[11px]">{r.tools.join(", ") || "-"}</td>
              <td className="py-1.5 pr-3">
                {r.guards.length > 0 && <span className="mr-1 rounded bg-amber-100 px-1 text-amber-800">{r.guards.join(", ")}</span>}
                {r.endReason && r.endReason !== "answered" && <span className="rounded bg-red-100 px-1 text-red-700">{r.endReason}</span>}
                {r.guards.length === 0 && (!r.endReason || r.endReason === "answered") && "-"}
              </td>
              <td className="whitespace-nowrap py-1.5 pr-3 text-right">
                {r.inputTokens.toLocaleString()} / {r.outputTokens.toLocaleString()}
              </td>
              <td className="whitespace-nowrap py-1.5 pr-3 text-right">{usd(r.costUsd)}</td>
              <td className="whitespace-nowrap py-1.5 text-right">{secs(r.latencyMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
