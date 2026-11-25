"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface AboutTab {
  /** Used in the URL hash, e.g. /about#built. */
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Accessible tabs for the About page: one panel visible at a time, arrow keys
 * (and Home/End) move between tabs, and the selected tab lives in the URL hash
 * so it can be linked to and survives a reload. Every panel is rendered on the
 * server; the unselected ones are just hidden.
 */
export function AboutTabs({ tabs }: { tabs: AboutTab[] }) {
  const [selected, setSelected] = useState(tabs[0].id);
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const fromHash = (scroll: boolean) => {
      const id = window.location.hash.slice(1);
      if (!tabs.some((t) => t.id === id)) return;
      setSelected(id);
      if (scroll) listRef.current?.scrollIntoView({ block: "start" });
    };
    fromHash(false);
    // In-page links such as the hero's "Take the 3-minute tour" change the hash.
    const onHash = () => fromHash(true);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [tabs]);

  function select(id: string, focus = false) {
    setSelected(id);
    // replaceState, not location.hash: no history entry per click and no jump.
    window.history.replaceState(null, "", `#${id}`);
    if (focus) tabRefs.current[id]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.findIndex((t) => t.id === selected);
    const next =
      e.key === "ArrowRight" ? (i + 1) % tabs.length
      : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    select(tabs[next].id, true);
  }

  return (
    <div className="border-t border-mist pt-4">
      <div
        ref={listRef}
        role="tablist"
        aria-label="About this demo"
        onKeyDown={onKeyDown}
        className="-mx-4 flex scroll-mt-4 gap-1 overflow-x-auto overflow-y-hidden border-b border-mist px-4 sm:mx-0 sm:px-0"
      >
        {tabs.map((t) => {
          const isSelected = t.id === selected;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={isSelected}
              aria-controls={`panel-${t.id}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => select(t.id)}
              className={
                "-mb-px whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2.5 font-display text-[15px] font-bold transition " +
                (isSelected ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink")
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`panel-${t.id}`}
          aria-labelledby={`tab-${t.id}`}
          hidden={t.id !== selected}
          tabIndex={0}
          className="rounded py-5"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
