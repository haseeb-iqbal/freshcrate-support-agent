"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { EXAMPLE_PROMPTS } from "@/lib/example-prompts";

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

interface AddOn {
  name: string;
  priceCents: number;
}

interface OrderView {
  order_number: string;
  kind: string; // subscription | extra
  status: string;
  charged_cents: number;
  list_price_cents: number;
  add_ons: AddOn[];
  refund_cents: number;
  delivered_on?: string | null;
  expected_delivery_date?: string | null;
  refunded: boolean;
  refunded_at?: string | null;
  items: string[];
  dietary_tags?: string[];
}

interface TransactionView {
  type: string;
  amount_cents: number;
  description: string;
  order_number?: string | null;
  date: string;
}

interface HistoryData {
  orders: OrderView[];
  transactions: TransactionView[];
}

interface RefundProposal {
  order_number: string;
  amount_cents: number;
  list_price_cents?: number;
  add_ons?: AddOn[];
  kind?: string;
  reason: string;
  items?: string[];
}

interface PauseProposal {
  indefinite: boolean;
  weeks: number | null;
  resume_date: string | null;
  reimbursement_cents: number;
  weekly_fee_cents: number;
  weeks_to_billing: number;
}

interface ResumeProposal {
  plan: string;
  previous_plan?: string | null;
  plan_changed: boolean;
  weekly_cents: number;
  charge_cents: number;
  weeks_to_billing: number;
  billing_date?: string | null;
}

interface ReactivateProposal {
  plan: string;
  previous_plan?: string | null;
  plan_changed: boolean;
  monthly_cents: number;
  signup_fee_cents: number;
  total_cents: number;
  free: boolean;
  within_billing: boolean;
  billing_date?: string | null;
}

interface PlanChangeProposal {
  plan: string;
  monthly_cents: number;
  weekly_cents: number;
  current_plan?: string | null;
  proration_cents: number;
  weeks_until_billing: number;
  billing_date?: string | null;
  weekly_savings_cents?: number;
}

interface CancelProposal {
  billing_date?: string | null;
  signup_fee_cents: number;
}

interface DietChangeProposal {
  current_track: string;
  new_track: string;
  effective_from: string;
  meals_preview: string[];
}

type ProposalState = "pending" | "approved" | "declined" | "error";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  steps?: Step[];
  history?: HistoryData;
  proposal?: RefundProposal;
  proposalState?: ProposalState;
  pauseProposal?: PauseProposal;
  pauseState?: ProposalState;
  resumeProposal?: ResumeProposal;
  resumeState?: ProposalState;
  reactivateProposal?: ReactivateProposal;
  reactivateState?: ProposalState;
  planProposal?: PlanChangeProposal;
  planState?: ProposalState;
  cancelProposal?: CancelProposal;
  cancelState?: ProposalState;
  dietProposal?: DietChangeProposal;
  dietState?: ProposalState;
}

interface AccountData {
  customer: {
    name: string;
    email: string;
    phone?: string | null;
    address?: string | null;
    paymentMethod?: string | null;
    plan: string;
    dietaryTrack?: string | null;
    subscriptionStatus: string;
    billingDate?: string | null;
  };
  orders: OrderView[];
  transactions: TransactionView[];
  statusHistory: { event: string; date: string }[];
}

