import { defineConfig } from "tsup";
import { buildGitDefine } from "../../scripts/build-git-stamp.mjs";

export default defineConfig({
  // Two entries on purpose: `presets` is pure metadata and is imported by the web app, so it
  // must not drag in `io.ts`'s Node built-ins (fs / path) through the barrel. The web bundle's
  // `node-free-imports` test enforces which entry a browser-safe import may use.
  entry: ["src/index.ts", "src/presets.ts", "src/schema.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
  define: buildGitDefine(),
});
