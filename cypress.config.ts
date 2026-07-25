import { defineConfig } from "cypress";
import { execSync } from "node:child_process";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    supportFile: false,
    video: false,
    defaultCommandTimeout: 15000,
    setupNodeEvents() {
      // The confirm and agent specs mutate the database - they refund a box,
      // pause a plan, switch a dietary track. Those writes persist, and a
      // refunded box no longer offers a refund card, a switched track no longer
      // offers a diet card, so the SAME specs fail on the next run against the
      // leftover state. `npm run test:e2e` hides this by running db:reset first;
      // a bare `cypress` run did not, so it passed once and then failed.
      //
      // Reseed once at startup (data only - the schema and KB embeddings are
      // left in place) so the run is idempotent however cypress is invoked.
      execSync("npm run db:seed", { stdio: "inherit" });
    },
  },
});
