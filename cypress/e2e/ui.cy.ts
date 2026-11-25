/// <reference types="cypress" />

// Chrome, not conversation: header controls, the help center, and tab titles.
// Read-only - nothing here sends a message or clicks a Confirm button.

describe("FreshCrate chrome", () => {
  it("labels the account toggle My Account", () => {
    cy.visit("/");
    cy.contains("button", "My Account").should("exist");
  });

  it("titles the home page for the view being shown", () => {
    cy.visit("/");
    cy.title().should("eq", "FreshCrate Support");
    cy.contains("button", "My Account").click();
    cy.title().should("eq", "My Account · FreshCrate");
    cy.contains("button", "Chat").click();
    cy.title().should("eq", "FreshCrate Support");
  });

  it("lists help articles by title alone, with no slug text", () => {
    cy.visit("/kb");
    cy.title().should("eq", "Help Center · FreshCrate");
    // Each row held two spans - the title and the grey slug. Now only the title.
    cy.get("ul li a").first().find("span").should("have.length", 1);
  });

  it("titles an article with its own heading and shows no Source line", () => {
    cy.visit("/kb");
    cy.get("ul li a").first().click();
    // The list page also has an <h1>, so wait for the article's own heading to
    // replace it before reading the text - otherwise invoke("text") can read
    // the list page's stale heading mid-navigation.
    cy.get("h1").should("not.contain.text", "FreshCrate Help Center");
    cy.get("h1").invoke("text").then((heading) => {
      cy.title().should("eq", `${heading} · FreshCrate`);
    });
    cy.contains("Source:").should("not.exist");
  });
});
