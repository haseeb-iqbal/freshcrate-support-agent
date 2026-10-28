import { describe, expect, it } from "vitest";
import { addWeeksIso, formatLongDate, toIsoDate } from "./date";

/**
 * These assertions are timezone-independent by construction: `new Date(y, m, d)`
 * builds a local instant and `toIsoDate` formats on the local calendar, so the
 * expected string never depends on TZ. That is the whole point - the helper it
 * replaces did depend on TZ.
 */
describe("toIsoDate", () => {


  it("keeps the local day for a midnight instant", () => {
    // toISOString() rolls this back a day at any positive UTC offset.
    expect(toIsoDate(new Date(2026, 6, 21, 0, 0))).toBe("2026-07-21");
  });

});

describe("addWeeksIso", () => {


  it("crosses a year boundary", () => {
    expect(addWeeksIso(1, new Date(2026, 11, 29))).toBe("2027-01-05");
  });

});

describe("formatLongDate", () => {
  it("formats an ISO date as the long form with no bracketed numeric form", () => {
    expect(formatLongDate("2026-01-08")).toBe("8th January 2026");
  });

  it("uses th for the 11th, 12th and 13th, which are the exceptions to the rule", () => {
    expect(formatLongDate("2026-03-11")).toBe("11th March 2026");
    expect(formatLongDate("2026-03-12")).toBe("12th March 2026");
    expect(formatLongDate("2026-03-13")).toBe("13th March 2026");
  });

});
