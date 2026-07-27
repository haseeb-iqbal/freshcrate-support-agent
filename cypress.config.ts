import { defineConfig } from "cypress";
import { execSync } from "node:child_process";

/** A seeded customer id, so the probe request passes the chat route's validation. */
const PROBE_CUSTOMER = "11111111-1111-1111-1111-111111110001"; // Ava Chen

/**
 * Refuse to run the specs unless the server on `baseUrl` is the deterministic
 * mock provider.
 *
 * The specs assert on scripted answers (exact order numbers, card visibility,
 * fixed wording). Against the REAL OpenAI provider the answers are fluent and
 * non-deterministic, so roughly a third of the specs fail at random - and
 * confusingly, because the app itself is working. This is easy to hit:
 * start-server-and-test reuses whatever already answers on port 3000, so a
 * stray `next dev` means even `npm run test:e2e` tests the wrong server.
 *
 * The mock answers any unrecognised message with a fixed sentinel and calls no
 * tools (so the probe writes nothing); the real provider never emits it. Fail
 * fast with an actionable message instead of a three-minute red run.
 */
async function assertMockServer(baseUrl: string): Promise<void> {
  let body: string;
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerId: PROBE_CUSTOMER, messages: [{ role: "user", content: "__cypress mock-mode probe__" }] }),
      signal: AbortSignal.timeout(30000),
    });
    body = await res.text();
  } catch {
    throw new Error(
      `Cypress could not reach a server at ${baseUrl}. Start it in mock mode first: run \`npm run test:e2e\`, which boots \`dev:mock\` for you.`,
    );
  }
  if (!body.includes("(mock) No script for this input")) {
    throw new Error(
      `The server at ${baseUrl} is NOT in MOCK_LLM mode, so its answers are non-deterministic and the specs fail at random. ` +
        `Stop any plain dev server on that port and run \`npm run test:e2e\` (it starts \`dev:mock\`), or start the server yourself with \`npm run dev:mock\` before running cypress.`,
    );
  }
}

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    supportFile: false,
    video: false,
    defaultCommandTimeout: 15000,
    async setupNodeEvents(_on, config) {
      // The confirm and agent specs mutate the database - they refund a box,
      // pause a plan, switch a dietary track. Those writes persist, and a
      // refunded box no longer offers a refund card, a switched track no longer
      // offers a diet card, so the SAME specs fail on the next run against the
      // leftover state. Reseed once at startup (data only - the schema and KB
      // embeddings stay put) so the run is idempotent however cypress is
      // invoked. Reseed BEFORE the probe so the probe customer exists.
      execSync("npm run db:seed", { stdio: "inherit" });
      await assertMockServer(config.baseUrl ?? "http://localhost:3000");
      return config;
    },
  },
});
