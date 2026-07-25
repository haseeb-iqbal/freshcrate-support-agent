"use client";

import { EXAMPLE_PROMPTS } from "@/lib/example-prompts";
import { formatLongDate } from "@/lib/date";
import { fmtDate, TOOL_LABELS } from "./format";
import { OrderRow, TxnRow } from "./order-views";
import type { AccountData, CustomerOption, Step } from "./types";

export function Welcome({ customer, onPick }: { customer?: CustomerOption; onPick: (text: string) => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800">
        Hi{customer ? `, ${customer.name.split(" ")[0]}` : ""} 👋
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        I can answer FreshCrate policy questions (with sources) and take actions on your account —
        look up orders, pause or resume your plan, issue refunds, or escalate to a human.
      </p>
      <p className="mt-2 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-500">
        🛈 Demo app — actions (pauses, refunds, escalations) run against sample data. Escalations
        are simulated: no real human will reply, but you can keep chatting with the assistant.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 transition hover:border-brand hover:text-brand"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Thinking() {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-400">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" />
      <span className="ml-1">Thinking…</span>
    </div>
  );
}

export function ToolSteps({ steps }: { steps: Step[] }) {
  return (
    <div className="mb-2 space-y-1">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] text-slate-500">
          <span>{s.status === "running" ? "⏳" : s.ok === false ? "⚠️" : "✓"}</span>
          <span className="font-medium">{TOOL_LABELS[s.name] ?? s.name}</span>
          {s.status === "done" && s.summary && <span className="text-slate-400">· {s.summary}</span>}
        </div>
      ))}
    </div>
  );
}

export function AccountPanel({ account }: { account: AccountData | null }) {
  if (!account) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">Loading account…</div>;
  }
  const c = account.customer;
  const rows: [string, string | null | undefined][] = [
    ["Name", c.name],
    ["Email", c.email],
    ["Phone", c.phone],
    ["Address", c.address],
    ["Plan", c.plan],
    ["Dietary track", c.dietaryTrack],
    ["Subscription", c.subscriptionStatus],
    ["Next billing", formatLongDate(c.billingDate)],
    ["Payment method", c.paymentMethod],
  ];
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">Account details</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-col">
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
              <dd className="text-sm text-slate-700">{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">Order history</h2>
        <div className="mt-3 space-y-2">
          {account.orders.length === 0 && <p className="text-sm text-slate-400">No orders yet.</p>}
          {account.orders.map((o) => (
            <OrderRow key={o.order_number} o={o} />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">Payments & fees</h2>
        <div className="mt-3 space-y-1.5">
          {account.transactions.length === 0 && <p className="text-sm text-slate-400">No transactions yet.</p>}
          {account.transactions.map((t, i) => (
            <TxnRow key={i} t={t} />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">Subscription history</h2>
        <div className="mt-3 space-y-1">
          {account.statusHistory.length === 0 && <p className="text-sm text-slate-400">No changes recorded.</p>}
          {account.statusHistory.map((s, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="capitalize text-slate-700">{s.event.replace("_", " ")}</span>
              <span className="text-slate-400">{fmtDate(s.date)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
