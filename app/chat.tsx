"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export interface CustomerOption {
  id: string;
  name: string;
  email: string;
  subscriptionStatus: string;
  plan: string;
  phone?: string | null;
  address?: string | null;
  paymentMethod?: string | null;
}

interface Source {
  slug: string;
  heading: string;
  score?: number;
}

interface Step {
  name: string;
  status: "running" | "done";
  ok?: boolean;
  summary?: string;
}

interface OrderView {
  order_number: string;
  status: string;
  total_cents: number;
  delivery_date?: string | null;
  refunded: boolean;
  items: string[];
}

interface RefundProposal {
  order_number: string;
  amount_cents: number;
  reason: string;
  items?: string[];
}

interface PauseProposal {
  weeks: number;
  resume_date: string;
}

type ProposalState = "pending" | "approved" | "declined" | "error";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  steps?: Step[];
  orders?: OrderView[];
  proposal?: RefundProposal;
  proposalState?: ProposalState;
  pauseProposal?: PauseProposal;
  pauseState?: ProposalState;
}

interface AccountData {
  customer: {
    name: string;
    email: string;
    phone?: string | null;
    address?: string | null;
    paymentMethod?: string | null;
    plan: string;
    subscriptionStatus: string;
  };
  orders: OrderView[];
}

const EXAMPLE_PROMPTS = [
  "Where's my latest order?",
  "Show me my order history",
  "Pause my subscription for 2 weeks",
  "My last box arrived damaged — I'd like a refund",
];

