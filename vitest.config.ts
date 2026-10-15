import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    exclude: ["e2e/**", "node_modules/**", "dist/**", "release-artifacts/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: [
        "src/domain/**/*.ts",
        "src/services/**/*.{ts,tsx}",
        "src/lib/**/*.ts",
        "src/stores/sync-adapter.ts",
      ],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/domain/types.ts",
      ],
      thresholds: {
        // Vitest 4 AST remapping establishes a new statement-count baseline.
        // Line, function and branch gates retain their previous values.
        statements: 92,
        lines: 95,
        functions: 95,
        branches: 75,
      },
    },
  },
});
