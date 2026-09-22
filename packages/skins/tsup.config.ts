import { defineConfig } from "tsup";
import { buildGitDefine } from "../../scripts/build-git-stamp.mjs";

export default defineConfig({
  // Three entries on purpose, mirroring `@prismshadow/linsight-pets`: `css` and `presets` are
  // imported by the web app and must not drag in `io.ts`'s Node built-ins (fs / crypto / path)
  // through the barrel.
  entry: ["src/index.ts", "src/css.ts", "src/presets.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
  define: buildGitDefine(),
});
