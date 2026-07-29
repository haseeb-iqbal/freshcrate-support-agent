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

/** The ISO date N months after `from`. JS clamps overflow (Jan 31 + 1mo becomes
 *  Mar 3), which matches how reconcile rolls a billing date. */
export function addMonthsIso(months: number, from: Date): string {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return toIsoDate(d);
}

/** The ISO date N days after `from` (negative goes back). */
export function addDaysIso(days: number, from: Date): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** 1 -> "st", 2 -> "nd", 3 -> "rd", everything else -> "th". 11-13 are the
 *  exceptions: they take "th" despite ending in 1, 2 and 3. */
function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return "th";
  if (day % 10 === 1) return "st";
  if (day % 10 === 2) return "nd";
  if (day % 10 === 3) return "rd";
  return "th";
}

/**
 * Long-form display date: "8th January 2026".
 *
 * Used in prose - proposal card sentences, the account panel, and the agent's
 * own answers - where a bare DD-MM-YYYY reads as a code rather than a day.
 * Dense list rows keep the compact form. The numeric form is deliberately NOT
 * appended in brackets: repeating the same date twice reads as clutter.
 *
 * Parses the ISO string textually rather than via `new Date(iso)`, which would
 * treat a date-only string as UTC midnight and shift the day at a negative
 * offset. That is the same trap `toIsoDate` exists to avoid.
 */
export function formatLongDate(iso?: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, year, month, day] = m;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return iso;
  const dayNum = Number(day);
  return `${dayNum}${ordinalSuffix(dayNum)} ${monthName} ${year}`;
}
