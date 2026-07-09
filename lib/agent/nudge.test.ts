import { describe, expect, it } from "vitest";
import { shouldNudge } from "./nudge";

describe("shouldNudge", () => {
  it("nudges when an action was requested but no tool was called", () => {
    expect(shouldNudge({ userText: "pause my subscription", toolCallCount: 0, alreadyNudged: false })).toBe(true);
  });
  it("does not nudge non-action questions", () => {
    expect(shouldNudge({ userText: "what is the capital of France?", toolCallCount: 0, alreadyNudged: false })).toBe(false);
  });
  it("does not nudge when a tool was already called", () => {
    expect(shouldNudge({ userText: "refund my box", toolCallCount: 1, alreadyNudged: false })).toBe(false);
  });
  it("never nudges twice", () => {
    expect(shouldNudge({ userText: "cancel my plan", toolCallCount: 0, alreadyNudged: true })).toBe(false);
  });
});
