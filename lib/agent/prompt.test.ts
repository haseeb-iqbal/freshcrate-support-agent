import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt";
import { RULES } from "@/lib/domain/terms";

/**
 * What the prompt must always contain. Its wording is free to change: the real
 * check on how the model behaves is the eval suite (npm run eval), so these
 * tests pin only the facts and guardrails that must never drop out.
 */
describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(new Date("2026-07-25T00:00:00"));

  it("tells the model today's date so it can resolve relative dates", () => {
    expect(prompt).toContain("25th July 2026");
  });

  it("keeps the scope, off-topic and injection guardrails verbatim", () => {
    expect(prompt).toContain(RULES.scope);
    expect(prompt).toContain(RULES.offTopic);
    expect(prompt).toContain(RULES.injection);
  });

  it("keeps the citation rule: no sources inside the answer text", () => {
    expect(prompt).toContain(RULES.citations);
  });

  it("keeps the money and order rules the tools rely on", () => {
    expect(prompt).toContain(RULES.refundCeiling);
    expect(prompt).toContain(RULES.feeRefund);
    expect(prompt).toContain(RULES.orderStatus);
    expect(prompt).toContain(RULES.dietary);
    expect(prompt).toContain(RULES.dateFormat);
  });
});
