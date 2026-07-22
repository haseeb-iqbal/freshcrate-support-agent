/// <reference types="cypress" />

// The four suggestion chips on an empty chat are the first thing a new viewer
// clicks, and MOCK_LLM matches on exact question text - so a reworded chip
// silently answers "(mock) No script for this input". These specs are read-only
// (no Confirm is clicked) and all use Marcus Bell, who has a processing order, a
// shipped one and two delivered ones.

import { EXAMPLE_PROMPTS } from "../../lib/example-prompts";
import { clickChip, expectScripted, signInAs } from "../helpers";

const [LATEST_ORDER, ORDER_HISTORY, PAUSE, REFUND] = EXAMPLE_PROMPTS;

describe("Empty-chat suggestion chips (mock LLM)", () => {
  beforeEach(() => {
    cy.visit("/");
    signInAs("Marcus Bell");
  });

  it("offers exactly the shared prompt list", () => {
    for (const prompt of EXAMPLE_PROMPTS) {
      cy.contains("button", prompt).should("exist");
    }
  });

  it("answers the latest-order chip with that order's real status", () => {
    clickChip(LATEST_ORDER);
    expectScripted();
    cy.get('[data-testid="assistant-text"]').should("contain.text", "FC1004");
    cy.get('[data-testid="assistant-text"]').should("contain.text", "processing");
    cy.get('[data-testid="assistant-text"]').should("not.contain.text", "delivered");
  });

  it("answers the order-history chip with the card and a one-line lead-in", () => {
    clickChip(ORDER_HISTORY);
    expectScripted();
    cy.get('[data-testid="history-card"]').should("exist");
    cy.get('[data-testid="assistant-text"]').should("have.text", "Here's your order history:");
  });

  it("answers the pause chip with a pause card", () => {
    clickChip(PAUSE);
    expectScripted();
    cy.get('[data-testid="pause-card"]').should("have.length", 1);
  });

  it("answers the refund chip with a refund card", () => {
    clickChip(REFUND);
    expectScripted();
    cy.get('[data-testid="refund-card"]').should("have.length", 1);
  });
});
