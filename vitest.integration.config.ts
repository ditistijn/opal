import { defineConfig } from "vitest/config"
import { fileURLToPath, URL } from "node:url"

// Integration tests spawn a real `opencode serve` sidecar (see tests/integration/harness.ts).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
