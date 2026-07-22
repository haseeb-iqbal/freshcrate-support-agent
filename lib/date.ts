/**
 * Local-calendar date formatting - the single home for it.
 *
 * Deliberately NOT `toISOString().slice(0, 10)`: that formats in UTC, so at a
 * positive UTC offset an instant near midnight renders as the PREVIOUS day (and
 * at a negative offset, an evening instant renders as the next one). Every date
 * this app shows or stores (billing dates, pause resume dates, the day a refund
 * happened) is a local calendar day, so it must be formatted on the local
 * calendar. `lib/billing/reconcile.ts` has always done this; everywhere else
 * drifted.
 */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The ISO date N weeks after `from`. Used for a pause's resume date. */
export function addWeeksIso(weeks: number, from: Date): string {
  const d = new Date(from);
  d.setDate(d.getDate() + weeks * 7);
  return toIsoDate(d);
}

/** The ISO date N days after `from` (negative goes back). */
export function addDaysIso(days: number, from: Date): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}
