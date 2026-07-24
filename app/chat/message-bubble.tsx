"use client";

import { CancelCard, PauseCard, PlanCard, ReactivateCard, RefundCard, ResumeCard } from "./cards";
import { HistoryCard } from "./order-views";
import { Thinking, ToolSteps } from "./panels";
import type { Message } from "./types";

export function MessageBubble({
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
    !message.cancelProposal;

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
