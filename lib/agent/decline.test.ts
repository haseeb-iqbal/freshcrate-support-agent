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

  it("matches a refusal behind a hesitation word or with a trailing thanks", () => {
    for (const t of ["actually no", "Actually, no.", "oh wait, never mind", "on second thought, no", "hmm not now", "no thanks!", "nah, thank you"]) {
      expect(isPureDecline(t)).toBe(true);
    }
  });

  it("matches a \"don't\" aimed at the action on screen", () => {
    for (const t of ["don't", "please don't", "no, don't pause it", "no don't do that", "Don't cancel it.", "do not refund it", "dont do it"]) {
      expect(isPureDecline(t)).toBe(true);
    }
  });

  it("matches a change of mind", () => {
    for (const t of ["I changed my mind", "changed my mind", "I've changed my mind", "scratch that", "I don't want that"]) {
      expect(isPureDecline(t)).toBe(true);
    }
  });

  it("does NOT match a refusal that carries a new request", () => {
    for (const t of [
      "actually, pause for 4 weeks",
      "actually make it 3 weeks",
      "don't pause it, cancel it instead",
      "no, don't pause it - cancel my subscription",
      "I changed my mind, refund the other order",
      "don't charge me the fee",
    ]) {
      expect(isPureDecline(t)).toBe(false);
    }
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
