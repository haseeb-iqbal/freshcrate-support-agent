/**
 * Whether a message is a QUESTION about an account action - "how much does
 * pausing cost?", "if I cancel, do my boxes stop right away?" - rather than a
 * request to take it.
 *
 * gpt-4o-mini answers these with a pause or cancel confirmation card, or from
 * the live subscription instead of the knowledge base. The agent loop uses this
 * to drop an action proposal made for such a question and to steer the model to
 * search_knowledge_base. Every pattern needs a "?" so a polite request that
 * opens with "if" ("if you could pause my plan that'd be great") is not caught,
 * and billing-amount questions ("how much is my next bill after pausing?") are
 * excluded because those are answered from get_subscription.
 */

const BILLING_AMOUNT = /\b(?:bill|invoice|balance)\b/i;

const PATTERNS = [
  // Hypothetical: "if I cancel, ...?", "what happens if I pause?"
  /^\s*(?:if|what (?:happens|would happen|if))\b/i,
  // Cost of an action: "how much does pausing cost?", "how much is the cancel fee?"
  /\bhow much\b[^?.!]*\b(?:cost|fee|charge|paus\w*|cancel\w*|reactivat\w*|resum\w*)\b/i,
  // "what's the pause fee?", "is there a charge to reactivate?"
  /\b(?:what(?:'s|’s| is| are)|is there)\b[^?.!]*\b(?:fee|charge|cost)\b/i,
  // How an action works: "how do refunds work?", "how does pausing work?"
  /\bhow (?:do|does|would)\b[^?.!]*\b(?:refund\w*|paus\w*|cancel\w*|reactivat\w*|resum\w*)\b[^?.!]*\bwork\b/i,
  // The policy itself: "what's your refund policy?"
  /\b(?:refund|cancell?ation|pause|pausing)s? polic(?:y|ies)\b/i,
];

export function isActionQuestion(text: string): boolean {
  if (!text.includes("?") || BILLING_AMOUNT.test(text)) return false;
  return PATTERNS.some((p) => p.test(text));
}

/** "can I add a Mango Lassi to my next box?" - a question about the menu, not an action. */
export function isAddRequest(text: string): boolean {
  return text.includes("?") && /\b(?:can|could|may) (?:i|we)\b[^?.!]*\badd\b/i.test(text);
}

/**
 * A question on a topic the knowledge base covers but the model tends to wave
 * off as out of scope ("can I get a discount code?", "how long do the proteins
 * last in the fridge?", "I'm moving to Alaska, what happens?"). The scope rule
 * makes gpt-4o-mini refuse these without searching. Needs a "?" and skips
 * attempts to override the instructions.
 */
const COMPANY_TOPICS =
  /\b(?:discount|coupon|promo\w*|voucher|fridge|refrigerat\w*|freezer|storage|spoil\w*|expir\w*|moving|relocat\w*|move to|recycl\w*|packaging|allerg\w*|calor\w*|nutrition\w*|serving\w*|vegan|keto|paleo|halal|kosher)\b/i;
const OVERRIDE_ATTEMPT = /\b(?:ignore|disregard)\b[^?.!]*\binstructions\b|\byou are now\b|\bsystem prompt\b/i;

export function isCompanyTopicQuestion(text: string): boolean {
  return text.includes("?") && COMPANY_TOPICS.test(text) && !OVERRIDE_ATTEMPT.test(text);
}

/** A track or diet word, in the customer's message or the assistant's offer it answers. */
const TRACK_WORDS = /\b(?:vegetarian|gluten[- ]?free|dairy[- ]?free|standard|vegan|diet|dietary|track|menu)\b/i;

/**
 * Whether switching dietary track is something the conversation is actually
 * about. The model reads "can I add a Mango Lassi?" as a wish for the
 * Vegetarian track and proposes a switch; a real request names a track or diet,
 * or answers an offer that did ("yes, switch me").
 */
export function mentionsDietaryTrack(history: { role: "user" | "assistant"; content: string }[]): boolean {
  const lastOf = (role: "user" | "assistant", before = history.length) => {
    for (let i = before - 1; i >= 0; i--) if (history[i].role === role) return i;
    return -1;
  };
  const user = lastOf("user");
  if (user < 0) return false;
  if (TRACK_WORDS.test(history[user].content)) return true;
  const offer = lastOf("assistant", user);
  return offer >= 0 && TRACK_WORDS.test(history[offer].content);
}
