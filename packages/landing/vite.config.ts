/**
 * Vite config: static landing page (React SPA + Tailwind CSS 4).
 *
 * BASE_PATH is injected by the GitHub Pages workflow ("/" — the site is served from the
 * custom apex domain); local dev and previews also default to "/".
 *
 * SITE_ORIGIN is the address the site is served from, used for the links that have to be
 * absolute: the one-line installer commands, and the OpenGraph image. It defaults to the
 * repository's GitHub Pages address, so a site built without a custom domain still links
 * to itself. The workflow sets it when the site has its own domain.
 *
 * Blog posts are local Markdown files imported at build time via import.meta.glob (?raw),
 * so the built site is fully static — no server or CMS involved.
 */
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  // The whole address the site is served from: the host and the deploy subpath. The
  // installer commands have to name the full address, because they are pasted into a
  // shell where the site's own relative URLs do not resolve — and under GitHub Pages the
  // subpath is part of that address, not just of the pages' own URLs.
  //
  // It goes in as VITE_SITE_ORIGIN rather than as a bare `define`, so that the test
  // runner sees it too: a `define` is replaced only in the build, and a test importing
  // a module that reads one would throw.
  define: {
    "import.meta.env.VITE_SITE_ORIGIN": JSON.stringify(
      `${(process.env.SITE_ORIGIN ?? "https://qiaiqian67.github.io").replace(/\/+$/, "")}${(
        process.env.BASE_PATH ?? "/"
      ).replace(/\/+$/, "")}`,
    ),
  },
  plugins: [react(), tailwindcss()],
  // Fixed JiuMate dev port (stands alone — only the main server default is
  // shared, as DEFAULT_SERVER_PORT in core; vite configs cannot import core TS).
  server: { port: 7366 },
});
