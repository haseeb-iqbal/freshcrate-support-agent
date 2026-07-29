import { describe, expect, it } from "vitest";
import { addWeeksIso, formatLongDate, toIsoDate } from "./date";

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

describe("formatLongDate", () => {
  it("formats an ISO date as the long form with no bracketed numeric form", () => {
    expect(formatLongDate("2026-01-08")).toBe("8th January 2026");
  });

  it("uses st, nd and rd for 1, 2 and 3", () => {
    expect(formatLongDate("2026-03-01")).toBe("1st March 2026");
    expect(formatLongDate("2026-03-02")).toBe("2nd March 2026");
    expect(formatLongDate("2026-03-03")).toBe("3rd March 2026");
  });

  it("uses th for the 11th, 12th and 13th, which are the exceptions to the rule", () => {
    expect(formatLongDate("2026-03-11")).toBe("11th March 2026");
    expect(formatLongDate("2026-03-12")).toBe("12th March 2026");
    expect(formatLongDate("2026-03-13")).toBe("13th March 2026");
  });

  it("uses st, nd and rd again in the twenties and thirties", () => {
    expect(formatLongDate("2026-03-21")).toBe("21st March 2026");
    expect(formatLongDate("2026-03-22")).toBe("22nd March 2026");
    expect(formatLongDate("2026-03-23")).toBe("23rd March 2026");
    expect(formatLongDate("2026-03-31")).toBe("31st March 2026");
  });

  it("names every month correctly at both ends of the year", () => {
    expect(formatLongDate("2026-01-15")).toContain("January");
    expect(formatLongDate("2026-12-15")).toContain("December");
  });

  it("ignores a time suffix on the ISO string", () => {
    // Tool results sometimes carry a full timestamp; only the calendar day matters.
    expect(formatLongDate("2026-01-08T23:30:00Z")).toBe("8th January 2026");
  });

  it("returns an empty string for a missing date", () => {
    expect(formatLongDate(null)).toBe("");
    expect(formatLongDate(undefined)).toBe("");
    expect(formatLongDate("")).toBe("");
  });

  it("returns the input unchanged when it is not an ISO date", () => {
    expect(formatLongDate("next Tuesday")).toBe("next Tuesday");
  });
});
