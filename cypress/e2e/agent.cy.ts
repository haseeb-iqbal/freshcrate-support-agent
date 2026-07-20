/// <reference types="cypress" />

// Pick a signed-in customer by visible name in the header <select>.
function signInAs(name: string) {
  cy.get("header select").find("option").contains(name).then(($opt) => {
    cy.get("header select").select($opt.val() as string);
  });
}

function ask(text: string) {
  cy.get("textarea").clear().type(text);
  cy.contains("button", "Send").click();
  // Wait until streaming finishes (Send button returns from "…").
  cy.contains("button", "Send", { timeout: 15000 }).should("exist");
}

describe("FreshCrate agent (mock LLM)", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("positional order query answers one order, no history card", () => {
    signInAs("Marcus Bell");
    ask("where's my 2nd last order");
    cy.get('[data-testid="assistant-text"]').should("contain.text", "FC1005");
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
});
