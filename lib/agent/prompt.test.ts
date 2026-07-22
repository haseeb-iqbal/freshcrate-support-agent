import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt";
import { RULES } from "@/lib/domain/terms";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt();

  it("embeds the canonical scoping, refund-ceiling, and injection rules verbatim", () => {
    expect(prompt).toContain(RULES.scope);
    expect(prompt).toContain(RULES.refundCeiling);
    expect(prompt).toContain(RULES.injection);
    expect(prompt).toContain(RULES.offTopic);
  });

  it("tells the model to report an order status verbatim", () => {
    // Without this the model infers delivery from a past delivery date and tells
    // customers a shipped box has arrived.
    expect(prompt).toContain(RULES.orderStatus);
  });

  it("names the confirmation tools and the search tool", () => {
    for (const t of ["search_knowledge_base", "lookup_order", "list_orders", "get_subscription", "issue_refund", "escalate_to_human"]) {
      expect(prompt).toContain(t);
    }
  });

  it("embeds the canonical pricing and fee rules verbatim", () => {
    // Replaces a `toContain("call the")` check so loose it survived almost any
    // rewrite. Asserting the RULES constants keeps prompt and tools in step.
    expect(prompt).toContain(RULES.subscriptionFree);
    expect(prompt).toContain(RULES.refundAmount);
    expect(prompt).toContain(RULES.feeRefund);
  });
});
