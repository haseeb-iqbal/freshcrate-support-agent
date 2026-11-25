"use client";

import Link from "next/link";
import { useState } from "react";
import { GITHUB_URL } from "../site-nav";
import { ALL_PROMPTS, FEATURE_GROUPS, STARTERS, type DemoPrompt } from "@/lib/demo-prompts";

const firstName = (name: string) => name.split(" ")[0];

/**
 * The "Try it" checklist and the "What it can do" groups beside the chat.
 * Picking a prompt signs in as its customer and fills the message box; the
 * parent tracks which ones were tried. On a phone the whole panel folds into a
 * "Things to try" button above the chat.
 */
export function TryPanel({
  tried,
  disabled,
  onPick,
  onReset,
}: {
  tried: ReadonlySet<string>;
  disabled: boolean;
  onPick: (prompt: DemoPrompt) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [phoneOpen, setPhoneOpen] = useState(false);
  const total = ALL_PROMPTS.length;
  const triedCount = ALL_PROMPTS.filter((p) => tried.has(p.id)).length;
  const allOpen = FEATURE_GROUPS.every((g) => open[g.id]);

  const pick = (p: DemoPrompt) => {
    setPhoneOpen(false);
    onPick(p);
  };

  return (
    <aside aria-label="Things to try" className="relative [grid-area:panel] lg:min-h-0 lg:overflow-y-auto lg:pr-2">
      <button
        type="button"
        onClick={() => setPhoneOpen((v) => !v)}
        aria-expanded={phoneOpen}
        aria-controls="try-panel-body"
        className="flex min-h-[52px] w-full items-center justify-between rounded-2xl border border-mist bg-white px-4 text-left font-bold lg:hidden"
      >
        <span>
          Things to try, {triedCount} of {total} tried
        </span>
        <Chevron open={phoneOpen} />
      </button>

      <div id="try-panel-body" data-testid="try-panel" className={
          // On a phone the panel opens as a scrolling layer over the chat, so
          // the chat keeps its full height. From lg up it is a plain column.
          `${phoneOpen ? "block" : "hidden"} absolute inset-x-0 top-full z-20 mt-2 max-h-[65dvh] space-y-8 overflow-y-auto rounded-2xl border border-mist bg-paper p-4 shadow-lg ` +
          "lg:static lg:mt-0 lg:block lg:max-h-none lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none"
        }>
        <section aria-labelledby="try-heading">
          <h2 id="try-heading" className="font-display text-[17px] font-extrabold tracking-tight">
            Try it
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            Pick an idea. It signs you in as the right sample customer and fills in the message.
          </p>
          <div className="mt-3.5 flex items-center gap-2.5">
            <div
              role="progressbar"
              aria-label="Ideas tried"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={triedCount}
              className="h-2 flex-1 overflow-hidden rounded-full bg-mist"
            >
              <div className="h-2 rounded-full bg-citrus transition-[width] motion-reduce:transition-none" style={{ width: `${(triedCount / total) * 100}%` }} />
            </div>
            <span className="whitespace-nowrap text-[13px] text-muted">
              {triedCount} of {total}
            </span>
          </div>
          <ul className="mt-3">
            {STARTERS.map((s) => {
              const done = tried.has(s.id);
              return (
                <li key={s.id} className="border-b border-mist">
                  <button
                    type="button"
                    onClick={() => pick(s)}
                    disabled={disabled}
                    aria-pressed={done}
                    title={`Signs you in as ${s.customer}`}
                    className="flex min-h-[56px] w-full items-start gap-3 rounded px-0.5 py-2.5 text-left transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Tick done={done} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold">{s.title}</span>
                      <span className="mt-0.5 block text-[13px] text-muted">
                        &ldquo;{s.text}&rdquo;, as {firstName(s.customer)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="features-heading">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="features-heading" className="font-display text-[15px] font-extrabold tracking-tight">
              What it can do
            </h2>
            <button
              type="button"
              onClick={() => setOpen(Object.fromEntries(FEATURE_GROUPS.map((g) => [g.id, !allOpen])))}
              className="rounded py-2 text-sm font-bold text-brand hover:text-brand-dark"
            >
              {allOpen ? "Close all" : "Open all"}
            </button>
          </div>
          <ul className="mt-1.5 border-t border-mist">
            {FEATURE_GROUPS.map((g) => {
              const isOpen = !!open[g.id];
              const done = g.prompts.filter((p) => tried.has(p.id)).length;
              return (
                <li key={g.id} className="border-b border-mist">
                  <h3>
                    <button
                      type="button"
                      onClick={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))}
                      aria-expanded={isOpen}
                      aria-controls={`group-${g.id}`}
                      className="flex min-h-[48px] w-full items-center gap-2.5 rounded px-0.5 py-2.5 text-left text-[15px] font-bold"
                    >
                      <Chevron open={isOpen} />
                      <span className="flex-1">{g.title}</span>
                      <span className="text-[13px] font-normal text-muted">
                        {done} of {g.prompts.length}
                      </span>
                    </button>
                  </h3>
                  {isOpen && (
                    <div id={`group-${g.id}`} className="pb-3.5 pl-7 pr-0.5">
                      <p className="mb-2.5 text-sm leading-relaxed text-muted">{g.body}</p>
                      <div className="flex flex-wrap gap-2">
                        {g.prompts.map((p) => {
                          const pDone = tried.has(p.id);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => pick(p)}
                              disabled={disabled}
                              aria-pressed={pDone}
                              title={`Signs you in as ${p.customer}`}
                              className={
                                "min-h-[40px] rounded-full border px-3.5 py-2 text-left text-sm transition hover:border-brand disabled:cursor-not-allowed disabled:opacity-60 " +
                                (pDone ? "border-citrus-dark bg-citrus-light" : "border-mist bg-white")
                              }
                            >
                              {p.text} <span className="text-muted">as {firstName(p.customer)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2.5 text-sm">
          <Link href="/dashboard" className="rounded text-brand underline underline-offset-4 hover:text-brand-dark">
            See what each chat costs
          </Link>
          <button
            type="button"
            onClick={onReset}
            disabled={disabled}
            title="Clears your ticks and the chat. Changes you confirmed stay in the sample data."
            className="rounded py-2 text-muted underline underline-offset-4 hover:text-ink disabled:opacity-50"
          >
            Reset demo
          </button>
        </div>
        <p className="border-t border-mist pt-4 text-[13px] leading-relaxed text-muted">
          Built by Haseeb Iqbal. 91 of 92 required test conversations pass with the real model, and a chat turn costs
          about $0.0016.{" "}
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="rounded text-brand underline underline-offset-4 hover:text-brand-dark">
            Code on GitHub
          </a>
        </p>
      </div>
    </aside>
  );
}

function Tick({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={
        "mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-[5px] border-2 " +
        (done ? "border-citrus-dark bg-citrus" : "border-[#8FA398] bg-white")
      }
    >
      {done && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5 9-10" />
        </svg>
      )}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`flex-none text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
