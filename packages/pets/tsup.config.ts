import { defineConfig } from "tsup";
import { buildGitDefine } from "../../scripts/build-git-stamp.mjs";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node24",
  dts: true,
  clean: true,
  sourcemap: true,
  define: buildGitDefine(),
});
