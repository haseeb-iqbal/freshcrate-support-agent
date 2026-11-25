"use client";

import Link from "next/link";
import { HeaderShell } from "../header-shell";
import { SiteNav } from "../site-nav";
import type { CustomerOption } from "./types";

/**
 * The home page's top bar: the title, the page links, the account toggle,
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
  return (
    <HeaderShell
      brand={
        <Link
          href="/about"
          title="About this demo"
          className="whitespace-nowrap rounded text-left font-display text-[17px] font-extrabold tracking-tight text-brand transition hover:text-brand-dark sm:text-[18px]"
        >
          FreshCrate support
        </Link>
      }
    >
          <SiteNav current="home" />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onToggleAccount}
            className={
              "btn " + (showAccount ? "btn-primary" : "btn-secondary")
            }
          >
            {showAccount ? "Chat" : "My Account"}
          </button>
          {hasMessages && (
            <button
              onClick={onNewChat}
              disabled={busy}
              className="btn btn-secondary"
            >
              + New chat
            </button>
          )}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-[13px] text-muted">Signed in as</span>
            <select
              // The wrapping <label> already associates the text, but because
              // the <select> sits inside it, the label's text content pulls in
              // every option too. An explicit name keeps it short and the same
              // across assistive technologies.
              aria-label="Signed in as customer"
              value={customerId}
              onChange={(e) => onSwitchCustomer(e.target.value)}
              disabled={busy}
              className="min-h-[36px] rounded-lg border border-[#C9D6CE] bg-white px-2 text-[13px] text-ink focus:border-brand disabled:opacity-50"
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
