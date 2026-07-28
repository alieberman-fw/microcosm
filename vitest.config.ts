import { defineConfig } from "vitest/config";
import path from "path";

// Offline engine tests — the FakeAnthropic seam (docs/next-level-plan.md
// Phase 1). Node environment, no Next runtime, no network, no tokens.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
