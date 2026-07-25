"use client";

import { Markdown } from "../markdown";
import { stripCitations } from "@/lib/markdown";
import { HistoryCard } from "./order-views";
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
  onConfirm: (kind: ProposalKind) => void;
  onDecline: (kind: ProposalKind) => void;
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
    !PROPOSAL_KINDS.some((kind) => message.proposals?.[kind]);

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

        {!isUser &&
          showResults &&
          PROPOSAL_KINDS.map((kind) => {
            const entry = message.proposals?.[kind];
            if (!entry) return null;
            const Card = PROPOSALS[kind].card;
            return (
              <Card
                key={kind}
                proposal={entry.data}
                state={entry.state}
                paymentMethod={paymentMethod}
                onConfirm={() => onConfirm(kind)}
                onDecline={() => onDecline(kind)}
              />
            );
          })}

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
