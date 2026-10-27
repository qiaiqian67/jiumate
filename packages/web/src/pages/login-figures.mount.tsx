/**
 * Mounts the real `WatchFigures` into the page, for the render test.
 *
 * The component itself is the thing under test — the harness must not re-implement it, or the
 * test would only prove that a copy behaves. So this imports the real one and mounts it with the
 * props the login page passes.
 *
 * `window.__watchers` re-renders it with different props so a test can drive the states that only
 * exist as the user types — `passwordTyped` in particular, since "everyone looks away" cannot be
 * checked from the initial render alone. Going through React rather than by setting attributes
 * directly matters: the reactions are driven by props, and a test that poked the DOM would pass
 * whether or not the component responded to them.
 *
 * Served as a static file by the test's own server, which is why it lives here rather than in the
 * app: it exists only to be loaded by the login-page render tests.
 */
import { createRoot } from "react-dom/client";
import { WatchFigures } from "./login-figures";

const host = document.getElementById("slot");
if (host === null) throw new Error("#slot missing from the harness");

const root = createRoot(host);

interface Props {
  usernameTyped: boolean;
  passwordTyped: boolean;
  surprised: boolean;
}

const render = (props: Props) => root.render(<WatchFigures {...props} />);

render({ usernameTyped: false, passwordTyped: false, surprised: false });

declare global {
  interface Window {
    __watchers: (props: Partial<Props>) => void;
  }
}

window.__watchers = (partial) =>
  render({
    usernameTyped: partial.usernameTyped ?? false,
    passwordTyped: partial.passwordTyped ?? false,
    surprised: partial.surprised ?? false,
  });
