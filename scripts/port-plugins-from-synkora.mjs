/**
 * Converts a plugin from the PenguinHarness layout into this repository's.
 *
 * The two projects grew apart on one point: PenguinHarness keeps a plugin's display metadata 鈥? * the Chinese title and descriptions, the category, the icon and the version 鈥?in a `penguin` block
 * inside `package.json`, while this repository moved it into a separate `plugin.json`. The files
 * themselves (the icon, the skills and their `SKILL.md` files, any hooks) are identical and are
 * copied verbatim; only the metadata moves.
 *
 * So this is a metadata transform, not a port. The scripts inside the skills, the references and
 * the MCP server declarations are carried over untouched on purpose: they are the plugin's actual
 * content, and rewriting them would be a change of behaviour disguised as a migration.
 *
 * Written as a script rather than done by hand because there are eight plugins and the transform
 * has to be exactly right for each 鈥?a dropped `description_zh` is invisible until a user is
 * looking at a card with an English description on a Chinese UI.
 *
 * Usage: node scripts/port-plugins-from-synkora.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOT = process.env.SYNKORA_ROOT ?? "E:/MyWork/AIwork/synkora-ai/penguin-harness";

/** Plugins to port. `agent-company` (the company-mode content) and `penguin-support` (the product
 *  Q&A assistant) are excluded on purpose, as are the four `sandbox-*` plugins 鈥?they are execution
 *  sandboxes, unrelated to the skills, agent API and browser work this migration is for. */
const PLUGINS = [
  "a2ui",
  "ace-rsi-toolkit",
  "ape-rsi-toolkit",
  "awm-rsi-toolkit",
  "default-rsi-toolkit",
  "opro-rsi-toolkit",
  "agent-evaluation",
  "browser-automation",
];

/**
 * Category ids this repository's UI groups by (`PLUGIN_CATEGORIES` in core).
 *
 * The source uses a fourth, `rsi`, which does not exist here 鈥?an unknown id is not an error, the
 * loader falls back to the "other" group, so five RSI toolkits would have silently landed together
 * under 鍏朵粬 instead of where they belong. They are agent self-improvement rules derived from run
 * traces, which is what `ai-app-development` covers.
 */
const CATEGORY_MAP = {
  rsi: "ai-app-development",
  "office-productivity": "office-productivity",
  "software-development": "software-development",
  "ai-app-development": "ai-app-development",
};

const dryRun = process.argv.includes("--dry-run");

/**
 * Rewrites a ported skill's `SKILL.md` into this repository's library-side form.
 *
 * Two changes, both about who owns a field.
 *
 * **The version becomes `YYYY-MM-DD.N`.** PenguinHarness dates skills as `YYYY.MM.DD.N`; the
 * parser here does not accept the dotted form.
 *
 * **`version`, `short_description` and `short_description_zh` are removed.** A library-side
 * SKILL.md carries only `name` and `description` in this repository: the loader stamps the plugin's
 * version and UI short descriptions into the metadata and into the installable copy it generates,
 * so a skill that declares its own would be a second, competing source for the same value 鈥?and the
 * tests refuse one outright. The values are not lost; they come from `plugin.json`, which the port
 * carries them into. Only the frontmatter block is touched, never the body.
 */
function normaliseSkillMarkdown(file) {
  const text = fs.readFileSync(file, "utf8");
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  if (match === null) return;
  const kept = match[1]
    .split("\n")
    .filter(
      (line) =>
        !/^(version|short_description|short_description_zh):/.test(line) &&
        !/^version:\s*\d{4}\.\d{2}\.\d{2}\.\d+\s*$/.test(line),
    );
  // A skill that declared no version at all keeps the one the plugin's other skills carry, so the
  // loader's stamp is consistent across the plugin.
  fs.writeFileSync(file, `---\n${kept.join("\n")}\n---${text.slice(match[0].length)}`, "utf8");
}

/** Recursively copies a directory, returning the files written relative to `to`. */
function copyTree(from, to, written) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dest, written);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dest);
      if (entry.name === "SKILL.md") normaliseSkillMarkdown(dest);
      written.push(path.relative(path.join(ROOT, "plugins"), dest).replace(/\\/g, "/"));
    }
  }
}

/**
 * A plugin's `version`, in this repository's format.
 *
 * The two projects version differently. This one dates every plugin: `YYYY-MM-DD.N`, compared by
 * `comparePluginVersions` and validated by `PLUGIN_VERSION_PATTERN`, which the loader rejects a
 * plugin for violating 鈥?it is the field an upgrade check reads, so it cannot be a semver.
 * PenguinHarness uses npm semver there (`0.2.16`) and dates the skills instead, as
 * `YYYY.MM.DD.N` in each SKILL.md's frontmatter.
 *
 * So the semver is kept for the npm `package.json`, which requires it, and the manifest's version
 * is derived from the newest date among the plugin's skills. Falling back to today when a plugin
 * ships no skills is a real possibility (a hooks-only plugin), and a fixed date would be worse:
 * it would sort below every dated plugin forever.
 */
