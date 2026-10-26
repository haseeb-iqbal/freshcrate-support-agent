import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 20000,
    // Every file shares one DB and seed-coherence scans all of it, so a file that
    // inserts test rows must not run beside it.
    fileParallelism: false,
  },
});
