import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt";
import { RULES } from "@/lib/domain/terms";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(new Date("2026-07-25T00:00:00"));

  it("tells the model today's date so it can resolve relative dates", () => {
    expect(prompt).toContain("# Today");
    expect(prompt).toContain("25th July 2026");
  });

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

  it("tells the model the knowledge base covers the menu", () => {
    // Without this the model treats "what meals are on the standard menu" as
    // outside the KB's remit, calls NO tool at all, and answers "I don't have
    // that information" - even though retrieval would have found the menu.
    const knowledge = prompt.slice(prompt.indexOf("# Knowledge answers"));
    expect(knowledge.toLowerCase()).toContain("menu");
    expect(knowledge.toLowerCase()).toContain("meals");
  });

  it("tells the model to present, not refuse, a broad 'show me all the meals' request", () => {
    // The bug: the model called search (retrieval returned menus) but still led
    // with "I can't provide the meals" and gave a partial list, or refused.
    const diet = prompt.slice(prompt.indexOf("# Dietary tracks"), prompt.indexOf("# Actions need a tool call"));
    expect(diet.toLowerCase()).toContain("whole menu");
    expect(diet).toContain("offer to show any one track's full menu");
    expect(diet).toContain(`Never open with "I can't provide"`);
  });

  it("tells the model to present nutrition figures as a table, not deflect", () => {
    // The bug: asked for the gluten-free track "with the nutrition", the model
    // showed meals then deflected ("check the recipe card in your account")
    // instead of rendering the per-serving nutrition table the KB holds.
    const diet = prompt.slice(prompt.indexOf("# Dietary tracks"), prompt.indexOf("# Actions need a tool call"));
    expect(diet.toLowerCase()).toContain("nutrition");
    expect(diet).toContain("Calories | Protein | Carbs | Fat");
    expect(diet).toContain("Do NOT deflect");
  });

  it("distinguishes a plan (meals per week) from a track (the diet)", () => {
    // Customers say "the standard plan" when they mean the standard TRACK; the
    // word "plan" otherwise routes the model to get_subscription, which knows
    // nothing about what is on the menu.
    expect(prompt).toContain("standard plan");
    expect(prompt).toContain("get_subscription");
  });

  it("treats a question about an action as a knowledge question, not a request", () => {
    // The bug: "how much does pausing cost?" and "if I cancel, do my boxes stop?"
    // were answered with a pause / cancel confirmation card.
    const knowledge = prompt.slice(prompt.indexOf("# Knowledge answers"), prompt.indexOf("# Orders"));
    expect(knowledge).toContain("is a knowledge question, not a request to act");
    expect(knowledge).toContain("call NO action tool");
    expect(knowledge).toContain("billed MONTHLY");
  });

  it("names the order number in prose and uses lookup_order for a named order", () => {
    // The bug: "refund it" after "and the one before that?" refunded another
    // order, because the prose answer never carried the order number.
    const orders = prompt.slice(prompt.indexOf("# Orders"), prompt.indexOf("# Subscription"));
    expect(orders).toContain("always name its order number");
    expect(orders).toContain("never list_orders");
    expect(orders).toContain("couldn't find that order");
  });

  it("answers what resuming costs from resume_quote, and refuses a box that is not late yet", () => {
    const sub = prompt.slice(prompt.indexOf("# Subscription"), prompt.indexOf("# Dietary tracks"));
    expect(sub).toContain("resume_quote");
    expect(sub).toContain("never with the stay-paused next_bill_cents");
    const refunds = prompt.slice(prompt.indexOf("# Refunds"), prompt.indexOf("# Ambiguity"));
    expect(refunds).toContain("not_yet_due");
  });

  it("does not pick a nearby order when the customer's time reference matches none", () => {
    const orders = prompt.slice(prompt.indexOf("# Orders"), prompt.indexOf("# Subscription"));
    expect(orders).toContain("If no order matches that time");
    expect(orders).toContain("do NOT pick a nearby one");
  });

  it("looks up the customer's own meal before answering a nutrition question about their box", () => {
    const diet = prompt.slice(prompt.indexOf("# Dietary tracks"), prompt.indexOf("# Actions need a tool call"));
    expect(diet).toContain("THEIR OWN box");
    expect(diet).toContain("never list the whole menu for it");
  });

  it("keeps the model from offering add-ons from another track or waiving fees", () => {
    const diet = prompt.slice(prompt.indexOf("# Dietary tracks"), prompt.indexOf("# Actions need a tool call"));
    expect(diet).toContain("OWN track's menu");
    expect(diet).toContain("never say \"yes\" or offer to add it");
    const refunds = prompt.slice(prompt.indexOf("# Refunds"), prompt.indexOf("# Ambiguity"));
    expect(refunds).toContain("cannot waive, discount or adjust");
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

  it("embeds the canonical dietary-track rule verbatim", () => {
    // Without this the model never learns the four tracks, the halal position,
    // or that a Standard-track meal carries no gluten-free/dairy-free guarantee.
    expect(prompt).toContain(RULES.dietary);
  });

  it("embeds the canonical date-format rule and no longer says DD-MM-YYYY", () => {
    // The old Style line told the model to print bare DD-MM-YYYY dates.
    expect(prompt).toContain(RULES.dateFormat);
    expect(prompt).not.toContain("Dates shown to customers use DD-MM-YYYY");
  });

  it("forbids inline citations instead of demanding them", () => {
    // The sources are shown as links below the reply; a bracketed label in the
    // prose is duplication the customer did not ask for.
    expect(prompt).toContain(RULES.citations);
    expect(prompt).not.toContain("Cite inline");
    expect(prompt).not.toContain("pause-resume › How pausing works");
  });

  it("tells the model how to use the confirmation-outcome note", () => {
    expect(prompt).toContain("# Confirmation outcomes");
    expect(prompt).toContain("already confirmed");
  });

  it("permits re-proposing an action the customer previously declined", () => {
    // The bug: after a customer declined (or moved past) a dietary-track switch,
    // the model invented a "declined means can't request again" rule and refused
    // to propose a different track. Declining is "not now", not "never".
    const outcomes = prompt.slice(prompt.indexOf("# Confirmation outcomes"), prompt.indexOf("# Refunds"));
    expect(outcomes.toLowerCase()).toContain("declined");
    expect(outcomes.toLowerCase()).toContain("propose it again");
  });

  it("treats a terse refusal like 'nah' as a stop, not a re-proposal cue", () => {
    // The bug: after the customer typed "nah" to a pause prompt, the model
    // re-called pause_subscription and re-announced "I've initiated the pause".
    const outcomes = prompt.slice(prompt.indexOf("# Confirmation outcomes"), prompt.indexOf("# Refunds"));
    expect(outcomes).toContain("nah");
    expect(outcomes.toLowerCase()).toContain("call no action tool");
  });

  it("introduces itself as Cratelyn", () => {
    expect(prompt).toContain("You are Cratelyn");
  });

  it("routes subscription/plan pricing to the knowledge base, not get_subscription", () => {
    // The bug: "what are the subscription costs?" got treated as an account
    // question, routed to get_subscription (which has no pricing), and refused.
    const knowledge = prompt.slice(prompt.indexOf("# Knowledge answers"), prompt.indexOf("# Orders"));
    expect(knowledge.toLowerCase()).toContain("cost");
    expect(knowledge.toLowerCase()).toContain("pricing");
  });

  it("tells the model never to repeat a prior refusal without searching", () => {
    // The bug: after refusing once, the model anchored on its own refusal and
    // repeated it on later turns without ever calling search_knowledge_base again.
    expect(prompt).toContain("search_knowledge_base");
    expect(prompt.toLowerCase()).toContain("even if an earlier");
  });

  it("routes a next-bill-amount question to get_subscription's exact figure", () => {
    // The bug: asked "what will my next bill be", the model had no figure (the
    // tool didn't return one) so it waffled, or re-fired pause_subscription.
    const sub = prompt.slice(prompt.indexOf("# Subscription"), prompt.indexOf("# Dietary tracks"));
    expect(sub).toContain("next_bill_cents");
    expect(sub.toLowerCase()).toContain("next bill");
    // Must not answer a billing-amount question by re-proposing the pause/resume.
    expect(sub).toContain("never re-call pause_subscription or resume_subscription");
  });

  it("does not let a pending confirmation prompt block an unrelated question", () => {
    // The bug: an unanswered confirmation prompt made the model refuse to
    // answer an unrelated pricing/order/policy question asked in the same turn.
    const outcomes = prompt.slice(prompt.indexOf("# Confirmation outcomes"), prompt.indexOf("# Refunds"));
    expect(outcomes.toLowerCase()).toContain("never blocks other questions");
  });
});
