/**
 * Mounts the real `WatchFigures` into the page, for the render test.
 *
 * The component itself is the thing under test — the harness must not re-implement it, or the
 * test would only prove that a copy behaves. So this imports the real one and mounts it with the
 * props the login page passes, and nothing else.
 *
 * Served as a static file by the test's own server, which is why it lives here rather than in the
 * app: it exists only to be loaded by `login-figures-render.test.ts`.
 */
import { createRoot } from "react-dom/client";
import { WatchFigures } from "./login-figures";

const host = document.getElementById("slot");
if (host === null) throw new Error("#slot missing from the harness");
createRoot(host).render(
  <WatchFigures usernameTyped={false} passwordTyped={false} surprised={false} />,
);
