import { describe, expect, it } from "vitest";
import { citationLabel } from "./ground";

describe("citationLabel", () => {
  it("joins the slug and heading with the citation separator", () => {
    // The separator is U+203A. If this fails on that character, check ground.ts
    // rather than editing it here: the label is what the chat UI renders as a
    // source chip and what the system prompt tells the model to cite.
    expect(citationLabel({ articleSlug: "delivery-schedule", heading: "How to cancel" })).toBe(
      "delivery-schedule › How to cancel",
    );
  });

  it("is stable for equal inputs, so it can be used as a label key", () => {
    const chunk = { articleSlug: "refunds", heading: "Timing" };
    expect(citationLabel(chunk)).toBe(citationLabel({ ...chunk }));
  });
});