const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: "Searching the help center",
  lookup_order: "Looking up your orders",
  pause_subscription: "Preparing a pause",
  resume_subscription: "Resuming your subscription",
  reactivate_subscription: "Preparing reactivation",
  cancel_subscription: "Preparing cancellation",
  change_plan: "Preparing a plan change",
  change_dietary_track: "Preparing a dietary change",
  list_orders: "Fetching your order history",
  issue_refund: "Preparing a refund",
  escalate_to_human: "Escalating to a human",
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Format an ISO YYYY-MM-DD date as DD-MM-YYYY for display. */
const fmtDate = (iso?: string | null): string => {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
};

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
  function setDietState(index: number, state: ProposalState) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, dietState: state } : m)));
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

  async function confirmDietChange(index: number, proposal: DietChangeProposal) {
    const ok = await postAction("/api/actions/dietary-track", { customerId, track: proposal.new_track });
    setDietState(index, ok ? "approved" : "error");
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
        body: JSON.stringify({
          customerId,
          weeks: proposal.weeks,
          resumeDate: proposal.resume_date,
          indefinite: proposal.indefinite,
        }),
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
    } else if (event === "diet_change_proposal") {
      patchLast({ dietProposal: data as DietChangeProposal, dietState: "pending" });
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
                onConfirmDiet={() => m.dietProposal && confirmDietChange(i, m.dietProposal)}
                onDeclineDiet={() => setDietState(i, "declined")}
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
  onConfirmResume,
  onDeclineResume,
  onConfirmReactivate,
  onDeclineReactivate,
  onConfirmPlan,
  onDeclinePlan,
  onConfirmCancel,
  onDeclineCancel,
  onConfirmDiet,
  onDeclineDiet,
}: {
  message: Message;
  streaming: boolean;
  paymentMethod?: string | null;
  onInitiateRefund: () => void;
  onDeclineRefund: () => void;
  onConfirmPause: () => void;
  onDeclinePause: () => void;
  onConfirmResume: () => void;
  onDeclineResume: () => void;
  onConfirmReactivate: () => void;
  onDeclineReactivate: () => void;
  onConfirmPlan: () => void;
  onDeclinePlan: () => void;
  onConfirmCancel: () => void;
  onDeclineCancel: () => void;
  onConfirmDiet: () => void;
  onDeclineDiet: () => void;
}) {
  const isUser = message.role === "user";
  // Result cards (sources, order history, action prompts) appear only once the
  // text response is complete — not mid-stream (item 6).
  const showResults = !streaming;
  // Loading state: assistant turn started but nothing has arrived yet.
  const showThinking =
    !isUser &&
    streaming &&
    !message.content &&
    (message.steps?.length ?? 0) === 0 &&
    !message.history &&
    !message.proposal &&
    !message.pauseProposal &&
    !message.resumeProposal &&
    !message.reactivateProposal &&
    !message.planProposal &&
    !message.dietProposal;

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
          <p data-testid={isUser ? "user-text" : "assistant-text"} className="whitespace-pre-wrap">
            {message.content}
            {streaming && !isUser && <span className="ml-0.5 animate-pulse">▋</span>}
          </p>
        )}

        {!isUser && showResults && message.history && (
          <HistoryCard history={message.history} />
        )}

        {!isUser && showResults && message.proposal && (
          <RefundCard
            proposal={message.proposal}
            state={message.proposalState ?? "pending"}
            paymentMethod={paymentMethod}
            onInitiate={onInitiateRefund}
            onDecline={onDeclineRefund}
          />
        )}

        {!isUser && showResults && message.pauseProposal && (
          <PauseCard
            proposal={message.pauseProposal}
            state={message.pauseState ?? "pending"}
            onConfirm={onConfirmPause}
            onDecline={onDeclinePause}
          />
        )}

        {!isUser && showResults && message.resumeProposal && (
          <ResumeCard
            proposal={message.resumeProposal}
            state={message.resumeState ?? "pending"}
            onConfirm={onConfirmResume}
            onDecline={onDeclineResume}
          />
        )}

        {!isUser && showResults && message.reactivateProposal && (
          <ReactivateCard
            proposal={message.reactivateProposal}
            state={message.reactivateState ?? "pending"}
            onConfirm={onConfirmReactivate}
            onDecline={onDeclineReactivate}
          />
        )}

        {!isUser && showResults && message.planProposal && (
          <PlanCard
            proposal={message.planProposal}
            state={message.planState ?? "pending"}
            onConfirm={onConfirmPlan}
            onDecline={onDeclinePlan}
          />
        )}

        {!isUser && showResults && message.cancelProposal && (
          <CancelCard
            proposal={message.cancelProposal}
            state={message.cancelState ?? "pending"}
            onConfirm={onConfirmCancel}
            onDecline={onDeclineCancel}
          />
        )}

        {!isUser && showResults && message.dietProposal && (
          <DietCard
            proposal={message.dietProposal}
            state={message.dietState ?? "pending"}
            onConfirm={onConfirmDiet}
            onDecline={onDeclineDiet}
          />
        )}

        {!isUser && showResults && message.sources && message.sources.length > 0 && (
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

function OrderRow({ o }: { o: OrderView }) {
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

function TxnRow({ t }: { t: TransactionView }) {
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

function HistoryCard({ history }: { history: HistoryData }) {
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
    <div data-testid="refund-card" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
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
  const resume = fmtDate(proposal.resume_date);
  const credit = money(proposal.reimbursement_cents);
  const fee = money(proposal.weekly_fee_cents);
  const hasCredit = proposal.reimbursement_cents > 0;
  return (
    <div data-testid="pause-card" className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Pause request</p>
      {proposal.indefinite ? (
        <p className="mt-1 text-sm text-slate-800">
          Pause your subscription <span className="font-semibold">indefinitely</span>? Your plan pauses from next week and stays paused until you resume it.
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-800">
          Pause your subscription for <span className="font-semibold">{proposal.weeks} week{proposal.weeks === 1 ? "" : "s"}</span>?
          Your plan pauses from next week and resumes on <span className="font-semibold">{resume}</span>.
        </p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        {hasCredit ? (
          <>You&apos;ll be credited <span className="font-medium text-emerald-600">{credit}</span> now for the weeks skipped before billing, </>
        ) : (
          <>No credit is due this cycle (billing is due within the week), </>
        )}
        after the <span className="font-medium">{fee}/week</span> pause fee — then {fee}/week is billed each billing date while you stay paused.
      </p>

      {state === "pending" && (
        <div className="mt-2 flex gap-2">
          <button onClick={onConfirm} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark">
            Yes, pause it
          </button>
          <button onClick={onDecline} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50">
            Not now
          </button>
        </div>
      )}
      {state === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">
          ✓ Paused{proposal.indefinite ? " indefinitely" : ` — resumes ${resume}`}{hasCredit ? ` (${credit} credited)` : ""}.
        </p>
      )}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — your subscription is unchanged.</p>}
      {state === "error" && (
        <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t pause the subscription — please try again.</p>
      )}
    </div>
  );
}

function ResumeCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: ResumeProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const charge = money(proposal.charge_cents);
  const hasCharge = proposal.charge_cents > 0;
  return (
    <div data-testid="resume-card" className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Resume request</p>
      {proposal.plan_changed && (
        <p className="text-[11px] text-slate-500">Switching from {proposal.previous_plan} to {proposal.plan}.</p>
      )}
      <p className="mt-1 text-sm text-slate-800">
        Resume your <span className="font-semibold">{proposal.plan}</span> plan? It restarts from next week
        {hasCharge ? (
          <> — you&apos;ll be charged <span className="font-semibold">{charge}</span> for the weeks left until billing (net of the $8/week pause fee).</>
        ) : (
          <> at no charge this cycle (billing is due within the week).</>
        )}
      </p>

      {state === "pending" && (
        <div className="mt-2 flex gap-2">
          <button onClick={onConfirm} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark">
            {hasCharge ? `Pay ${charge} & resume` : "Resume"}
          </button>
          <button onClick={onDecline} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50">
            Not now
          </button>
        </div>
      )}
      {state === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">
          ✓ Resumed on {proposal.plan}{hasCharge ? ` — ${charge} charged` : ""}.
        </p>
      )}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — your subscription stays paused.</p>}
      {state === "error" && (
        <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t resume the subscription — please try again.</p>
      )}
    </div>
  );
}

function ReactivateCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: ReactivateProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const fee = proposal.signup_fee_cents;
  const total = money(proposal.total_cents);
  return (
    <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">Reactivation</p>
      {proposal.plan_changed && (
        <p className="text-[11px] text-slate-500">Switching from {proposal.previous_plan} to {proposal.plan}.</p>
      )}
      {proposal.free ? (
        <p className="mt-1 text-sm text-slate-800">
          Restart your <span className="font-semibold">{proposal.plan}</span> plan{" "}
          <span className="font-semibold text-emerald-600">for free</span> — you&apos;re still within your billing period, so there&apos;s no charge.
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-800">
          Restart on <span className="font-semibold">{proposal.plan}</span>? First charge is{" "}
          <span className="font-semibold">{money(proposal.monthly_cents)}</span>
          {fee > 0 ? (
            <>
              {" "}+ <span className="font-semibold">{money(fee)}</span> sign-up fee
            </>
          ) : null}{" "}
          = <span className="font-semibold">{total}</span>.
        </p>
      )}

      {state === "pending" && (
        <div className="mt-2 flex gap-2">
          <button onClick={onConfirm} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark">
            {proposal.free ? "Reactivate for free" : `Pay ${total} & reactivate`}
          </button>
          <button onClick={onDecline} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50">
            Not now
          </button>
        </div>
      )}
      {state === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">
          ✓ Reactivated on {proposal.plan}{proposal.free ? " (free)" : ` — ${total} charged`}.
        </p>
      )}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — your subscription stays cancelled.</p>}
      {state === "error" && <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t reactivate — please try again.</p>}
    </div>
  );
}

function PlanCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: PlanChangeProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const p = proposal.proration_cents;
  const weeks = `${proposal.weeks_until_billing} week${proposal.weeks_until_billing === 1 ? "" : "s"}`;
  const proration =
    p > 0
      ? `You'll be charged ${money(p)} now (prorated for the ${weeks} until billing).`
      : p < 0
        ? `You'll be refunded ${money(-p)} (prorated for the ${weeks} until billing).`
        : "No proration is due this cycle.";
  return (
    <div data-testid="plan-card" className="mt-3 rounded-lg border border-teal-200 bg-teal-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-700">Plan change</p>
      <p className="mt-1 text-sm text-slate-800">
        Switch{proposal.current_plan ? ` from ${proposal.current_plan}` : ""} to{" "}
        <span className="font-semibold">{proposal.plan}</span> at <span className="font-semibold">{money(proposal.monthly_cents)}/month</span>?
      </p>
      {proposal.weekly_savings_cents != null && proposal.weekly_savings_cents > 0 && (
        <p className="mt-1 text-xs text-emerald-600">
          That&apos;s <span className="font-medium">{money(proposal.weekly_savings_cents)}/week</span> less than buying those meals à la carte.
        </p>
      )}
      <p className="mt-1 text-xs text-slate-500">{proration} Your new plan starts next week.</p>

      {state === "pending" && (
        <div className="mt-2 flex gap-2">
          <button onClick={onConfirm} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark">
            Yes, switch plan
          </button>
          <button onClick={onDecline} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50">
            Not now
          </button>
        </div>
      )}
      {state === "approved" && <p className="mt-2 text-xs font-medium text-emerald-700">✓ Plan changed to {proposal.plan} ({money(proposal.monthly_cents)}/month).</p>}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem — your plan is unchanged.</p>}
      {state === "error" && <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t change the plan — please try again.</p>}
    </div>
  );
}

function CancelCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: CancelProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const billing = fmtDate(proposal.billing_date);
  return (
    <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-700">Cancel subscription</p>
      <p className="mt-1 text-sm text-slate-800">Cancel your subscription? Future boxes will stop.</p>
      <p className="mt-1 text-xs text-slate-500">
        Heads up: if you resubscribe after your billing date{billing ? ` (${billing})` : ""}, a{" "}
        <span className="font-medium">{money(proposal.signup_fee_cents)}</span> sign-up fee applies. Resubscribe before then on the same plan and it&apos;s free.
      </p>

      {state === "pending" && (
        <div className="mt-2 flex gap-2">
          <button onClick={onConfirm} className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-700">
            Yes, cancel
          </button>
          <button onClick={onDecline} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50">
            Keep my subscription
          </button>
        </div>
      )}
      {state === "approved" && <p className="mt-2 text-xs font-medium text-slate-700">✓ Subscription cancelled.</p>}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-emerald-700">Great — your subscription is unchanged.</p>}
      {state === "error" && <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t cancel — please try again.</p>}
    </div>
  );
}

function DietCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: DietChangeProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  return (
    <div data-testid="diet-card" className="mt-3 rounded-lg border border-lime-200 bg-lime-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-lime-700">Dietary track</p>
      <p className="mt-1 text-sm text-slate-800">
        Switch from <span className="font-semibold">{proposal.current_track}</span> to{" "}
        <span className="font-semibold">{proposal.new_track}</span> meals?
      </p>
      {proposal.meals_preview.length > 0 && (
        <p className="mt-1 text-xs text-slate-600">For example: {proposal.meals_preview.join(", ")}.</p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        Free to switch. It applies from next week&apos;s menu ({fmtDate(proposal.effective_from)}); boxes already on
        their way keep the meals they were packed with.
      </p>

      {state === "pending" && (
        <div className="mt-2 flex gap-2">
          <button onClick={onConfirm} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark">
            Yes, switch my meals
          </button>
          <button onClick={onDecline} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50">
            Not now
          </button>
        </div>
      )}
      {state === "approved" && <p className="mt-2 text-xs font-medium text-emerald-700">✓ Switched to {proposal.new_track} meals from next week.</p>}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem - your meals are unchanged.</p>}
      {state === "error" && <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t switch your meals - please try again.</p>}
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
    ["Dietary track", c.dietaryTrack],
    ["Subscription", c.subscriptionStatus],
    ["Next billing", fmtDate(c.billingDate)],
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
