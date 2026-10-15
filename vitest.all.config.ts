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
      reportsDirectory: "coverage-all",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/**/*.d.ts", "src/main.tsx", "src/domain/types.ts"],
      thresholds: {
        // Vitest 4 AST remapping counts statements and branches differently;
        // these floors use the unchanged suite and the same source file set.
        statements: 84,
        lines: 91,
        functions: 79,
        branches: 76,
      },
    },
  },
});
