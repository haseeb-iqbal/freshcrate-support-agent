import { describe, expect, it } from "vitest";
import { addWeeksIso, toIsoDate } from "./date";

/**
 * These assertions are timezone-independent by construction: `new Date(y, m, d)`
 * builds a local instant and `toIsoDate` formats on the local calendar, so the
 * expected string never depends on TZ. That is the whole point - the helper it
 * replaces did depend on TZ.
 */
describe("toIsoDate", () => {
  it("formats a local calendar day", () => {
    expect(toIsoDate(new Date(2026, 6, 21))).toBe("2026-07-21");
  });

  it("zero-pads the month and day", () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("keeps the local day for a midnight instant", () => {
    // toISOString() rolls this back a day at any positive UTC offset.
    expect(toIsoDate(new Date(2026, 6, 21, 0, 0))).toBe("2026-07-21");
  });

  it("keeps the local day for a late-evening instant", () => {
    // toISOString() rolls this forward a day at any negative UTC offset.
    expect(toIsoDate(new Date(2026, 6, 21, 23, 30))).toBe("2026-07-21");
  });

  it("handles a year boundary from both sides of midnight", () => {
    expect(toIsoDate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
    expect(toIsoDate(new Date(2027, 0, 1, 0, 1))).toBe("2027-01-01");
  });
});

describe("addWeeksIso", () => {
  it("adds whole weeks", () => {
    expect(addWeeksIso(2, new Date(2026, 6, 21))).toBe("2026-08-04");
  });

  it("crosses a month boundary", () => {
    expect(addWeeksIso(1, new Date(2026, 6, 28))).toBe("2026-08-04");
  });

  it("crosses a year boundary", () => {
    expect(addWeeksIso(1, new Date(2026, 11, 29))).toBe("2027-01-05");
  });

  it("does not roll the day for a late-evening instant", () => {
    expect(addWeeksIso(2, new Date(2026, 6, 21, 23, 30))).toBe("2026-08-04");
  });

  it("does not roll the day for a midnight instant", () => {
    expect(addWeeksIso(2, new Date(2026, 6, 21, 0, 0))).toBe("2026-08-04");
  });

  it("does not mutate the date it is given", () => {
    const from = new Date(2026, 6, 21);
    addWeeksIso(4, from);
    expect(toIsoDate(from)).toBe("2026-07-21");
  });
});
