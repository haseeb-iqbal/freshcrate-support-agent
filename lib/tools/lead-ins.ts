import { PAUSE_FEE_CENTS } from "../billing/pricing";
import type { PauseQuote, PlanChangeQuote, ReactivateQuote, ResumeQuote } from "../billing/quotes";
import { formatLongDate } from "../date";
import { money } from "../money";

/**
 * The sentence shown beside each confirmation card, in place of model text.
 *
 * The model kept rewriting "Here's the pause - confirm below" into "I've
 * initiated the pause" before anything had happened. Each propose tool now
 * returns its own lead-in, built from the same quote as the card, and the agent
 * loop sends it verbatim on a proposal turn. It states the figures the customer
 * is agreeing to and always ends by pointing at the card, never claiming the
 * action is done.
 */

const CONFIRM = "Please confirm below to go ahead.";

export function refundLeadIn(p: { order_number: string; amount_cents: number }): string {
  return `Here's a refund of ${money(p.amount_cents)} for order ${p.order_number}, back to your original payment method. ${CONFIRM}`;
}

export function pauseLeadIn(p: PauseQuote): string {
  const fee = `${money(PAUSE_FEE_CENTS)}/week`;
  if (p.indefinite) {
    return `Here's an indefinite pause from next week. Each paused week is billed at the ${fee} pause fee instead of your plan price, until you resume. ${CONFIRM}`;
  }
  const length = p.weeks ? `a ${p.weeks}-week pause` : "a pause";
  return `Here's ${length} from next week, resuming on ${formatLongDate(p.resume_date)}. Each paused week is billed at the ${fee} pause fee instead of your plan price. ${CONFIRM}`;
}

export function resumeLeadIn(p: ResumeQuote): string {
  const plan = p.plan_changed ? `on the ${p.plan} plan` : `on your ${p.plan} plan`;
  return `Here's your subscription resuming ${plan} from next week. Your next monthly bill will be ${money(p.next_bill_cents)}. ${CONFIRM}`;
}

export function reactivateLeadIn(p: ReactivateQuote): string {
  if (p.free) {
    return `Here's your ${p.plan} plan reactivated for free, because you're back on the same plan before your billing date. ${CONFIRM}`;
  }
  return `Here's your subscription reactivated on ${p.plan}: ${money(p.monthly_cents)} for the first month plus the ${money(p.signup_fee_cents)} sign-up fee, ${money(p.total_cents)} in total. ${CONFIRM}`;
}

export function planChangeLeadIn(p: PlanChangeQuote): string {
  const head = `Here's the switch to ${p.plan} (${money(p.monthly_cents)}/month).`;
  if (p.paused) {
    return `${head} Your subscription stays paused and nothing is charged now; the new plan's rate starts when you resume. ${CONFIRM}`;
  }
  const weeks = `${p.weeks_until_billing} week${p.weeks_until_billing === 1 ? "" : "s"} left until billing`;
  const proration =
    p.proration_cents > 0
      ? `You'll be charged ${money(p.proration_cents)} now for the ${weeks}.`
      : p.proration_cents < 0
        ? `You'll be refunded ${money(-p.proration_cents)} for the ${weeks}.`
        : "Nothing is prorated this cycle.";
  return `${head} ${proration} The new plan starts next week. ${CONFIRM}`;
}

export function cancelLeadIn(p: { billing_date: string | null; signup_fee_cents: number }): string {
  const until = p.billing_date ? `until your billing date on ${formatLongDate(p.billing_date)}` : "until your billing date";
  return `Here's the cancellation. Your boxes keep arriving ${until}, and you won't be charged after that. Reactivating later costs a ${money(p.signup_fee_cents)} sign-up fee plus the first month, unless you come back on the same plan before that date. ${CONFIRM}`;
}

export function dietLeadIn(p: { new_track: string; effective_from: string }): string {
  return `Here's the switch to the ${p.new_track} menu, starting with the week of ${formatLongDate(p.effective_from)}. Boxes already packed keep their meals. ${CONFIRM}`;
}
