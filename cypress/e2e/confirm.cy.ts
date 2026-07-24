/// <reference types="cypress" />

// These specs WRITE to the database. `npm run test:e2e` runs db:reset first;
// running `npm run cypress` directly twice without a reseed will fail the refund
// spec, because the box is already refunded the second time.

import { ask, signInAs } from "../helpers";

describe("FreshCrate confirmation flow (mock LLM, mutates the DB)", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("confirming a pause applies it and reports it on the card", () => {
    signInAs("Ava Chen");
    ask("pause my subscription for 2 weeks");
    cy.get('[data-testid="pause-card"]').should("have.length", 1);

    cy.contains("button", "Yes, pause it").click();

    cy.get('[data-testid="pause-card"]').should("contain.text", "Paused");
    cy.contains("button", "Yes, pause it").should("not.exist");
  });

  it("declining a pause leaves the subscription unchanged", () => {
    signInAs("Jamal Wright");
    ask("pause my subscription for 2 weeks");
    cy.get('[data-testid="pause-card"]').should("have.length", 1);

    cy.contains("button", "Not now").click();

    cy.get('[data-testid="pause-card"]').should("contain.text", "unchanged");
    cy.contains("button", "Yes, pause it").should("not.exist");
  });

  it("confirming a refund initiates it and reports the amount", () => {
    signInAs("Priya Raman");
    ask("refund my delivered box, it was damaged");
    cy.get('[data-testid="refund-card"]').should("have.length", 1);

    cy.contains("button", "Yes, refund my order").click();

    cy.get('[data-testid="refund-card"]').should("contain.text", "Refund of $17.50 initiated");
    cy.contains("button", "Yes, refund my order").should("not.exist");
  });
});
