/**
 * Reports what the plugin-layout migration would do to a real data root, without asserting — it
 * moves directories for real, so it is a **preview you then accept**, not a dry run.
 *
 *   node scripts/check-migration.mjs <dataRoot> [projectId] [agentId]
 *
 * The tests in `plugin-store.test.ts` prove the rule on synthetic trees; this answers the question
 * they cannot: what does it do to *this machine's* installs. It prints the flat tree before and
 * after, the plugin directories created, the Skills left alone, and whether anything was lost —
 * which is the one number worth checking, because a migration that quietly drops a Skill is worse
 * than one that does nothing.
 *
 * Idempotent, so running it twice is harmless: the second run has nothing left to move.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  listInstalledSkills,
  loadLibraryPlugins,
  migrateFlatBundledSkills,
  pluginsDir,
  skillsDir,
} from "../packages/core/dist/index.js";

const root = process.argv[2];
const projectId = process.argv[3] ?? "default_project";
const agentId = process.argv[4] ?? "default_agent";

const flatCount = async () =>
  (
    await fs.readdir(skillsDir(root, projectId, agentId), { withFileTypes: true }).catch(() => [])
  ).filter((e) => e.isDirectory() && !e.name.startsWith(".")).length;

const before = await listInstalledSkills(root, projectId, agentId);
console.log(`迁移前：平铺 ${await flatCount()} 个，已装 ${before.length} 个`);
console.log(`  带 plugin 归属的：${before.filter((s) => s.plugin).length}`);

const library = loadLibraryPlugins();
const members = new Map(library.map((p) => [p.name, p.skills.map((s) => s.name)]));
const report = await migrateFlatBundledSkills(root, projectId, agentId, members);

console.log(`\n迁移：`);
console.log(`  新建插件目录 ${report.migrated.length} 个：${report.migrated.join(", ") || "无"}`);
console.log(`  移动技能 ${report.movedSkills.length} 个`);
console.log(
  `  保留在 skills/ ${report.leftAlone.length} 个：${report.leftAlone.join(", ") || "无"}`,
);

const after = await listInstalledSkills(root, projectId, agentId);
console.log(`\n迁移后：平铺 ${await flatCount()} 个，已装 ${after.length} 个（应与迁移前相同）`);
console.log(`  带 plugin 归属的：${after.filter((s) => s.plugin).length}`);

if (
  await fs
    .readdir(pluginsDir(root, projectId, agentId))
    .catch(() => [])
    .then((r) => r.length)
) {
  for (const p of await fs.readdir(pluginsDir(root, projectId, agentId))) {
    const n = (
      await fs
        .readdir(path.join(pluginsDir(root, projectId, agentId), p, "skills"), {
          withFileTypes: true,
        })
        .catch(() => [])
    ).length;
    console.log(`  ${p} → ${n} 个技能`);
  }
}

// The invariant that matters: migration must never change what is installed.
const lost = before.filter((s) => !after.some((a) => a.name === s.name));
console.log(
  `\n丢失的技能：${lost.length === 0 ? "无（正确）" : lost.map((s) => s.name).join(", ")}`,
);
