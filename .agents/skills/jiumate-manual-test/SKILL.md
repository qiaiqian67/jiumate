---
name: jiumate-manual-test
description: Use when standing JiuMate up to try a change by hand — launching the Web App, the desktop shell, the landing page or the docs site to click through it, screenshot it, or reproduce a report. Covers the four dev entry points and their ports, which data root each writes to, and the four ways a healthy setup looks broken.
---

# Standing JiuMate up to test by hand

Node >= 24. `dev:*` runs `dev-prebuild.mjs` first (keeps `pnpm install` current, prebuilds
workspace deps); `pnpm desktop` runs a full `pnpm -r build`, so it is slow to start.

## Entry points

| Command | Open | Data root |
| --- | --- | --- |
| `pnpm dev` | http://localhost:7365 | `~/.jiumate/dev-data` |
| `pnpm desktop` | its own window | `~/.jiumate/dev-data` |
| `pnpm dev:landing` | http://localhost:7366 | none (static) |
| `pnpm dev:docs` | http://localhost:7367 | none (static) |

Other fixed ports (`packages/core/src/internal/ports.ts`): 7364 installed server, 7368 dev backend,
7369 `pnpm jiumate web` (data root `~/.jiumate/dev-data-cli` — its own, so it can serve while an
Agent it hosts runs `pnpm dev`; the lock is per root). On a shared box, `ss -tln` before assuming
one is free; `PORT=` inline moves it.

The user's installed app, server and CLI all use `~/.jiumate/data` — their real Agents, Sessions
and keys. Never point a dev run there. Both surfaces print the root they took (`Data root: …`,
`[shell] dev instance … on data root …`); read it rather than assume.

## Four ways a working setup looks broken

**7368 shows a stale app.** The dev backend also serves `packages/web/dist` — the last
`pnpm -r build`, not what Vite is serving. Screenshot 7365, never 7368.

**`curl` returns 502 but the server is fine.** A shell `http_proxy` routes loopback through the
proxy. Use `curl --noproxy '*'`. Browsers and the server itself are unaffected.

**`/api` on `127.0.0.1` returns 401.** That address is reserved as the Workspace-preview host. Use
`localhost`.

**The server exits 3 saying the data root is in use.** Another instance — usually the user's own
desktop app — holds `<root>/server.lock`. The lock is per root, not per port, so `PORT=` will not
get past it. Use a different root; do not kill their process.

## JIUMATE_HOME

Never export it. `scripts/run-with-env.mjs` applies each `VAR=value` only when unset, so an
exported value silently redirects every dev script — an exported `~/.jiumate/data` puts `pnpm dev`
on the user's real data, where the lock is already held. It now names any default the environment
displaced before running, so read that line if it appears.

When you need your own root, prefix the one command:

```sh
JIUMATE_HOME=~/.jiumate/dev-data-<topic> pnpm dev
```

Unset it rather than blanking it: `run-with-env` reads empty as unset, but `resolveRoot()` uses
`??` and takes an empty string literally.

## Signing in

A fresh root seeds `admin` with a random `jiumate-<4 digits>` password, printed once at startup.
`JIUMATE_SEED_ADMIN_PASSWORD` pins it, which is how the e2e harness logs in.

**When you have no password, use the local API token.** The server writes `<root>/api-token` at
boot; presenting it as `Authorization: Bearer <token>` authenticates as `admin`, because holding it
proves filesystem access to the data root. That is enough to drive the Web App from Playwright with
no credentials — see below. The only login wall with no way around it is the token being absent, and
it is written by every boot.

```js
// Playwright against a dev server the user is already running
const token = fs.readFileSync(path.join(os.homedir(), ".jiumate/dev-data/api-token"), "utf8").trim();
const ctx = await browser.newContext();
await ctx.setExtraHTTPHeaders({ authorization: `Bearer ${token}` });
```

## Fixing a UI bug: look before you theorise

**A bug report about visible UI is settled by looking at the running app, not by reading source.**
A real round of this cost five wrong fixes: each one was a genuine bug, each shipped with passing
tests, and none of them was the reported one. See
`changelog/unreleased/2026-10-13-quick-invoke-reaches-composer.md`.

What actually found it, in one pass:

```js
// Record every write, from inside the page
await page.addInitScript(() => {
  window.__writes = [];
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (String(k).includes("chatDraft")) window.__writes.push(v);
    return orig.call(this, k, v);
  };
});
```

That showed the pre-selection written correctly and overwritten ~300ms later by code that rebuilt
the cache from state alone. No amount of source reading had found it, because every layer looked
correct in isolation — the bug was a *race between two correct writers*.

Rules that follow from it:

- **Reproduce in the browser before editing.** Not after. If you cannot, say so and ask for the
  reproduction rather than shipping a plausible fix.
- **An assertion about the shape of a fix is not evidence.** One test in this repo asserted that
  `persistNow` rebuilt the draft from component state — encoding the very defect — and passed for two
  commits while the feature was visibly broken. Assert on behaviour, or on the requirement.
- **"N tests pass" says nothing about whether the bug is fixed.** It says the code matches the
  expectations, which may themselves be wrong.
- **Two real fixes in a row with no visible change is evidence about your method, not the codebase.**
  Stop and get a browser, rather than adding a third layer.

**HMR can silently refuse.** Vite logs `hmr invalidate … Could not Fast Refresh ("X" export is
incompatible)` and the page keeps running the **old** module — the browser looks like it reloaded and
your change appears to do nothing. It fires for files that mix component and non-component exports
(`plugins-page.tsx`, `skills-tab.tsx`, `state/locale.tsx` and others). Check `web.log` for
`hmr invalidate` before concluding a fix is wrong, and tell the user to hard-refresh.

**A dead backend with a live frontend.** `pnpm dev` prints
`[dev-prebuild] another dev prestep is running; waiting...` and then goes silent — the lock
(`%TEMP%/jiumate-dev-<key>.lock`) is held by a leftover process and only clears after its 10-minute
staleness window. The frontend stays up and every request logs `ECONNREFUSED 127.0.0.1:7368`. Kill
the `concurrently` / `tsx watch` / `vite` processes and start `dev:server` and `dev:web` separately
rather than waiting it out.

## Editing while it runs

Changes to `core` or `skills` do not reach a running dev server — web/server consume snapshot
copies that re-sync only when that package's `build` runs. Restart `pnpm dev`.

## When you are done

Stop what you started. Leave anything the user was already running alone.
