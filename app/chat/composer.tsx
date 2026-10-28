"use client";

/** The message box and Send button. Enter sends; Shift+Enter adds a line. */
export function Composer({
  input,
  busy,
  onInput,
  onSend,
}: {
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
      className="flex items-end gap-2 border-t border-slate-200 py-3"
    >
      <textarea
        value={input}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSend(input);
          }
        }}
        rows={1}
        placeholder="Ask about an order, pausing, a refund, or any policy…"
        className="min-h-[44px] flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none"
      />
      <button
        type="submit"
        disabled={busy || !input.trim()}
        className="h-[44px] rounded-lg bg-brand px-4 text-sm font-medium text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "…" : "Send"}
      </button>
    </form>
  );
}
