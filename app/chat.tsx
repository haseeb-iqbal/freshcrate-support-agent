"use client";

import { useEffect, useRef, useState } from "react";
import { collectDecisions } from "@/lib/decisions";
import { Composer } from "./chat/composer";
import { ChatHeader } from "./chat/header";
import { MessageBubble } from "./chat/message-bubble";
import { AccountPanel, Welcome } from "./chat/panels";
import { toDecisionSources } from "./chat/decisions";
import { PROPOSALS, lockPendingProposals, setProposalEntryState } from "./chat/proposals";
import { applyStreamEvent, parseSseEvent, updateLast } from "./chat/stream";
import type { AccountData, CustomerOption, Message, ProposalKind, ProposalState } from "./chat/types";

export type { CustomerOption } from "./chat/types";

export default function Chat({ customers: initialCustomers }: { customers: CustomerOption[] }) {
  const [customers, setCustomers] = useState(initialCustomers);
  const [customerId, setCustomerId] = useState(initialCustomers[0]?.id ?? "");
  const [messages, setMessages] = useState<Message[]>([]);
  // One id per chat session, so the traces log can group a conversation's turns.
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [account, setAccount] = useState<AccountData | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Keys of confirm requests currently in flight, so a double-click on a card's
  // Confirm button cannot fire the write endpoint twice.
  const confirming = useRef<Set<string>>(new Set());

  const activeCustomer = customers.find((c) => c.id === customerId);
  function startNewChat() {
    if (busy) return;
    setMessages([]);
    setInput("");
    setShowAccount(false);
    setConversationId(crypto.randomUUID());
  }

  function switchCustomer(id: string) {
    if (busy) return;
    setCustomerId(id);
    setMessages([]);
    setInput("");
    setConversationId(crypto.randomUUID());
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

  function setProposalState(index: number, kind: ProposalKind, entryIndex: number, state: ProposalState) {
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, proposals: setProposalEntryState(m.proposals, kind, entryIndex, state) } : m)),
    );
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

  // Apply a proposal: the write happens here (server endpoint), never in the
  // agent loop. Guarded so a double-click can't post the write twice, and only a
  // still-pending prompt acts - a resolved card is inert. The card flips to
  // `submitting` for the duration (buttons disable, confirm reads "Processing…")
  // so the customer can't fire it twice and can see it is working.
  async function confirmProposal(index: number, kind: ProposalKind, entryIndex: number) {
    const key = `${index}:${kind}:${entryIndex}`;
    if (confirming.current.has(key)) return;
    const entry = messages[index]?.proposals?.[kind]?.[entryIndex];
    if (!entry || entry.state !== "pending") return;
    confirming.current.add(key);
    setProposalState(index, kind, entryIndex, "submitting");
    try {
      const { endpoint, body, refreshesCustomers } = PROPOSALS[kind];
      const ok = await postAction(endpoint, { customerId, ...body(entry.data) });
      setProposalState(index, kind, entryIndex, ok ? "approved" : "error");
      if (ok && refreshesCustomers) refreshCustomers();
    } finally {
      confirming.current.delete(key);
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // The home route renders both the chat and the account panel, so the tab title
  // follows the visible view rather than the route.
  useEffect(() => {
    document.title = showAccount ? "My Account · FreshCrate" : "FreshCrate Support";
  }, [showAccount]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");
    setShowAccount(false);

    // Sending a message answers no prompt: lock any still-pending one so its
    // buttons disable (the customer has moved on). Decisions are read from the
    // locked view so the model is told these were passed over, not left waiting
    // on a prompt whose buttons no longer work.
    const lockedMessages = messages.map(lockPending);
    const history: Message[] = [...lockedMessages, { role: "user", content: question }];
    setMessages([...history, { role: "assistant", content: "", sources: [], steps: [] }]);
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          conversationId,
          messages: history.map(({ role, content }) => ({ role, content })),
          decisions: collectDecisions(lockedMessages.flatMap(toDecisionSources)),
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
        for (const raw of events) {
          const parsed = parseSseEvent(raw);
          if (parsed) setMessages((prev) => applyStreamEvent(prev, parsed.event, parsed.data));
        }
      }
      await refreshCustomers();
    } catch (err) {
      patchLast({ content: `Sorry — connection error: ${err instanceof Error ? err.message : "unknown"}.` });
    } finally {
      setBusy(false);
    }
  }

  function patchLast(patch: Partial<Message>) {
    setMessages((prev) => updateLast(prev, (m) => ({ ...m, ...patch })));
  }


  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col px-4">
      <ChatHeader
        customers={customers}
        customerId={customerId}
        busy={busy}
        showAccount={showAccount}
        hasMessages={messages.length > 0}
        onToggleAccount={() => setShowAccount((v) => !v)}
        onNewChat={startNewChat}
        onSwitchCustomer={switchCustomer}
      />

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
                onConfirm={(kind, entryIndex) => confirmProposal(i, kind, entryIndex)}
                onDecline={(kind, entryIndex) => setProposalState(i, kind, entryIndex, "declined")}
              />
            ))}
          </>
        )}
      </div>

      <Composer input={input} busy={busy} onInput={setInput} onSend={send} />
    </div>
  );
}

/** Disable any still-pending prompt on a message; unchanged messages keep their
 *  reference so React skips re-rendering them. */
function lockPending(m: Message): Message {
  const proposals = lockPendingProposals(m.proposals);
  return proposals === m.proposals ? m : { ...m, proposals };
}

