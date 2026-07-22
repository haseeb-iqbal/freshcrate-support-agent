import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/api/**/*.test.ts"],
    testTimeout: 20000,
    // These files share one database and pin a process-global clock. The suite
    // is small, so serialising files buys determinism for negligible time.
    fileParallelism: false,
  },
});
