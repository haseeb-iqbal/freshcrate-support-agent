"use client";

import type { RefObject } from "react";

/** The message box and Send button. Enter sends; Shift+Enter adds a line. */
export function Composer({
  inputRef,
  input,
  busy,
  onInput,
  onSend,
}: {
  inputRef?: RefObject<HTMLTextAreaElement>;
  input: string;
  busy: boolean;
  onInput: (value: string) => void;
  onSend: (text: string) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSend(input);
      }}
      className="flex items-end gap-2.5 border-t border-mist p-3.5"
    >
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend(input);
          }
        }}
        rows={1}
        aria-label="Message"
        placeholder="Ask about an order, a refund or a policy"
        className="min-h-[48px] min-w-0 flex-1 resize-none rounded-[10px] border border-[#C9D6CE] px-3.5 py-3 text-[15px] text-ink placeholder:text-[#6B7B73] focus:border-brand"
      />
      <button
        type="submit"
        disabled={busy || !input.trim()}
        className="h-[48px] rounded-[10px] bg-brand px-5 text-[15px] font-bold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "…" : "Send"}
      </button>
    </form>
  );
}
