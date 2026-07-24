/// <reference types="cypress" />

import { ask, signInAs } from "../helpers";

describe("FreshCrate agent (mock LLM)", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("answers a menu question from the knowledge base, with a source", () => {
    // "plan" here means the dietary track, not the meals-per-week plan. The
    // agent must search the KB rather than answer from get_subscription, which
    // knows the customer's track but nothing about what is on the menu.
    signInAs("Ava Chen");
    ask("what meals are in the standard plan");
    cy.get('[data-testid="assistant-text"]').should("contain.text", "Herb Roast Chicken");
    cy.get('[data-testid="assistant-text"]').should("contain.text", "Turkey Meatball Marinara Sub");
    cy.contains("a", "menu-and-dietary-tracks").should("exist");
  });

  it("positional order query answers one order, no history card", () => {
    signInAs("Marcus Bell");
    ask("where's my 2nd last order");
    cy.get('[data-testid="assistant-text"]').should("contain.text", "FC1005");
    // The status the reply states must be the status the order actually has.
    cy.get('[data-testid="assistant-text"]').should("contain.text", "shipped");
    cy.get('[data-testid="assistant-text"]').should("not.contain.text", "delivered");
    cy.get('[data-testid="history-card"]').should("not.exist");
  });

  it("order history shows the card and the reply text exactly once (no double text)", () => {
    signInAs("Marcus Bell");
    ask("show my order history");
    cy.get('[data-testid="assistant-text"]').should("have.text", "Here's your order history:");
    cy.get('[data-testid="assistant-text"]').should("not.contain.text", "Sure, let me pull that up");
    cy.get('[data-testid="history-card"]').should("exist");
  });

  it("pause shows a single pause card", () => {
    signInAs("Ava Chen");
    ask("pause my subscription for 2 weeks");
    cy.get('[data-testid="pause-card"]').should("have.length", 1);
    cy.get('[data-testid="assistant-text"]').should("contain.text", "confirm");
  });

  it("resume (paused customer) shows a single resume card", () => {
    signInAs("Diego Santos");
    ask("resume my subscription");
    cy.get('[data-testid="resume-card"]').should("have.length", 1);
    cy.get('[data-testid="assistant-text"]').should("contain.text", "confirm");
  });

  it("plan change while paused offers resume+switch instead of a plan card", () => {
    signInAs("Diego Santos");
    ask("switch me to the 4 meals/week plan");
    cy.get('[data-testid="plan-card"]').should("not.exist");
    cy.get('[data-testid="assistant-text"]').should("contain.text", "resume");
  });

  it("over-ceiling refund escalates instead of showing a refund card", () => {
    signInAs("Noah Patel");
    ask("refund my last order, it was damaged");
    cy.get('[data-testid="refund-card"]').should("not.exist");
    cy.get('[data-testid="assistant-text"]').should("contain.text", "escalated");
  });

  it("a second refund within the 14-day cooldown escalates instead of showing a card", () => {
    signInAs("Tom Becker");
    ask("refund my latest box, it arrived damaged");
    cy.get('[data-testid="refund-card"]').should("not.exist");
    cy.get('[data-testid="assistant-text"]').should("contain.text", "escalated");
  });

  it("a small first-time refund shows a single confirmation card", () => {
    signInAs("Priya Raman");
    ask("refund my delivered box, it was damaged");
    cy.get('[data-testid="refund-card"]').should("have.length", 1);
    cy.get('[data-testid="assistant-text"]').should("contain.text", "confirm");
  });

  it("off-topic question is refused with no tool activity", () => {
    signInAs("Ava Chen");
    ask("what's the capital of France?");
    cy.get('[data-testid="assistant-text"]').should("contain.text", "FreshCrate");
    cy.get('[data-testid="history-card"]').should("not.exist");
  });

  it("ambiguous cancel asks which order", () => {
    signInAs("Marcus Bell");
    ask("cancel my order");
    cy.get('[data-testid="assistant-text"]').should("contain.text", "which");
    cy.get('[data-testid="pause-card"]').should("not.exist");
  });

  it("a dietary-track switch shows a single confirmation card", () => {
    signInAs("Ava Chen");
    ask("switch me to vegetarian meals");
    cy.get('[data-testid="diet-card"]').should("have.length", 1);
    cy.get('[data-testid="diet-card"]').should("contain.text", "vegetarian");
    cy.contains("button", "Yes, switch my meals").should("exist");
  });
});
