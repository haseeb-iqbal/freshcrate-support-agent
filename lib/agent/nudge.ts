/**
 * The invariant: the model must never *say* it performed (or will perform) an
 * account action without calling the tool that actually proposes it. That is a
 * property of the ASSISTANT's reply, not of the customer's phrasing — guessing
 * intent from the user's words both over- and under-fires ("what's in the 3-meal
 * plan?" is not an action; "I'm going away for a month" is).
 */

/** First-person commitment, or passive "it's done" framing. */
const CLAIM_MARKER =
  /\b(?:i've|i have|i'll|i will|i'm going to|i am going to|i can proceed|i'll initiate|i will initiate|let me|gone ahead|gone ahead and|has been|have been|is now|are now|you're now|you are now)\b/i;

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

/**
 * A "confirm the prompt" cue strong enough to check across the WHOLE reply, not
 * just per-sentence. The model often splits the offer from the confirm ("Would
 * you like to change to gluten-free again? Please confirm to proceed!"), so the
 * cue and the action target land in different sentences. These phrasings only
 * make sense when a real confirmation prompt exists; if the reply names an action
 * anywhere and no tool was called, the prompt it points at is imaginary. Excludes
 * a bare "propose" (which also appears in refusals like "I can't propose a refund
 * above the ceiling") - that stays a per-sentence signal.
 */
const CONFIRM_CUE = /\b(?:please confirm|proceed with|go ahead with)\b/i;

/** State-changing actions the model may only ever propose via a tool. */
const ACTION_TARGET = /\b(?:paus|resum|re-?activat|cancell?|refund)\w*/i;

/** Plan changes are only an action when a plan is actually the object. */
const PLAN_CHANGE = /\b(?:chang|switch|upgrad|downgrad|mov)\w*\b[^.!?]{0,40}\bplans?\b/i;

/** Dietary-track switch: a track word and a diet noun in either order in one sentence. */
const DIETARY_TRACK =
  /\b(?:vegetarian|gluten-free|dairy-free|standard)\b[^.!?]{0,30}\b(?:menu|track|meals?|diet)\b|\b(?:menu|track|meals?|diet)\b[^.!?]{0,30}\b(?:vegetarian|gluten-free|dairy-free|standard)\b/i;

/**
 * A change VERB governing a diet word ("change/switch/move to gluten-free",
 * "initiate the change to the vegetarian menu"). The verb must PRECEDE the diet
 * word, so the noun phrase "the gluten-free switch" (a mention of a past prompt,
 * not a fresh action) does NOT match and "I've noted the gluten-free switch"
 * stays quiet.
 */
const DIET_ACTION = /\b(?:switch|chang|mov|initiat|updat|put)\w*\b[^.!?]{0,25}\b(?:vegetarian|gluten-free|dairy-free|standard)\b/i;

/**
 * The model claims a confirmation prompt is being shown ("I'll show you the
 * confirmation prompt now"). No tool call means no such prompt, so this is always
 * an empty promise - a target in its own right, whatever action it is about.
 */
const SHOW_PROMPT = /\b(?:show|shown|showing|bring up|pull up|display|re-?show)\w*\b[^.!?]{0,30}\b(?:prompt|confirmation|card)\b/i;

/** Does this fragment name an account action the model may only surface via a tool? */
function namesAction(fragment: string): boolean {
  return (
    ACTION_TARGET.test(fragment) ||
    PLAN_CHANGE.test(fragment) ||
    DIETARY_TRACK.test(fragment) ||
    DIET_ACTION.test(fragment) ||
    SHOW_PROMPT.test(fragment)
  );
}

/** True if a sentence commits to (or proposes) something and names an account action. */
function claimsStateChange(text: string): boolean {
  // Per-sentence for commitment/proposal markers: the marker and the action must
  // co-occur in ONE sentence, so a first-person marker and an unrelated target in
  // separate sentences don't false-fire.
  for (const sentence of text.split(/[.!?\n]+/)) {
    if (!CLAIM_MARKER.test(sentence) && !PROPOSE_MARKER.test(sentence)) continue;
    if (namesAction(sentence)) return true;
  }
  // Message-level for a "please confirm …" cue split from its action, which only
  // makes sense when a real prompt exists (see CONFIRM_CUE).
  if (CONFIRM_CUE.test(text) && namesAction(text)) return true;
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
