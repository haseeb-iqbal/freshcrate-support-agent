/**
 * The single source of "now" for the whole app.
 *
 * Every time-dependent rule (weeks-to-billing, pause auto-resume, the refund
 * cooldown) reads the clock through here rather than calling `new Date()`, so
 * that a later "skip forward to date" demo can move time by swapping one value
 * instead of touching each rule. Tests pin it the same way.
 *
 * The clock is deliberately GLOBAL, not per-customer: the demo advances time for
 * the whole world at once, so a value set by one request is correct for every
 * other request in the process.
 */

let override: (() => Date) | null = null;

/** Current instant - real time unless a clock has been pinned. */
export function now(): Date {
  return override ? override() : new Date();
}

/** Pin the clock (tests, and later the simulated-date feature). `null` restores real time. */
export function setClock(fn: (() => Date) | null): void {
  override = fn;
}
