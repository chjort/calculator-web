import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    fileParallelism: false, // API tests share one real Postgres database
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
