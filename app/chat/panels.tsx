"use client";

import { formatLongDate } from "@/lib/date";
import { fmtDate, TOOL_LABELS } from "./format";
import { OrderRow, TxnRow } from "./order-views";
import type { AccountData, CustomerOption, Step } from "./types";

export function Welcome({ customer }: { customer?: CustomerOption }) {
  return (
    <div className="max-w-[62ch]">
      <h2 className="font-display text-xl font-bold tracking-tight">
        Hi{customer ? `, ${customer.name.split(" ")[0]}` : ""}. I&apos;m Cratelyn.
      </h2>
      <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
        I answer FreshCrate policy questions, with sources, and take actions on your account: look up orders, pause or
        resume your plan, issue refunds, or hand you to a person. Type a question, or pick one from things to try.
      </p>
      <p className="mt-3 rounded-lg bg-paper px-3 py-2 text-[13px] leading-relaxed text-muted">
        Actions run against sample data. Hand-offs to a person are simulated: nobody will reply, but you can keep
        chatting with the assistant.
      </p>
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
