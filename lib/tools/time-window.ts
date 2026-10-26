import { addDaysIso, toIsoDate } from "../date";

export interface TimeWindow {
  /** Inclusive ISO YYYY-MM-DD bounds. */
  from: string;
  to: string;
  /** The customer's own words, for the reply. */
  phrase: string;
}

/**
 * The time the customer pinned an order to ("my order from last week"), if they
 * did. Deliberately small: only phrases with an unambiguous reading. "Last week"
 * is the 7 days up to today, the same reading the system prompt gives the model.
 */
export function timeWindow(message: string, now: Date): TimeWindow | null {
  const today = toIsoDate(now);
  if (/\blast week\b/i.test(message)) return { from: addDaysIso(-7, now), to: today, phrase: "last week" };
  if (/\byesterday\b/i.test(message)) return { from: addDaysIso(-1, now), to: addDaysIso(-1, now), phrase: "yesterday" };
  return null;
}
