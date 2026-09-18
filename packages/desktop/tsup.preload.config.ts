import { defineConfig } from "tsup";

/**
 * The pet preload bridge, built as its own CommonJS bundle.
 *
 * It cannot ride along in tsup.config.ts's ESM build. A renderer created with
 * `sandbox: true` loads preload scripts as CommonJS only; an ESM preload is
 * dropped by Electron with "Cannot use import statement outside a module", so
 * `contextBridge.exposeInMainWorld` never runs and `window.pet` is undefined —
 * which is exactly why the floating pet window never opened.
 *
 * The `.cjs` extension is load-bearing too: this package is `"type": "module"`,
 * so a plain `.js` file would be treated as ESM regardless of its contents.
 *
 * Runs after tsup.config.ts (which owns the output directory with `clean: true`),
 * hence `clean: false` here.
 */
export default defineConfig({
  entry: { preload: "src/preload.ts" },
  outDir: "dist",
  format: ["cjs"],
  outExtension: () => ({ js: ".cjs" }),
  target: "node24",
  platform: "node",
  sourcemap: true,
  splitting: false,
  clean: false,
  external: ["electron"],
});
