import { describe, expect, it } from "vitest";
import { isPureDecline } from "./decline";

describe("isPureDecline", () => {
  it("matches bare refusals in any case, with trailing punctuation", () => {
    for (const t of ["no", "No", "NAH", "nope", "not now", "No thanks.", "nevermind!", "stop", "maybe later…"]) {
      expect(isPureDecline(t)).toBe(true);
    }
  });

  it("normalises curly apostrophes and missing ones", () => {
    expect(isPureDecline("I’m good")).toBe(true);
    expect(isPureDecline("im good")).toBe(true);
  });

  it("does NOT match a request that merely starts with a negative", () => {
    for (const t of ["no, make it 4 weeks", "not now but pause next month", "no thanks, cancel instead", "stop my subscription"]) {
      expect(isPureDecline(t)).toBe(false);
    }
  });

  it("does NOT match unrelated messages", () => {
    for (const t of ["what's my next bill?", "pause for 3 weeks", "yes", "ok do it"]) {
      expect(isPureDecline(t)).toBe(false);
    }
  });
});
