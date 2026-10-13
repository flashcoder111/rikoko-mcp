import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
      include: [
        "packages/**/src/**/*.ts",
        "apps/server/src/app.ts",
        "apps/worker/src/worker.ts",
      ],
      exclude: ["**/stdio.ts"],
      reporter: ["text", "json-summary", "html"],
    },
  },
});
