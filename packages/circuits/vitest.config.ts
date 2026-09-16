import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    // A Semaphore proof is a real Groth16 proving operation (~1s per proof at depth 3), and the
    // first run additionally downloads the trusted-setup artifacts (~3.7 MB). Both are far
    // beyond vitest's 5s defaults; the artifact fetch happens inside the beforeAll hook.
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
