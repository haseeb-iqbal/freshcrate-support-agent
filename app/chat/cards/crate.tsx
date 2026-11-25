"use client";

import type { ReactNode } from "react";
import type { ProposalState } from "../types";

/**
 * The shared frame of every confirmation card, styled like a crate label: a
 * kraft border, the title over a dashed rule, then the card's own details.
 *
 * Confirming is the page's one motion moment: the border and rule turn leaf
 * green and a soft ring appears, so the change reads as done. The transition is
 * dropped for people who ask for reduced motion.
 */
export function CrateCard({
  testId,
  title,
  state,
  children,
}: {
  testId?: string;
  title: string;
  state: ProposalState;
  children: ReactNode;
}) {
  const approved = state === "approved";
  const frame = approved
    ? "border-brand shadow-[0_0_0_4px_#DDEFE9]"
    : state === "declined"
      ? "border-mist"
      : "border-kraft";
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className={`mt-3 max-w-md rounded-md border-2 bg-white text-ink transition-[border-color,box-shadow] duration-300 ease-out motion-reduce:transition-none ${frame}`}
    >
      <div className="flex items-center gap-2.5 border-b-2 border-dashed border-inherit px-3.5 py-2">
        {approved ? (
          <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-brand">
            <circle cx="12" cy="12" r="9" />
            <path d="M8 12.5l2.7 2.7L16 9.5" />
          </svg>
        ) : (
          <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-kraft-dark">
            <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
            <path d="M3 7l9 4 9-4" />
            <path d="M12 11v10" />
          </svg>
        )}
        <h3 className="font-display text-[15px] font-bold tracking-tight">{title}</h3>
      </div>
      <div className="px-3.5 pb-3 pt-2.5 text-sm leading-[1.45]">{children}</div>
    </section>
  );
}

/** A label/value table inside a crate card. */
export function CrateFacts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-[18px] gap-y-1.5">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The outcome line under a card once it is no longer waiting on the customer. */
export function CrateOutcome({ tone, children }: { tone: "done" | "neutral" | "error"; children: ReactNode }) {
  const color = tone === "done" ? "text-brand" : tone === "error" ? "text-red-700" : "text-muted";
  return (
    <p role="status" className={`mt-2.5 font-bold ${color}`}>
      {children}
    </p>
  );
}
