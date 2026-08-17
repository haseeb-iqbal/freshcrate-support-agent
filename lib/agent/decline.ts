/**
 * Whether a message is ONLY a refusal or acknowledgement of a prompt - "no",
 * "nah", "not now" and the like - with no request riding along.
 *
 * gpt-4o-mini treats "a pause was declined" as licence to re-offer it, so after
 * the customer types "nah" to a pause prompt it re-calls pause_subscription and
 * re-announces it. The agent loop uses this to deterministically drop a proposal
 * the customer just declined in words, regardless of what the model does.
 *
 * Matched strictly against the WHOLE normalised message, so a request that only
 * starts with a negative - "no, make it 4 weeks" - is NOT a pure decline and
 * still gets through.
 */

const DECLINES = new Set([
  "no",
  "nah",
  "nope",
  "naw",
  "no thanks",
  "no thank you",
  "not now",
  "not right now",
  "not yet",
  "nevermind",
  "never mind",
  "stop",
  "leave it",
  "forget it",
  "skip it",
  "no need",
  "maybe later",
  "i'm good",
  "im good",
  "no i'm good",
  "nah i'm good",
]);

export function isPureDecline(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[‘’´`]/g, "'") // curly / accented apostrophes → straight
    .replace(/[.!?,…]+$/g, "") // trailing punctuation / ellipsis
    .replace(/\s+/g, " ")
    .trim();
  return DECLINES.has(normalized);
}
