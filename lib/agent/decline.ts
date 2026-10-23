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

/** Hesitation words that can open a refusal ("actually no", "oh wait, never mind"). */
const LEADING_FILLER = /^(?:(?:actually|oh|ah|um+|uh+|hmm+|wait|hold on|sorry|ok|okay|on second thought)\s+)+/;

/** Politeness that can close one ("nah, thank you"). */
const TRAILING_POLITE = /(?:\s+(?:thanks|thank you|please))+$/;

/**
 * "don't" aimed at the prompt on screen: "please don't", "no, don't pause it",
 * "do not refund it". The object is limited to a pronoun or the subscription,
 * so "don't charge me the fee" or "don't pause it, cancel it" still get through.
 */
const DONT =
  /^(?:(?:no|nah|nope)\s+)?(?:please\s+)?(?:don't|dont|do not)(?:\s+(?:do|pause|resume|cancel|refund|reactivate|change|switch|apply|confirm|process)(?:\s+(?:it|that|this|them|my subscription))?)?$/;

/** A change of mind with nothing riding along. */
const CHANGED_MIND = /^(?:(?:i|i've|i have)\s+)?changed my mind$|^scratch that$|^i don't want (?:it|that|this|to)$/;

export function isPureDecline(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[‘’´`]/g, "'") // curly / accented apostrophes → straight
    .replace(/[.!?,…]+/g, " ") // punctuation, anywhere: "actually, no." → "actually no"
    .replace(/\s+/g, " ")
    .trim()
    .replace(LEADING_FILLER, "")
    .replace(TRAILING_POLITE, "");
  return DECLINES.has(normalized) || DONT.test(normalized) || CHANGED_MIND.test(normalized);
}