function manifestVersion(from, skills) {
  const dates = skills
    .map((dir) => {
      const skillMd = path.join(from, "skills", dir, "SKILL.md");
      if (!fs.existsSync(skillMd)) return null;
      const text = fs.readFileSync(skillMd, "utf8");
      const m = /^version:\s*(\d{4})[.-](\d{2})[.-](\d{2})\.(\d+)/m.exec(text);
      return m === null ? null : `${m[1]}-${m[2]}-${m[3]}.${m[4]}`;
    })
    .filter((one) => one !== null);
  if (dates.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return `${today}.1`;
  }
  return dates.sort().at(-1);
}

/** The `plugin.json` for a ported plugin, built from its `package.json`'s `penguin` block. */
function manifestFor(name, pkg, version) {
  const meta = pkg.penguin ?? {};
  const category = CATEGORY_MAP[meta.category];
  if (category === undefined) {
    throw new Error(`${name}: unmapped category ${JSON.stringify(meta.category)}`);
  }
  const manifest = {
    description: pkg.description,
    version,
    category,
  };
  // Present only when the source carries them: an absent field is shown as missing rather than
  // invented, so a plugin that never had a Chinese title does not get a placeholder.
  if (meta.description_zh !== undefined) manifest.description_zh = meta.description_zh;
  if (meta.short_description !== undefined) manifest.short_description = meta.short_description;
  if (meta.short_description_zh !== undefined) {
    manifest.short_description_zh = meta.short_description_zh;
  }
  if (meta.preinstall === false) manifest.preinstall = false;
  // `quick_start` is the plugin detail page's sample request; `prompt_zh` is its Chinese half.
  if (meta.quick_start !== undefined) {
    manifest.quick_start = {};
    for (const [key, value] of Object.entries(meta.quick_start)) {
      if (value !== undefined) manifest.quick_start[key] = value;
    }
  }
  return manifest;
}

/** The npm package.json, rewritten to this repository's scope and file list. */
function packageJsonFor(name, pkg) {
  const meta = pkg.penguin ?? {};
  const out = {
    name: `@jiumate/${name}`,
    version: pkg.version,
    description: pkg.description,
  };
  if (pkg.license !== undefined) out.license = pkg.license;
  out.keywords = ["jiumate-plugin"];
  if (pkg.repository !== undefined) {
    // The upstream URL points at PenguinHarness; this repository is not that project, so the
    // directory is dropped rather than claiming a path that does not exist here.
    const url = String(pkg.repository.url ?? "").replace(/^git\+/, "").replace(/\.git$/, "");
    out.repository = { type: "git", url, directory: `plugins/${name}` };
  }
  // `plugin.json` is this repository's manifest and the source's `package.json` is being replaced
  // by the one this function returns, so neither is listed.
  out.files = ["plugin.json", "icon.svg", "skills", "hooks", "LICENSE"];
  out.publishConfig = { access: "public" };
  // The quick-start prompt is the plugin detail page's copy; carried so the ported card is not
  // the only one without one.
  if (meta.quick_start?.prompt !== undefined) {
    out.description = pkg.description;
  }
  return out;
}

let ported = 0;
for (const name of PLUGINS) {
  const from = path.join(SOURCE_ROOT, "plugins", name);
  if (!fs.existsSync(from)) {
    throw new Error(`missing source plugin: ${from}`);
  }
  const to = path.join(ROOT, "plugins", name);
  const pkg = JSON.parse(fs.readFileSync(path.join(from, "package.json"), "utf8"));

  if (dryRun) {
    const skills = fs.existsSync(path.join(from, "skills"))
      ? fs.readdirSync(path.join(from, "skills"), { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : [];
    console.log(`${name}: ${skills.length} skill(s) [${skills.join(", ")}]`);
    continue;
  }

  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });

  const written = [];
  // The icon and the skills are the plugin's content and go across byte for byte.
  for (const entry of ["icon.svg", "LICENSE", "README.md"]) {
    const src = path.join(from, entry);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(to, entry));
      written.push(entry);
    }
  }
  for (const dir of ["skills", "hooks"]) {
    if (fs.existsSync(path.join(from, dir))) copyTree(path.join(from, dir), path.join(to, dir), written);
  }

  const skillDirs = fs.existsSync(path.join(from, "skills"))
    ? fs
        .readdirSync(path.join(from, "skills"), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [];
  const manifest = manifestFor(name, pkg, manifestVersion(from, skillDirs));
  fs.writeFileSync(
    path.join(to, "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(to, "package.json"),
    `${JSON.stringify(packageJsonFor(name, pkg), null, 2)}\n`,
    "utf8",
  );

  const skillCount = manifest && fs.existsSync(path.join(to, "skills"))
    ? fs.readdirSync(path.join(to, "skills"), { withFileTypes: true }).filter((e) => e.isDirectory())
        .length
    : 0;
  console.log(
    `${name}: ${skillCount} skill(s), category=${manifest.category}, ` +
      `zh=${manifest.short_description_zh === undefined ? "no" : "yes"}, ` +
      `${written.length} file(s)`,
  );
  ported++;
}

if (!dryRun) console.log(`\nported ${ported} plugin(s) into plugins/`);