"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CustomerOption } from "./types";

/**
 * The chat page's top bar: title with the preview note, the account toggle,
 * "New chat", and the signed-in customer picker.
 */
export function ChatHeader({
  customers,
  customerId,
  busy,
  showAccount,
  hasMessages,
  onToggleAccount,
  onNewChat,
  onSwitchCustomer,
}: {
  customers: CustomerOption[];
  customerId: string;
  busy: boolean;
  showAccount: boolean;
  hasMessages: boolean;
  onToggleAccount: () => void;
  onNewChat: () => void;
  onSwitchCustomer: (id: string) => void;
}) {
  const [pinnedPreview, setPinnedPreview] = useState(false);
  const [hoveredPreview, setHoveredPreview] = useState(false);
  const [focusedPreview, setFocusedPreview] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  // The note opens on hover, on keyboard focus, or on a deliberate click. The
  // three signals are tracked separately so hovering away cannot dismiss a note
  // the customer clicked open, and so a click while it is already showing can
  // close it - with one shared flag, focus from the click itself held it open.
  const showPreviewNote = pinnedPreview || hoveredPreview || focusedPreview;

  const closePreview = () => {
    setPinnedPreview(false);
    setHoveredPreview(false);
    setFocusedPreview(false);
  };

  // Dismiss the preview note on outside-click or Escape, however it was opened.
  useEffect(() => {
    if (!showPreviewNote) return;
    function onPointer(e: MouseEvent) {
      if (previewRef.current && !previewRef.current.contains(e.target as Node)) {
        closePreview();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePreview();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [showPreviewNote]);

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 py-4">
      <div>
        <div className="flex items-center gap-2">
          <button
            onClick={onNewChat}
            title="Back to start"
            className="text-left text-lg font-semibold text-brand transition hover:text-brand-dark"
          >
            FreshCrate Support
          </button>
          <div
            ref={previewRef}
            className="relative"
            onMouseEnter={() => setHoveredPreview(true)}
            onMouseLeave={() => setHoveredPreview(false)}
          >
            <button
              type="button"
              // Keyed on pinnedPreview, not showPreviewNote: hover and focus
              // both commit before the click fires, so reading the combined
              // flag here made the very first click close the note it was
              // meant to pin. Only a click can change pinnedPreview, so this
              // cannot race them.
              onClick={() => (pinnedPreview ? closePreview() : setPinnedPreview(true))}
              onFocus={() => setFocusedPreview(true)}
              onBlur={() => setFocusedPreview(false)}
              aria-expanded={showPreviewNote}
              aria-describedby={showPreviewNote ? "preview-note" : undefined}
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
              <div
                id="preview-note"
                role="tooltip"
                data-testid="preview-note"
                className="absolute left-0 top-full z-10 mt-1.5 w-64 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-lg"
              >
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
          onClick={onToggleAccount}
          className={
            "rounded-md border px-2.5 py-1 text-sm shadow-sm transition " +
            (showAccount
              ? "border-brand bg-brand text-white"
              : "border-slate-300 bg-white text-slate-600 hover:border-brand hover:text-brand")
          }
        >
          {showAccount ? "Chat" : "My Account"}
        </button>
        {hasMessages && (
          <button
            onClick={onNewChat}
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
            onChange={(e) => onSwitchCustomer(e.target.value)}
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
  );
}
