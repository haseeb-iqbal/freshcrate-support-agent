/**
 * The invariant: the model must never *say* it performed (or will perform) an
 * account action without calling the tool that actually proposes it. That is a
 * property of the ASSISTANT's reply, not of the customer's phrasing — guessing
 * intent from the user's words both over- and under-fires ("what's in the 3-meal
 * plan?" is not an action; "I'm going away for a month" is).
 */

/** First-person commitment, or passive "it's done" framing. */
const CLAIM_MARKER =
  /\b(?:i've|i have|i'll|i will|i'm going to|i am going to|let me|gone ahead|gone ahead and|has been|have been|is now|are now)\b/i;

/** State-changing actions the model may only ever propose via a tool. */
const ACTION_TARGET = /\b(?:paus|resum|re-?activat|cancell?|refund)\w*/i;

/** Plan changes are only an action when a plan is actually the object. */
const PLAN_CHANGE = /\b(?:chang|switch|upgrad|downgrad|mov)\w*\b[^.!?]{0,40}\bplans?\b/i;

/** True if a sentence both commits to something and names an account action. */
function claimsStateChange(text: string): boolean {
  for (const sentence of text.split(/[.!?\n]+/)) {
    if (!CLAIM_MARKER.test(sentence)) continue;
    if (ACTION_TARGET.test(sentence) || PLAN_CHANGE.test(sentence)) return true;
  }
  return false;
}

/** Nudge once when the model described an account action instead of calling its tool. */
export function shouldNudge(o: { assistantText: string; toolCallCount: number; alreadyNudged: boolean }): boolean {
  return !o.alreadyNudged && o.toolCallCount === 0 && claimsStateChange(o.assistantText);
}
