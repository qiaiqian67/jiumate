import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: process.platform === "win32" ? 60_000 : 5_000,
    retry: process.platform === "win32" ? 1 : 0,
  },
});
