"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export interface CustomerOption {
  id: string;
  name: string;
  email: string;
  subscriptionStatus: string;
  plan: string;
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

interface RefundProposal {
  order_id: string;
  amount_cents: number;
  reason: string;
}

type ProposalState = "pending" | "approved" | "declined" | "error";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  steps?: Step[];
  proposal?: RefundProposal;
  proposalState?: ProposalState;
}

const EXAMPLE_PROMPTS = [
  "Where's my latest order?",
  "Pause my subscription for 2 weeks",
  "My last box arrived damaged — I'd like a refund",
  "What's the capital of France?", // out-of-scope → honest decline + escalate
];

// Friendly labels for the tool-status line.
const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: "Searching the help center",
  lookup_order: "Looking up your order",
  pause_subscription: "Pausing your subscription",
  issue_refund: "Issuing a refund",
  escalate_to_human: "Escalating to a human",
};

export default function Chat({ customers: initialCustomers }: { customers: CustomerOption[] }) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [customerId, setCustomerId] = useState(initialCustomers[0]?.id ?? "");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeCustomer = customers.find((c) => c.id === customerId);

  function startNewChat() {
    if (busy) return;
    setMessages([]);
    setInput("");
  }

  // Switching the signed-in customer starts a fresh session for them.
  function switchCustomer(id: string) {
    if (busy) return;
    setCustomerId(id);
    setMessages([]);
    setInput("");
  }

  // A write tool (e.g. pause) may have changed a customer's status; refresh the
  // selector so it reflects the current DB state.
  async function refreshCustomers() {
    try {
      const res = await fetch("/api/customers");
      if (res.ok) setCustomers((await res.json()) as CustomerOption[]);
    } catch {
      // non-fatal — the dropdown just keeps its current values
    }
  }

  function setProposalState(index: number, state: ProposalState) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, proposalState: state } : m)));
  }

  // Approve a proposed refund: the actual write happens here (server endpoint),
  // never in the agent loop.
  async function approveRefund(index: number, proposal: RefundProposal) {
    try {
      const res = await fetch("/api/actions/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          orderId: proposal.order_id,
          reason: proposal.reason,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      setProposalState(index, res.ok && data.ok ? "approved" : "error");
    } catch {
      setProposalState(index, "error");
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");

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
      // A tool may have changed the customer's status — refresh the selector.
      await refreshCustomers();
    } catch (err) {
      patchLast({
        content: `Sorry — connection error: ${err instanceof Error ? err.message : "unknown"}.`,
      });
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
    } else if (event === "refund_proposal") {
      patchLast({ proposal: data as RefundProposal, proposalState: "pending" });
    } else if (event === "tool_call") {
      const { name } = data as { name: string };
      setMessages((prev) => updateLast(prev, (m) => ({
        ...m,
        steps: [...(m.steps ?? []), { name, status: "running" }],
      })));
    } else if (event === "tool_result") {
      const { name, ok, summary } = data as { name: string; ok: boolean; summary: string };
      setMessages((prev) => updateLast(prev, (m) => {
        const steps = [...(m.steps ?? [])];
        // Mark the most recent running step with this name as done.
        for (let i = steps.length - 1; i >= 0; i--) {
          if (steps[i].name === name && steps[i].status === "running") {
            steps[i] = { ...steps[i], status: "done", ok, summary };
            break;
          }
        }
        return { ...m, steps };
      }));
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
        {messages.length === 0 && <Welcome customer={activeCustomer} onPick={send} />}
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            message={m}
            streaming={busy && i === messages.length - 1}
            onApprove={() => m.proposal && approveRefund(i, m.proposal)}
            onDecline={() => setProposalState(i, "declined")}
          />
        ))}
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

function Welcome({
  customer,
  onPick,
}: {
  customer?: CustomerOption;
  onPick: (text: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800">
        Hi{customer ? `, ${customer.name.split(" ")[0]}` : ""} 👋
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        I can answer FreshCrate policy questions (with sources) and take actions on your account —
        look up orders, pause your plan, issue refunds, or escalate to a human.
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
  onApprove,
  onDecline,
}: {
  message: Message;
  streaming: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          isUser
            ? "max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-sm text-white"
            : "max-w-[85%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm"
        }
      >
        {!isUser && message.steps && message.steps.length > 0 && (
          <ToolSteps steps={message.steps} />
        )}

        {message.content && (
          <p className="whitespace-pre-wrap">
            {message.content}
            {streaming && !isUser && <span className="ml-0.5 animate-pulse">▋</span>}
          </p>
        )}

        {!isUser && message.proposal && (
          <RefundCard
            proposal={message.proposal}
            state={message.proposalState ?? "pending"}
            onApprove={onApprove}
            onDecline={onDecline}
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

function RefundCard({
  proposal,
  state,
  onApprove,
  onDecline,
}: {
  proposal: RefundProposal;
  state: ProposalState;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const amount = `$${(proposal.amount_cents / 100).toFixed(2)}`;
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
        Refund confirmation
      </p>
      <p className="mt-1 text-sm text-slate-800">
        Refund <span className="font-semibold">{amount}</span> for order{" "}
        <span className="font-mono text-xs">{proposal.order_id.slice(0, 8)}</span>
      </p>
      <p className="mt-0.5 text-xs text-slate-500">Reason: {proposal.reason}</p>

      {state === "pending" && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={onApprove}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark"
          >
            Approve refund
          </button>
          <button
            onClick={onDecline}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50"
          >
            Decline
          </button>
        </div>
      )}
      {state === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">✓ Refund of {amount} issued.</p>
      )}
      {state === "declined" && (
        <p className="mt-2 text-xs font-medium text-slate-500">Refund cancelled.</p>
      )}
      {state === "error" && (
        <p className="mt-2 text-xs font-medium text-red-600">
          Couldn&apos;t process the refund — please try again.
        </p>
      )}
    </div>
  );
}

function ToolSteps({ steps }: { steps: Step[] }) {
  return (
    <div className="mb-2 space-y-1">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] text-slate-500">
          <span>
            {s.status === "running" ? "⏳" : s.ok === false ? "⚠️" : "✓"}
          </span>
          <span className="font-medium">{TOOL_LABELS[s.name] ?? s.name}</span>
          {s.status === "done" && s.summary && (
            <span className="text-slate-400">· {s.summary}</span>
          )}
        </div>
      ))}
    </div>
  );
}
