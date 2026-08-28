import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    watch: null,
  },
  test: {
    environment: "node",
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    isolate: false,
    silent: true,
    testTimeout: 15000,
    hookTimeout: 15000,
    teardownTimeout: 2000,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
    watch: false,
  },
});
