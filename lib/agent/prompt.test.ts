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

  it("names the confirmation tools and the search tool", () => {
    for (const t of ["search_knowledge_base", "lookup_order", "list_orders", "get_subscription", "issue_refund", "escalate_to_human"]) {
      expect(prompt).toContain(t);
    }
  });

  it("tells the model to call the tool (not describe) for actions", () => {
    expect(prompt.toLowerCase()).toContain("call the");
    expect(prompt).toContain("confirmation");
  });
});
