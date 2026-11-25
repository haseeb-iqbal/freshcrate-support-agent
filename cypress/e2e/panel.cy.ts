/// <reference types="cypress" />

// The "Try it" panel beside the chat. Picking a prompt signs in as its sample
// customer and fills the message box; nothing is sent until Send. The prompts
// sent here reuse mock-script wording word for word, so MOCK_LLM answers them.
// Read-only: no Confirm is clicked.

import { STARTERS, promptById } from "../../lib/demo-prompts";
import { expectScripted } from "../helpers";

const selectedCustomer = () => cy.get("header select").find("option:selected");

describe("Try it panel (mock LLM)", () => {
  beforeEach(() => {
    // The panel sits beside the chat from 1024px up; below that it folds away.
    cy.viewport(1280, 800);
    cy.clearLocalStorage();
    cy.visit("/");
  });

  it("lists every starter and opens the feature groups", () => {
    for (const s of STARTERS) cy.get('[data-testid="try-panel"]').contains("button", s.title).should("exist");
    cy.contains("button", "show my order history").should("not.exist");
    cy.contains("button", "Open all").click();
    cy.contains("button", "show my order history").should("be.visible");
    cy.contains("button", "Close all").click();
    cy.contains("button", "show my order history").should("not.exist");
  });

  it("signs in as the prompt's customer and fills the box without sending", () => {
    const refund = promptById("refund-damaged")!;
    cy.contains("button", "Refund a damaged box").click();
    selectedCustomer().should("contain.text", refund.customer);
    cy.get("textarea").should("have.value", refund.text).and("be.focused");
    cy.get('[data-testid="user-text"]').should("not.exist");
    cy.contains("1 of").should("exist");
    cy.contains("button", "Refund a damaged box").should("have.attr", "aria-pressed", "true");
  });

  // Diego, not Ava: confirm.cy.ts pauses Ava earlier in the run, and a paused
  // customer gets no pause card. Nothing in the suite changes Diego's plan.
  it("sends a picked prompt and shows its card", () => {
    cy.contains("button", "Switch plan while paused").click();
    cy.contains("button", "Send").click();
    cy.contains("button", "Send", { timeout: 15000 }).should("exist");
    expectScripted();
    cy.get('[data-testid="plan-card"]').should("have.length", 1).and("contain.text", "Nothing changes until you confirm");
  });

  it("sends a prompt from a feature group as that group's customer", () => {
    cy.contains("button", "Account and orders").click();
    cy.contains("button", "show my order history").click();
    selectedCustomer().should("contain.text", "Marcus Bell");
    cy.contains("button", "Send").click();
    cy.contains("button", "Send", { timeout: 15000 }).should("exist");
    expectScripted();
    cy.get('[data-testid="history-card"]').should("exist");
  });

  it("opens with a prompt ready from an /about link", () => {
    cy.visit("/?try=plan-while-paused");
    selectedCustomer().should("contain.text", "Diego Santos");
    cy.get("textarea").should("have.value", promptById("plan-while-paused")!.text);
  });

  it("clears the ticks on Reset demo", () => {
    cy.contains("button", "Try to break it").click();
    cy.contains("button", "Try to break it").should("have.attr", "aria-pressed", "true");
    cy.reload();
    cy.contains("button", "Try to break it").should("have.attr", "aria-pressed", "true");
    cy.contains("button", "Reset demo").click();
    cy.contains("button", "Try to break it").should("have.attr", "aria-pressed", "false");
    cy.get("textarea").should("have.value", "");
    selectedCustomer().should("contain.text", "Ava Chen");
  });

  it("folds into a Things to try button on a phone", () => {
    cy.viewport(375, 812);
    cy.get('[data-testid="try-panel"]').should("not.be.visible");
    cy.contains("button", "Things to try").click();
    cy.get('[data-testid="try-panel"]').should("be.visible");
    cy.contains("button", "Ask a policy question").click();
    cy.get('[data-testid="try-panel"]').should("not.be.visible");
    cy.get("textarea").should("have.value", "how do refunds work?");
  });
});

describe("Phone header", () => {
  it("folds the links and account controls into a Menu button", () => {
    cy.viewport(375, 812);
    cy.visit("/");
    cy.get("header select").should("not.be.visible");
    cy.contains("header button", "Menu").click();
    cy.get("header select").should("be.visible");
    cy.get("header").contains("a", "About").should("be.visible");
    cy.focused().type("{esc}");
    cy.get("header select").should("not.be.visible");
    cy.focused().should("contain.text", "Menu");
  });
});

describe("About page", () => {
  it("is linked from the home header and links back to the demo", () => {
    cy.visit("/");
    cy.get("header").contains("a", "About").click();
    cy.location("pathname").should("eq", "/about");
    cy.title().should("eq", "About · FreshCrate");
    cy.contains("h1", "FreshCrate Support Agent").should("exist");
    cy.contains("a", "Try it").first().click();
    cy.location("pathname").should("eq", "/");
    cy.get("textarea").should("have.value", STARTERS[0].text);
  });

  it("opens from the FreshCrate support name in the header", () => {
    cy.visit("/");
    cy.get("header").contains("a", "FreshCrate support").click();
    cy.location("pathname").should("eq", "/about");
  });

  it("redirects the old /tour address to /about", () => {
    cy.visit("/tour");
    cy.location("pathname").should("eq", "/about");
  });
});
