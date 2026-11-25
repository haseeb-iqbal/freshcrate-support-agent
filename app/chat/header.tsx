"use client";

import { HeaderShell } from "../header-shell";
import { SiteNav } from "../site-nav";
import { useEffect, useRef, useState } from "react";
import type { CustomerOption } from "./types";

/**
 * The home page's top bar: title with the preview note, the page links, the
 * account toggle, "New chat", and the signed-in customer picker.
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
    <HeaderShell
      brand={
          <div className="flex items-center gap-2">
            <button
              onClick={onNewChat}
              title="Back to start"
              className="whitespace-nowrap rounded text-left font-display text-[19px] font-extrabold tracking-tight text-brand transition hover:text-brand-dark sm:text-[21px]"
            >
              FreshCrate support
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
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition " +
                  (showPreviewNote
                    ? "border-brand bg-brand/5 text-brand"
                    : "border-mist bg-white text-muted hover:border-brand hover:text-brand")
                }
              >
                <span aria-hidden className="text-[12px] leading-none">ⓘ</span>
                <span className="sr-only sm:not-sr-only">Preview</span>
              </button>
              {showPreviewNote && (
                <div
                  id="preview-note"
                  role="tooltip"
                  data-testid="preview-note"
                  className="absolute left-0 top-full z-10 mt-1.5 w-64 rounded-lg border border-mist bg-white p-3 text-xs leading-relaxed text-muted shadow-lg"
                >
                  An evolving demo - some features are still on the way, so you
                  may spot the occasional rough edge.
                </div>
              )}
            </div>
          </div>
      }
    >
          <SiteNav current="home" />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onToggleAccount}
            className={
              "min-h-[40px] rounded-lg border px-3 text-sm transition " +
              (showAccount
                ? "border-brand bg-brand text-white"
                : "border-mist bg-white text-ink hover:border-brand hover:text-brand")
            }
          >
            {showAccount ? "Chat" : "My Account"}
          </button>
          {hasMessages && (
            <button
              onClick={onNewChat}
              disabled={busy}
              className="min-h-[40px] rounded-lg border border-mist bg-white px-3 text-sm text-ink transition hover:border-brand hover:text-brand disabled:opacity-50"
            >
              + New chat
            </button>
          )}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Signed in as</span>
            <select
              // The wrapping <label> already associates the text, but because
              // the <select> sits inside it, the label's text content pulls in
              // every option too. An explicit name keeps it short and the same
              // across assistive technologies.
              aria-label="Signed in as customer"
              value={customerId}
              onChange={(e) => onSwitchCustomer(e.target.value)}
              disabled={busy}
              className="min-h-[40px] rounded-lg border border-mist bg-white px-2 text-sm text-ink focus:border-brand disabled:opacity-50"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}, {c.subscriptionStatus}
                </option>
              ))}
            </select>
          </label>
        </div>
    </HeaderShell>
  );
}
