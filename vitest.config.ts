import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Several checks shell out to the real toolchain (a cold `tsc` whole-program
    // compile, the project's ESLint, spawned Jest); the 5s default is too tight
    // for those under parallel-worker contention.
    testTimeout: 30_000,
  },
});
