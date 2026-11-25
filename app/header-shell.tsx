"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A page header that stays one row tall on a phone: the brand on the left and a
 * Menu button that opens the rest (links, account controls) as a panel below.
 * From md up the menu content sits inline and the button is hidden. Escape or a
 * click outside closes the open menu.
 */
export function HeaderShell({ brand, children }: { brand: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header ref={ref} className="relative border-b border-mist bg-paper">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-x-8 px-4 py-2 sm:px-6 md:flex-wrap md:py-2.5">
        {brand}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="header-menu"
          className="flex min-h-[44px] items-center gap-2 rounded-lg border border-mist bg-white px-3 text-[15px] font-bold md:hidden"
        >
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
          Menu
        </button>
        <div
          id="header-menu"
          className={
            (open ? "flex" : "hidden") +
            " absolute inset-x-0 top-full z-20 flex-col items-start gap-4 border-b border-mist bg-paper px-4 pb-5 pt-3 shadow-lg" +
            " md:static md:z-auto md:flex md:flex-1 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-8 md:gap-y-3 md:border-0 md:p-0 md:shadow-none"
          }
        >
          {children}
        </div>
      </div>
    </header>
  );
}
