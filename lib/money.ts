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
 * A whole number of dollars drops its decimals, so a round fee reads as `$8`
 * rather than `$8.00`. Anything with cents keeps BOTH places, so a meal is
 * `$17.50` and not `$17.5` - half-written cents look like a rendering fault on
 * a price.
 *
 * `toFixed(2)` does the non-whole case rather than any trimming, because
 * dividing by 100 leaves binary floating-point noise: 1015 cents is
 * 10.149999999999999, which must still render as `$10.15`.
 */
export function money(cents: number): string {
  const value = cents / 100;
  return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
}
