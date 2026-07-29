/**
 * The invariant: the model must never *say* it performed (or will perform) an
 * account action without calling the tool that actually proposes it. That is a
 * property of the ASSISTANT's reply, not of the customer's phrasing — guessing
 * intent from the user's words both over- and under-fires ("what's in the 3-meal
 * plan?" is not an action; "I'm going away for a month" is).
 */

/** First-person commitment, or passive "it's done" framing. */
const CLAIM_MARKER =
  /\b(?:i've|i have|i'll|i will|i'm going to|i am going to|let me|gone ahead|gone ahead and|has been|have been|is now|are now|you're now|you are now)\b/i;

/**
 * Proposal framing: the model asserts a concrete action is on the table and
 * points the customer at a confirmation ("I can propose a refund of $17.50 —
 * please confirm to proceed"). Without a tool call there is no prompt to confirm,
 * so this is the same failure as a completion claim. Deliberately does NOT
 * include "would you like me to …", which is an offer to be answered next turn,
 * not a claim that a prompt already exists. A legitimate "please confirm below"
 * only follows a real tool call, and shouldNudge's actionToolCallCount guard
 * keeps that case from firing.
 */
const PROPOSE_MARKER = /\b(?:propose|please confirm|proceed with|go ahead with)\b/i;

/** State-changing actions the model may only ever propose via a tool. */
const ACTION_TARGET = /\b(?:paus|resum|re-?activat|cancell?|refund)\w*/i;

/** Plan changes are only an action when a plan is actually the object. */
const PLAN_CHANGE = /\b(?:chang|switch|upgrad|downgrad|mov)\w*\b[^.!?]{0,40}\bplans?\b/i;

/** Dietary-track switches are only an action when a track is actually the object. */
const DIETARY_TRACK = /\b(?:vegetarian|gluten-free|dairy-free|standard)\b[^.!?]{0,20}\b(?:menu|track|meals?|diet)\b/i;

/** True if a sentence commits to (or proposes) something and names an account action. */
function claimsStateChange(text: string): boolean {
  for (const sentence of text.split(/[.!?\n]+/)) {
    if (!CLAIM_MARKER.test(sentence) && !PROPOSE_MARKER.test(sentence)) continue;
    if (ACTION_TARGET.test(sentence) || PLAN_CHANGE.test(sentence) || DIETARY_TRACK.test(sentence)) return true;
  }
  return false;
}

/**
 * Nudge once when the model described an account action instead of calling its
 * tool.
 *
 * `actionToolCallCount` counts ONLY the action tools that surface a confirmation
 * prompt (refund, pause, resume, …) — never read-only lookups. A turn that calls
 * `lookup_order` to find a box and then merely *describes* a refund has made zero
 * action calls, so it must still be nudged into calling `issue_refund`. Counting
 * every tool here (as the loop once did) let exactly that case slip through: the
 * refund card never appeared, and the customer's "yes" landed on nothing.
 */
export function shouldNudge(o: { assistantText: string; actionToolCallCount: number; alreadyNudged: boolean }): boolean {
  return !o.alreadyNudged && o.actionToolCallCount === 0 && claimsStateChange(o.assistantText);
}
