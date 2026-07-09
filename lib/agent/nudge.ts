/** Words that signal the customer is asking for an account action. */
export const ACTION_INTENT =
  /\b(re-?activat|resume|un-?pause|pause|cancel|refund|switch|change|plan|subscribe|sign-?up|restart)\b/i;

/** Nudge once when an action was requested but the model answered without a tool. */
export function shouldNudge(o: { userText: string; toolCallCount: number; alreadyNudged: boolean }): boolean {
  return !o.alreadyNudged && o.toolCallCount === 0 && ACTION_INTENT.test(o.userText);
}
