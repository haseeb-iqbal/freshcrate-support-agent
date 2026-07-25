import { describe, expect, it } from "vitest";
import { shouldNudge } from "./nudge";

const nudge = (assistantText: string, over: Partial<Parameters<typeof shouldNudge>[0]> = {}) =>
  shouldNudge({ assistantText, toolCallCount: 0, alreadyNudged: false, ...over });

describe("shouldNudge", () => {
  it("nudges when the model claims a completed action", () => {
    expect(nudge("I've paused your subscription until 12-08-2026.")).toBe(true);
  });

  it("nudges when the model promises an action instead of calling the tool", () => {
    expect(nudge("Sure — I'll cancel that order for you right now.")).toBe(true);
  });

  it("nudges on a reactivation claim", () => {
    expect(nudge("I have reactivated your subscription on the 3-meal plan.")).toBe(true);
  });

  it("nudges on a passive completion claim", () => {
    expect(nudge("Your refund has been processed.")).toBe(true);
  });

  it("nudges on a plan-change claim", () => {
    expect(nudge("I've switched you to the 4-meal plan.")).toBe(true);
  });

  it("nudges on a dietary-track switch claim", () => {
    expect(nudge("I've switched you to our vegetarian menu.")).toBe(true);
  });

  it("nudges on a dietary-track switch claim phrased as a move", () => {
    expect(nudge("I've moved you to the gluten-free track.")).toBe(true);
  });

  it("nudges on a passive dietary-track completion claim", () => {
    expect(nudge("You're now on the dairy-free menu.")).toBe(true);
  });

  it("does not nudge when the model asks the customer to confirm a dietary switch", () => {
    expect(nudge("Would you like me to switch you to the vegetarian menu?")).toBe(false);
  });

  it("does not nudge an informational answer about the same actions", () => {
    expect(nudge("You can pause your subscription for 1 to 12 weeks, or indefinitely.")).toBe(false);
  });

  it("does not nudge a clarifying question", () => {
    expect(nudge("Happy to help — which order would you like me to refund?")).toBe(false);
  });

  it("does not nudge an unrelated first-person sentence", () => {
    expect(nudge("I've found two orders that match — here they are.")).toBe(false);
  });

  it("does not nudge an off-topic refusal", () => {
    expect(nudge("I can only help with FreshCrate orders and subscriptions.")).toBe(false);
  });

  it("does not nudge when a tool was already called", () => {
    expect(nudge("I've paused your subscription.", { toolCallCount: 1 })).toBe(false);
  });

  it("never nudges twice", () => {
    expect(nudge("I've paused your subscription.", { alreadyNudged: true })).toBe(false);
  });
});
