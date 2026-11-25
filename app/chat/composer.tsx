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
      className="flex items-end gap-2 border-t border-mist p-3"
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
        placeholder="Ask Cratelyn anything"
        className="min-h-[40px] min-w-0 flex-1 resize-none rounded-lg border border-[#C9D6CE] px-3 py-2 text-sm text-ink placeholder:text-[#6B7B73] focus:border-brand"
      />
      <button
        type="submit"
        disabled={busy || !input.trim()}
        className="btn btn-primary h-[40px] px-4"
      >
        {busy ? "…" : "Send"}
      </button>
    </form>
  );
}
