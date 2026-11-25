/// <reference types="cypress" />

// The chat rate limit is off under the mock model, so the route's 429 is stubbed
// here to check what a visitor sees when they hit it.

import { ask } from "../helpers";

const MESSAGE =
  "You've sent 30 messages in the last hour, which is the most this demo allows. Please try again in about 30 minutes.";

describe("Chat rate limit (stubbed)", () => {
  it("shows the limit message in the chat and leaves the chat usable", () => {
    cy.intercept("POST", "/api/chat", { statusCode: 429, headers: { "Retry-After": "1800" }, body: MESSAGE });
    cy.visit("/");
    ask("where's my latest order?");
    cy.get('[data-testid="assistant-text"]').should("have.text", MESSAGE);
    cy.get('[data-testid="assistant-text"]').should("not.contain.text", "Sorry");
    cy.get("textarea").should("be.enabled").type("still here");
    cy.contains("button", "Send").should("be.enabled");
  });
});
