/// <reference types="cypress" />

// Shared spec helpers. cypress.config.ts sets `supportFile: false`, so these
// live in a plain module the specs import. It sits outside cypress/e2e so the
// `*.cy.ts` spec pattern cannot mistake it for a spec.

/** Pick a signed-in customer by visible name in the header <select>. */
export function signInAs(name: string) {
  cy.get("header select").find("option").contains(name).then(($opt) => {
    cy.get("header select").select($opt.val() as string);
  });
}

/** Send a message and wait until streaming finishes. */
export function ask(text: string) {
  cy.get("textarea").clear().type(text);
  cy.contains("button", "Send").click();
  // Wait until streaming finishes (Send button returns from "…").
  cy.contains("button", "Send", { timeout: 15000 }).should("exist");
}
