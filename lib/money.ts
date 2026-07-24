/**
 * Currency formatting - the single home for it.
 *
 * Every amount in this app is stored and passed around as integer cents. The
 * `$${(cents / 100).toFixed(2)}` expression had been written out separately in
 * the chat UI and in four tool files, so a change to how money reads (currency
 * symbol, separators, locale) had five places to miss.
 *
 * Deliberately not `Intl.NumberFormat`: the UI, the tool summaries the customer
 * sees, and the tests all assume a plain `$`-prefixed decimal, and swapping in a
 * locale-aware formatter would change rendered output rather than centralise it.
 *
 * Trailing zeros are trimmed, so a round fee reads as `$8` rather than `$8.00`
 * and `$17.5` rather than `$17.50`. `toFixed(2)` still runs first: dividing by
 * 100 leaves binary floating-point noise (1015 cents is 10.149999999999999), and
 * rounding to two places before trimming is what keeps that out of the output.
 */
export function money(cents: number): string {
  return `$${Number((cents / 100).toFixed(2))}`;
}
