"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "./chat/message-bubble";
import { AccountPanel, Welcome } from "./chat/panels";
import type {
  AccountData,
  CancelProposal,
  CustomerOption,
  HistoryData,
  Message,
  PauseProposal,
  PlanChangeProposal,
  ProposalState,
  ReactivateProposal,
  RefundProposal,
  ResumeProposal,
  Source,
} from "./chat/types";

export type { CustomerOption } from "./chat/types";

export default function Chat({ customers: initialCustomers }: { customers: CustomerOption[] }) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [customerId, setCustomerId] = useState(initialCustomers[0]?.id ?? "");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [showPreviewNote, setShowPreviewNote] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

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

  // Close the preview note on outside-click or Escape.
  useEffect(() => {
    if (!showPreviewNote) return;
    function onPointer(e: MouseEvent) {
      if (previewRef.current && !previewRef.current.contains(e.target as Node)) {
        setShowPreviewNote(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowPreviewNote(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [showPreviewNote]);

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
  function setResumeState(index: number, state: ProposalState) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, resumeState: state } : m)));
  }
  function setReactivateState(index: number, state: ProposalState) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, reactivateState: state } : m)));
  }
  function setPlanState(index: number, state: ProposalState) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, planState: state } : m)));
  }

  async function postAction(url: string, payload: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      return res.ok && !!data.ok;
    } catch {
      return false;
    }
  }

  async function confirmReactivate(index: number, proposal: ReactivateProposal) {
    const ok = await postAction("/api/actions/reactivate", {
      customerId,
      newPlan: proposal.plan_changed ? proposal.plan : undefined,
    });
    setReactivateState(index, ok ? "approved" : "error");
    if (ok) refreshCustomers();
  }

  async function confirmPlanChange(index: number, proposal: PlanChangeProposal) {
    const ok = await postAction("/api/actions/change-plan", { customerId, plan: proposal.plan });
    setPlanState(index, ok ? "approved" : "error");
    if (ok) refreshCustomers();
  }

  async function confirmResume(index: number, proposal: ResumeProposal) {
    const ok = await postAction("/api/actions/resume", {
      customerId,
      newPlan: proposal.plan_changed ? proposal.plan : undefined,
    });
    setResumeState(index, ok ? "approved" : "error");
    if (ok) refreshCustomers();
  }

  function setCancelState(index: number, state: ProposalState) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, cancelState: state } : m)));
  }
  async function confirmCancel(index: number) {
    const ok = await postAction("/api/actions/cancel", { customerId });
    setCancelState(index, ok ? "approved" : "error");
    if (ok) refreshCustomers();
  }

  // Initiate a proposed refund: the write happens here (server endpoint), never
  // in the agent loop.
  async function initiateRefund(index: number, proposal: RefundProposal) {
    const ok = await postAction("/api/actions/refund", {
      customerId,
      orderNumber: proposal.order_number,
      reason: proposal.reason,
    });
    setProposalState(index, ok ? "approved" : "error");
  }

  // Apply a proposed pause via the server endpoint, then refresh the selector.
  async function confirmPause(index: number, proposal: PauseProposal) {
    const ok = await postAction("/api/actions/pause", {
      customerId,
      weeks: proposal.weeks,
      resumeDate: proposal.resume_date,
      indefinite: proposal.indefinite,
    });
    setPauseState(index, ok ? "approved" : "error");
    if (ok) refreshCustomers();
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
    } else if (event === "history") {
      patchLast({ history: data as HistoryData });
    } else if (event === "refund_proposal") {
      patchLast({ proposal: data as RefundProposal, proposalState: "pending" });
    } else if (event === "pause_proposal") {
      patchLast({ pauseProposal: data as PauseProposal, pauseState: "pending" });
    } else if (event === "resume_proposal") {
      patchLast({ resumeProposal: data as ResumeProposal, resumeState: "pending" });
    } else if (event === "reactivate_proposal") {
      patchLast({ reactivateProposal: data as ReactivateProposal, reactivateState: "pending" });
    } else if (event === "plan_change_proposal") {
      patchLast({ planProposal: data as PlanChangeProposal, planState: "pending" });
    } else if (event === "cancel_proposal") {
      patchLast({ cancelProposal: data as CancelProposal, cancelState: "pending" });
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
    } else if (event === "reset") {
      setMessages((prev) => updateLast(prev, (m) => ({ ...m, content: "" })));
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
          <div className="flex items-center gap-2">
            <button
              onClick={startNewChat}
              title="Back to start"
              className="text-left text-lg font-semibold text-brand transition hover:text-brand-dark"
            >
              FreshCrate Support
            </button>
            <div ref={previewRef} className="relative">
              <button
                type="button"
                onClick={() => setShowPreviewNote((v) => !v)}
                aria-expanded={showPreviewNote}
                className={
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition " +
                  (showPreviewNote
                    ? "border-brand bg-brand/5 text-brand"
                    : "border-slate-300 text-slate-500 hover:border-brand hover:text-brand")
                }
              >
                <span aria-hidden className="text-[11px] leading-none">ⓘ</span>
                Preview
              </button>
              {showPreviewNote && (
                <div className="absolute left-0 top-full z-10 mt-1.5 w-64 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-lg">
                  An evolving demo - some features are still on the way, so you
                  may spot the occasional rough edge.
                </div>
              )}
            </div>
          </div>
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
              // The wrapping <label> already associates the text, but because
              // the <select> sits inside it, the label's text content pulls in
              // every option too. An explicit name keeps it short and the same
              // across assistive technologies.
              aria-label="Signed in as customer"
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
                onConfirmResume={() => m.resumeProposal && confirmResume(i, m.resumeProposal)}
                onDeclineResume={() => setResumeState(i, "declined")}
                onConfirmReactivate={() => m.reactivateProposal && confirmReactivate(i, m.reactivateProposal)}
                onDeclineReactivate={() => setReactivateState(i, "declined")}
                onConfirmPlan={() => m.planProposal && confirmPlanChange(i, m.planProposal)}
                onDeclinePlan={() => setPlanState(i, "declined")}
                onConfirmCancel={() => confirmCancel(i)}
                onDeclineCancel={() => setCancelState(i, "declined")}
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
