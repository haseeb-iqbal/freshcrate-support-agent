import { defineConfig } from "vitest/config";

export default defineConfig({
  // Native path-alias resolution. Replaces vite-tsconfig-paths, which Vitest 4
  // warns is redundant.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    // Unit tests are pure: no DB, no network, no env. Anything needing those
    // belongs in tests/api or tests/integration.
    include: ["lib/**/*.test.ts"],
    exclude: ["node_modules/**", "tests/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      // Thin adapters over external services: exercised by the API, integration
      // and E2E layers, not meaningfully unit-testable.
      exclude: ["lib/**/*.test.ts", "lib/llm/openai.ts", "lib/rag/embed.ts", "lib/rag/retrieve.ts", "lib/**/index.ts"],
      reporter: ["text", "html"],
    },
  },
});
