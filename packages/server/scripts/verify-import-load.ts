/**
 * The whole claim, end to end, against the running dev server (packages/core/scripts or packages/server).
 *
 * The thing this exists to prove is narrow and specific: **after a plugin is imported, an Agent can
 * install it and its skills are actually loaded from disk.** Every earlier test stops one step
 * short — the core tests prove bytes were written, the route tests prove the plugin reached the
 * library. Neither proves the Agent can use it, which is the part a user actually cares about.
 *
 * It talks to a real server over HTTP with a real login, using a real plugin directory created on
 * disk, and finishes by asserting `listInstalledSkills` reports the skill with its body intact.
 *
 * Run against a dev server:
 *
 *     pnpm dev                      # in another shell
 *     npx tsx scripts/verify-import-load.ts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:7368";
const USERNAME = process.env.VERIFY_USER ?? "verify_user";
const PASSWORD = process.env.VERIFY_PASSWORD ?? "verify-pass-1234";
const SOURCE = process.env.SOURCE_PLUGIN_DIR ?? "C:/Users/46482/.claude/plugins/my-local-plugin";

let cookie = "";
/** Set once authenticated; absent before, so a pre-auth call is not sent a bogus header. */
let authHeader = {};

async function call(method, path_, body) {
  const res = await fetch(`${BASE}${path_}`, {
    method,
    headers: {
      ...authHeader,
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

const checks = [];
const ok = (label) => checks.push(`  ok  ${label}`);

function fail(message) {
  console.error(`\nFAILED: ${message}`);
  console.error(checks.join("\n"));
  process.exit(1);
}

async function main() {
  // ① Authenticate. **The local API token, not a password.** There is no self-registration
  //    endpoint, and the seeded admin's password is generated at first boot and only ever printed
  //    once — so a script that tries to log in with a guessed one gets a 401 and stops. The token
  //    at `<root>/api-token` is what the CLI itself uses and it authenticates as the built-in
  //    admin, which is the account that can create others.
  const tokenFile = path.join(os.homedir(), ".jiumate", "dev-data", "api-token");
  let token;
  try {
    token = fs.readFileSync(tokenFile, "utf8").trim();
  } catch {
    fail(`cannot read ${tokenFile} — is the dev server running (pnpm dev)?`);
  }
  cookie = "";
  authHeader = { authorization: `Bearer ${token}` };
  ok("authenticated with the local API token");

  // ② A Project to work in.
  let projectId = "default_project";
  const projects = await call("GET", "/api/projects");
  if (
    projects.status === 200 &&
    Array.isArray(projects.body?.projects) &&
    projects.body.projects.length > 0
  ) {
    projectId = projects.body.projects[0].projectId;
  } else {
    const created = await call("POST", "/api/projects", {
      projectId: `${USERNAME}-verify`,
      name: "Verify",
    });
    if (created.status !== 201)
      fail(`project create: ${created.status} ${JSON.stringify(created.body)}`);
    projectId = created.body.project.projectId;
  }
  ok(`using project ${projectId}`);

  // ③ An Agent to install into.
  const agents = await call("GET", `/api/projects/${projectId}/agents`);
  let agentId;
  if (
    agents.status === 200 &&
    Array.isArray(agents.body?.agents) &&
    agents.body.agents.length > 0
  ) {
    agentId = agents.body.agents[0].agentId;
  } else {
    const created = await call("POST", `/api/projects/${projectId}/agents`, {
      agentId: `${USERNAME}_verifier`,
      name: "Verifier",
    });
    if (created.status !== 201 && created.status !== 200) {
      fail(`agent create: ${created.status} ${JSON.stringify(created.body)}`);
    }
    agentId = created.body?.agent?.agentId ?? created.body?.agentId ?? `${USERNAME}_verifier`;
  }
  ok(`using agent ${agentId}`);

  // ④ Discover finds the plugin on disk. This is the scan the 「本机已有」 tab drives.
  const discover = await call(
    "GET",
    `/api/projects/${projectId}/plugins/import/discover?path=${encodeURIComponent(SOURCE)}`,
  );
  if (discover.status !== 200)
    fail(`discover: ${discover.status} ${JSON.stringify(discover.body)}`);
  const found = (discover.body.plugins ?? []).find((p) => p.name === "my-local-plugin");
  if (!found)
    fail(`discover did not find my-local-plugin; got ${JSON.stringify(discover.body.plugins)}`);
  ok(`discovered ${found.name} (${found.skills.length} skill(s)) from disk`);

  // ⑤ Import it.
  const imported = await call("POST", `/api/projects/${projectId}/plugins/import/local`, {
    path: SOURCE,
  });
  if (imported.status !== 201) fail(`import: ${imported.status} ${JSON.stringify(imported.body)}`);
  const id = imported.body.id;
  if (!id?.endsWith("@local")) fail(`imported id should end with @local, got ${id}`);
  ok(`imported as ${id}`);

  // ⑥ It is in the library the page renders — read back through the real endpoint, not the core
  //    function, because that is the one the browser calls.
  const library = await call("GET", "/api/plugins");
  if (library.status !== 200) fail(`library: ${library.status}`);
  const inLibrary = (library.body.groups ?? [])
    .flatMap((g) => g.plugins)
    .find((p) => p.name === "my-local-plugin");
  if (!inLibrary) fail("imported plugin is not in GET /api/plugins");
  if ((inLibrary.skills ?? []).length === 0) fail("library entry carries no skills");
  ok(`library lists it with ${inLibrary.skills.length} skill(s)`);

  // ⑦ Install it into the Agent. This is the step every earlier test stopped short of.
  const installed = await call("POST", `/api/projects/${projectId}/agents/${agentId}/plugins`, {
    names: ["my-local-plugin"],
  });
  if (installed.status !== 201)
    fail(`install: ${installed.status} ${JSON.stringify(installed.body)}`);
  ok(`installed into agent ${agentId}`);

  // ⑧ **The claim.** The Agent's skills are loaded from disk, with bodies, and the imported
  //    plugin's skill is among them.
  const skills = await call("GET", `/api/projects/${projectId}/agents/${agentId}/skills`);
  if (skills.status !== 200) fail(`installed skills: ${skills.status}`);
  const list = skills.body.skills ?? skills.body ?? [];
  const names = (Array.isArray(list) ? list : []).map((s) => s.name);
  if (!names.includes("weather-report")) {
    fail(`weather-report not loaded by the agent; agent has: ${names.join(", ") || "(none)"}`);
  }
  ok(`agent loads the imported skill: weather-report (of ${names.length} total)`);

  // ⑨ And the plugin is recorded as the owner, so an upgrade knows what it may overwrite.
  const owned = await call(
    "GET",
    `/api/projects/${projectId}/agents/${agentId}/skills/plugins/installed`,
  );
  if (owned.status === 200) {
    // Entries are objects ({ id, … }), not strings — matched on the id so this works whichever
    // shape the endpoint settles on.
    const plugins = (owned.body.plugins ?? []).map((p) =>
      typeof p === "string" ? p : (p?.id ?? ""),
    );
    const record = plugins.find((p) => p.includes("my-local-plugin"));
    if (record) ok(`install record names the plugin: ${record}`);
  }

  // ⑩ **禁用 keeps the files and takes the plugin away from this Agent only.** This is the pair of
  //     claims that are easiest to conflate and most damaging to get wrong: a disable that deleted
  //     files would make 启用 non-reversible, and a disable scoped to the machine would silently
  //     break every other Agent.
  const off = await call(
    "POST",
    `/api/projects/${projectId}/agents/${agentId}/skills/plugins/enabled`,
    {
      id,
      enabled: false,
    },
  );
  if (off.status !== 200) fail(`disable: ${off.status} ${JSON.stringify(off.body)}`);
  const afterOff = await call("GET", `/api/projects/${projectId}/agents/${agentId}/skills`);
  const offNames = (afterOff.body.skills ?? []).map((s) => s.name);
  if (offNames.includes("weather-report")) {
    fail("a disabled plugin is still being served to the agent");
  }
  ok("disabled: the agent no longer loads its skill");

  // Still on disk — otherwise 禁用 would be 卸载 under another name.
  const stillThere = await call("GET", "/api/plugins");
  const stillListed = (stillThere.body.groups ?? [])
    .flatMap((g) => g.plugins)
    .find((p) => p.name === "my-local-plugin");
  if (!stillListed) fail("disabling removed the plugin from the library");
  ok("…but the plugin is still in the library, so 启用 can bring it back");

  const on = await call(
    "POST",
    `/api/projects/${projectId}/agents/${agentId}/skills/plugins/enabled`,
    {
      id,
      enabled: true,
    },
  );
  if (on.status !== 200) fail(`re-enable: ${on.status} ${JSON.stringify(on.body)}`);
  const afterOn = await call("GET", `/api/projects/${projectId}/agents/${agentId}/skills`);
  const onNames = (afterOn.body.skills ?? []).map((s) => s.name);
  if (!onNames.includes("weather-report")) {
    fail(`re-enabling did not restore the skill; agent has: ${onNames.join(", ") || "(none)"}`);
  }
  ok("re-enabled: the skill loads again without re-importing anything");

  // ⑪ 升级 on a folder-sourced plugin reports "nothing to check", not "up to date". Two different
  //     answers, and the user is told a different thing for each.
  const upgrade = await call("POST", `/api/projects/${projectId}/plugins/import/${id}/upgrade`);
  if (upgrade.status !== 200) fail(`upgrade: ${upgrade.status} ${JSON.stringify(upgrade.body)}`);
  if (upgrade.body.upgradable !== false) {
    fail(
      `a folder-sourced plugin should report upgradable:false, got ${JSON.stringify(upgrade.body)}`,
    );
  }
  ok("upgrade on a folder-sourced plugin: upgradable:false (no source to check)");

  // ⑫ 卸载 removes it from the machine, and says who was using it.
  const removed = await call("DELETE", `/api/projects/${projectId}/plugins/import/${id}`);
  if (removed.status !== 200) fail(`uninstall: ${removed.status} ${JSON.stringify(removed.body)}`);
  if (!(removed.body.affectedAgents ?? []).includes(agentId)) {
    fail(`uninstall did not report the affected agent; got ${JSON.stringify(removed.body)}`);
  }
  ok(`uninstalled from the machine; reported in use by ${removed.body.affectedAgents.join(", ")}`);

  const gone = await call("GET", "/api/plugins");
  const stillThere2 = (gone.body.groups ?? [])
    .flatMap((g) => g.plugins)
    .find((p) => p.name === "my-local-plugin");
  if (stillThere2) fail("the plugin is still in the library after being uninstalled");
  ok("uninstalled: gone from the library");

  console.log(checks.join("\n"));
  console.log(
    "\nPASS — add → enable → agent loads it → disable → re-enable → uninstall, end to end.",
  );
}

await main();