const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: "Searching the help center",
  lookup_order: "Looking up your orders",
  pause_subscription: "Preparing a pause",
  resume_subscription: "Resuming your subscription",
  issue_refund: "Preparing a refund",
  escalate_to_human: "Escalating to a human",
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function Chat({ customers: initialCustomers }: { customers: CustomerOption[] }) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [customerId, setCustomerId] = useState(initialCustomers[0]?.id ?? "");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [account, setAccount] = useState<AccountData | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeCustomer = customers.find((c) => c.id === customerId);

  function startNewChat() {
    if (busy) return;
    setMessages([]);
    setInput("");
    setShowAccount(false);
  }

  function switchCustomer(id: string) {
    if (busy) return;
    setCustomerId(id);
    setMessages([]);
    setInput("");
  }

  async function refreshCustomers() {
    try {
      const res = await fetch("/api/customers");
      if (res.ok) setCustomers((await res.json()) as CustomerOption[]);
    } catch {
      // non-fatal
    }
  }

  // Load the account panel data whenever it's open or the customer changes.
  useEffect(() => {
    if (!showAccount || !customerId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/account?customerId=${customerId}`);
        if (res.ok && !cancelled) setAccount((await res.json()) as AccountData);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showAccount, customerId]);

  function setProposalState(index: number, state: ProposalState) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, proposalState: state } : m)));
  }
  function setPauseState(index: number, state: ProposalState) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, pauseState: state } : m)));
  }

  // Initiate a proposed refund: the write happens here (server endpoint), never
  // in the agent loop.
  async function initiateRefund(index: number, proposal: RefundProposal) {
    try {
      const res = await fetch("/api/actions/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, orderNumber: proposal.order_number, reason: proposal.reason }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      setProposalState(index, res.ok && data.ok ? "approved" : "error");
    } catch {
      setProposalState(index, "error");
    }
  }

  // Apply a proposed pause via the server endpoint, then refresh the selector.
  async function confirmPause(index: number, proposal: PauseProposal) {
    try {
      const res = await fetch("/api/actions/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, weeks: proposal.weeks }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      setPauseState(index, res.ok && data.ok ? "approved" : "error");
      if (res.ok && data.ok) refreshCustomers();
    } catch {
      setPauseState(index, "error");
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");
    setShowAccount(false);

    const history: Message[] = [...messages, { role: "user", content: question }];
    setMessages([...history, { role: "assistant", content: "", sources: [], steps: [] }]);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "Request failed");
        patchLast({ content: `Sorry — ${msg || "something went wrong"}.` });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const raw of events) handleEvent(raw);
      }
      await refreshCustomers();
    } catch (err) {
      patchLast({ content: `Sorry — connection error: ${err instanceof Error ? err.message : "unknown"}.` });
    } finally {
      setBusy(false);
    }
  }

  function handleEvent(raw: string) {
    const lines = raw.split("\n");
    const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
    const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim();
    if (!event || dataLine === undefined) return;

    let data: unknown;
    try {
      data = JSON.parse(dataLine);
    } catch {
      return;
    }

    if (event === "sources") {
      patchLast({ sources: data as Source[] });
    } else if (event === "orders") {
      patchLast({ orders: data as OrderView[] });
    } else if (event === "refund_proposal") {
      patchLast({ proposal: data as RefundProposal, proposalState: "pending" });
    } else if (event === "pause_proposal") {
      patchLast({ pauseProposal: data as PauseProposal, pauseState: "pending" });
    } else if (event === "tool_call") {
      const { name } = data as { name: string };
      setMessages((prev) => updateLast(prev, (m) => ({ ...m, steps: [...(m.steps ?? []), { name, status: "running" }] })));
    } else if (event === "tool_result") {
      const { name, ok, summary } = data as { name: string; ok: boolean; summary: string };
      setMessages((prev) =>
        updateLast(prev, (m) => {
          const steps = [...(m.steps ?? [])];
          for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i].name === name && steps[i].status === "running") {
              steps[i] = { ...steps[i], status: "done", ok, summary };
              break;
            }
          }
          return { ...m, steps };
        }),
      );
    } else if (event === "delta") {
      const delta = data as string;
      setMessages((prev) => updateLast(prev, (m) => ({ ...m, content: m.content + delta })));
    } else if (event === "error") {
      patchLast({ content: `Sorry — ${(data as { message: string }).message}` });
    }
  }

  function patchLast(patch: Partial<Message>) {
    setMessages((prev) => updateLast(prev, (m) => ({ ...m, ...patch })));
  }

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col px-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 py-4">
        <div>
          <h1 className="text-lg font-semibold text-brand">FreshCrate Support</h1>
          <p className="text-xs text-slate-500">
            Grounded answers + real actions ·{" "}
            <Link href="/kb" className="text-brand hover:underline">
              Browse help articles
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAccount((v) => !v)}
            className={
              "rounded-md border px-2.5 py-1 text-sm shadow-sm transition " +
              (showAccount
                ? "border-brand bg-brand text-white"
                : "border-slate-300 bg-white text-slate-600 hover:border-brand hover:text-brand")
            }
          >
            {showAccount ? "Chat" : "Account"}
          </button>
          {messages.length > 0 && (
            <button
              onClick={startNewChat}
              disabled={busy}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm text-slate-600 shadow-sm transition hover:border-brand hover:text-brand disabled:opacity-50"
            >
              + New chat
            </button>
          )}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Signed in as</span>
            <select
              value={customerId}
              onChange={(e) => switchCustomer(e.target.value)}
              disabled={busy}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-brand focus:outline-none disabled:opacity-50"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.subscriptionStatus}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-6">
        {showAccount ? (
          <AccountPanel account={account} />
        ) : (
          <>
            {messages.length === 0 && <Welcome customer={activeCustomer} onPick={send} />}
            {messages.map((m, i) => (
              <MessageBubble
                key={i}
                message={m}
                streaming={busy && i === messages.length - 1}
                paymentMethod={activeCustomer?.paymentMethod}
                onInitiateRefund={() => m.proposal && initiateRefund(i, m.proposal)}
                onDeclineRefund={() => setProposalState(i, "declined")}
                onConfirmPause={() => m.pauseProposal && confirmPause(i, m.pauseProposal)}
                onDeclinePause={() => setPauseState(i, "declined")}
              />
            ))}
          </>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-end gap-2 border-t border-slate-200 py-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder="Ask about an order, pausing, a refund, or any policy…"
          className="min-h-[44px] flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="h-[44px] rounded-lg bg-brand px-4 text-sm font-medium text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

function updateLast(prev: Message[], fn: (m: Message) => Message): Message[] {
  const next = [...prev];
  const last = next[next.length - 1];
  if (last?.role === "assistant") next[next.length - 1] = fn(last);
  return next;
}

function Welcome({ customer, onPick }: { customer?: CustomerOption; onPick: (text: string) => void }) {
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

function MessageBubble({
  message,
  streaming,
  paymentMethod,
  onInitiateRefund,
  onDeclineRefund,
  onConfirmPause,
  onDeclinePause,
}: {
  message: Message;
  streaming: boolean;
  paymentMethod?: string | null;
  onInitiateRefund: () => void;
  onDeclineRefund: () => void;
  onConfirmPause: () => void;
  onDeclinePause: () => void;
}) {
  const isUser = message.role === "user";
  // Loading state: assistant turn started but nothing has arrived yet.
  const showThinking =
    !isUser &&
    streaming &&
    !message.content &&
    (message.steps?.length ?? 0) === 0 &&
    !message.orders &&
    !message.proposal &&
    !message.pauseProposal;

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          isUser
            ? "max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-sm text-white"
            : "max-w-[85%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm"
        }
      >
        {showThinking && <Thinking />}

        {!isUser && message.steps && message.steps.length > 0 && <ToolSteps steps={message.steps} />}

        {message.content && (
          <p className="whitespace-pre-wrap">
            {message.content}
            {streaming && !isUser && <span className="ml-0.5 animate-pulse">▋</span>}
          </p>
        )}

        {!isUser && message.orders && message.orders.length > 0 && <OrdersCard orders={message.orders} />}

        {!isUser && message.proposal && (
          <RefundCard
            proposal={message.proposal}
            state={message.proposalState ?? "pending"}
            paymentMethod={paymentMethod}
            onInitiate={onInitiateRefund}
            onDecline={onDeclineRefund}
          />
        )}

        {!isUser && message.pauseProposal && (
          <PauseCard
            proposal={message.pauseProposal}
            state={message.pauseState ?? "pending"}
            onConfirm={onConfirmPause}
            onDecline={onDeclinePause}
          />
        )}

        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-2">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">Sources</p>
            <div className="flex flex-wrap gap-1.5">
              {message.sources.map((s, i) => (
                <a
                  key={i}
                  href={`/kb/${s.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the source article"
                  className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 transition hover:bg-brand/10 hover:text-brand"
                >
                  {s.slug} › {s.heading}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-400">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" />
      <span className="ml-1">Thinking…</span>
    </div>
  );
}

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

function OrdersCard({ orders }: { orders: OrderView[] }) {
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Order history</p>
      <div className="space-y-2">
        {orders.map((o) => (
          <div key={o.order_number} className="rounded-md border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-medium text-slate-700">{o.order_number}</span>
              <div className="flex items-center gap-2">
                <StatusBadge order={o} />
                <span className="text-xs font-semibold text-slate-700">{money(o.total_cents)}</span>
              </div>
            </div>
            {o.items.length > 0 && (
              <p className="mt-1 text-[11px] text-slate-500">{o.items.join(" · ")}</p>
            )}
            {o.delivery_date && (
              <p className="mt-0.5 text-[10px] text-slate-400">Delivery {o.delivery_date}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RefundCard({
  proposal,
  state,
  paymentMethod,
  onInitiate,
  onDecline,
}: {
  proposal: RefundProposal;
  state: ProposalState;
  paymentMethod?: string | null;
  onInitiate: () => void;
  onDecline: () => void;
}) {
  const amount = money(proposal.amount_cents);
  const card = paymentMethod ?? "your card on file";
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Refund request</p>
      <p className="mt-1 text-sm text-slate-800">
        This order can be refunded. Order <span className="font-mono text-xs">{proposal.order_number}</span>{" "}
        will be refunded <span className="font-semibold">{amount}</span> to {card}.
      </p>
      {proposal.items && proposal.items.length > 0 && (
        <p className="mt-1 text-[11px] text-slate-500">{proposal.items.join(" · ")}</p>
      )}
      <p className="mt-0.5 text-xs text-slate-500">Reason: {proposal.reason}</p>

      {state === "pending" && (
        <>
          <p className="mt-2 text-sm text-slate-700">Do you wish to initiate the refund?</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={onInitiate}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark"
            >
              Yes, refund my order
            </button>
            <button
              onClick={onDecline}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
            >
              Not now
            </button>
          </div>
        </>
      )}
      {state === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">✓ Refund of {amount} initiated to {card}.</p>
      )}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — no refund was made.</p>}
      {state === "error" && (
        <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t process the refund — please try again.</p>
      )}
    </div>
  );
}

function PauseCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: PauseProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Pause request</p>
      <p className="mt-1 text-sm text-slate-800">
        Pause your subscription for <span className="font-semibold">{proposal.weeks} week{proposal.weeks === 1 ? "" : "s"}</span>?
        It will resume on <span className="font-semibold">{proposal.resume_date}</span>.
      </p>

      {state === "pending" && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={onConfirm}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark"
          >
            Yes, pause it
          </button>
          <button
            onClick={onDecline}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
          >
            Not now
          </button>
        </div>
      )}
      {state === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">✓ Paused — resumes {proposal.resume_date}.</p>
      )}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — your subscription is unchanged.</p>}
      {state === "error" && (
        <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t pause the subscription — please try again.</p>
      )}
    </div>
  );
}

function ToolSteps({ steps }: { steps: Step[] }) {
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

function AccountPanel({ account }: { account: AccountData | null }) {
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
    ["Subscription", c.subscriptionStatus],
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
            <div key={o.order_number} className="rounded-md border border-slate-200 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-medium text-slate-700">{o.order_number}</span>
                <div className="flex items-center gap-2">
                  <StatusBadge order={o} />
                  <span className="text-xs font-semibold text-slate-700">{money(o.total_cents)}</span>
                </div>
              </div>
              {o.items.length > 0 && <p className="mt-1 text-[11px] text-slate-500">{o.items.join(" · ")}</p>}
              {o.delivery_date && <p className="mt-0.5 text-[10px] text-slate-400">Delivery {o.delivery_date}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
