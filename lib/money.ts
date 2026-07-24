/**
 * Currency formatting - the single home for it.
 *
 * Every amount in this app is stored and passed around as integer cents. The
 * `$${(cents / 100).toFixed(2)}` expression had been written out separately in
 * the chat UI and in four tool files, so a change to how money reads (currency
 * symbol, separators, locale) had five places to miss.
 *
 * Deliberately not `Intl.NumberFormat`: the UI, the tool summaries the customer
 * sees, and the tests all assume the plain `$0.00` form, and swapping in a
 * locale-aware formatter would change rendered output rather than centralise it.
 */
export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
