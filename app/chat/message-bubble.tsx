"use client";

import { Markdown } from "../markdown";
import { stripCitations } from "@/lib/markdown";
import { HistoryCard, OrderCard } from "./order-views";
import { Thinking, ToolSteps } from "./panels";
import { PROPOSAL_KINDS, PROPOSALS } from "./proposals";
import type { Message, ProposalKind } from "./types";

export function MessageBubble({
  message,
  streaming,
  paymentMethod,
  onConfirm,
  onDecline,
}: {
  message: Message;
  streaming: boolean;
  paymentMethod?: string | null;
  onConfirm: (kind: ProposalKind, entryIndex: number) => void;
  onDecline: (kind: ProposalKind, entryIndex: number) => void;
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
    !message.order &&
    !PROPOSAL_KINDS.some((kind) => message.proposals?.[kind]?.length);

  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          isUser
            ? "max-w-[80%] rounded-2xl rounded-br-[4px] bg-brand px-4 py-2.5 text-[15px] text-white"
            : "w-full max-w-[62ch] text-[15px] leading-relaxed text-ink"
        }
      >
        {showThinking && <Thinking />}

        {!isUser && message.steps && message.steps.length > 0 && <ToolSteps steps={message.steps} />}

        {message.content && (
          <div data-testid={isUser ? "user-text" : "assistant-text"}>
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <>
                <Markdown text={stripCitations(message.content)} streaming={streaming} />
                {streaming && <span className="ml-0.5 animate-pulse">▋</span>}
              </>
            )}
          </div>
        )}

        {!isUser && showResults && message.history && (
          <HistoryCard history={message.history} />
        )}

        {!isUser && showResults && message.order && <OrderCard order={message.order} />}

        {!isUser &&
          showResults &&
          PROPOSAL_KINDS.flatMap((kind) => {
            const entries = message.proposals?.[kind];
            if (!entries) return [];
            const Card = PROPOSALS[kind].card;
            return entries.map((entry, entryIndex) => (
              <Card
                key={`${kind}-${entryIndex}`}
                proposal={entry.data}
                state={entry.state}
                paymentMethod={paymentMethod}
                onConfirm={() => onConfirm(kind, entryIndex)}
                onDecline={() => onDecline(kind, entryIndex)}
              />
            ));
          })}

        {!isUser && showResults && message.sources && message.sources.length > 0 && (
          <div className="mt-2.5">
            <p className="mb-1 text-[13px] text-muted">Sources</p>
            <div className="flex flex-wrap gap-1.5">
              {message.sources.map((s, i) => (
                <a
                  key={i}
                  href={`/kb/${s.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the source article"
                  className="rounded-md border border-mist bg-paper px-2 py-0.5 text-[13px] text-brand transition hover:border-brand"
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
