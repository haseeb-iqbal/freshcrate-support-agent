"use client";

import { money } from "@/lib/money";
import { fmtDate } from "./format";
import type { HistoryData, OrderView, TransactionView } from "./types";

function StatusBadge({ order }: { order: OrderView }) {
  const label = order.refunded ? "refunded" : order.status;
  const cls = order.refunded
    ? "bg-emerald-50 text-emerald-700"
    : order.status === "delivered"
      ? "bg-slate-100 text-slate-600"
      : order.status === "cancelled"
        ? "bg-red-50 text-red-600"
        : "bg-blue-50 text-blue-700"; // processing / shipped
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>;
}

function OrderPrice({ o }: { o: OrderView }) {
  const addSum = o.add_ons.reduce((s, a) => s + a.priceCents, 0);
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {o.kind === "subscription" ? (
        <>
          <span className="text-slate-400 line-through">{money(o.list_price_cents)}</span>
          <span className="font-semibold text-emerald-600">Free</span>
        </>
      ) : (
        <span className="font-semibold text-slate-700">{money(o.list_price_cents)}</span>
      )}
      {addSum > 0 && <span className="text-[11px] text-slate-500">+{money(addSum)}</span>}
    </div>
  );
}

export function OrderRow({ o }: { o: OrderView }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-medium text-slate-700">{o.order_number}</span>
        <div className="flex items-center gap-2">
          <StatusBadge order={o} />
          <OrderPrice o={o} />
        </div>
      </div>
      {o.items.length > 0 && <p className="mt-1 text-[11px] text-slate-600">{o.items.join(" · ")}</p>}
      {o.add_ons.length > 0 && (
        <p className="text-[10px] text-slate-400">
          Add-ons: {o.add_ons.map((a) => `${a.name} (${money(a.priceCents)})`).join(", ")}
        </p>
      )}
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-slate-400">
        {o.delivered_on && <span>Delivered {fmtDate(o.delivered_on)}</span>}
        {o.expected_delivery_date && <span>Arriving {fmtDate(o.expected_delivery_date)}</span>}
        {o.refunded && o.refunded_at && (
          <span className="text-emerald-600">Refunded {money(o.refund_cents)} on {fmtDate(o.refunded_at)}</span>
        )}
      </div>
    </div>
  );
}

export function TxnRow({ t }: { t: TransactionView }) {
  const credit = t.amount_cents < 0;
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5">
      <div>
        <p className="text-[11px] text-slate-600">{t.description}</p>
        <p className="text-[10px] text-slate-400">{fmtDate(t.date)}</p>
      </div>
      <span className={`text-xs font-semibold ${credit ? "text-emerald-600" : "text-slate-700"}`}>
        {credit ? "−" : ""}
        {money(Math.abs(t.amount_cents))}
      </span>
    </div>
  );
}

export function HistoryCard({ history }: { history: HistoryData }) {
  return (
    <div data-testid="history-card" className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div>
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Orders</p>
        <div className="space-y-2">
          {history.orders.length === 0 && <p className="text-[11px] text-slate-400">No orders yet.</p>}
          {history.orders.map((o) => (
            <OrderRow key={o.order_number} o={o} />
          ))}
        </div>
      </div>
      {history.transactions.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Payments & fees</p>
          <div className="space-y-1.5">
            {history.transactions.map((t, i) => (
              <TxnRow key={i} t={t} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
