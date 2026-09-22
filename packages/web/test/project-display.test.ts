/**
 * The two Project labels the UI derives rather than reads: the switcher's name and its role badge.
 *
 * Both exist because the server hands over an id and a wire role, and neither is fit to print:
 * the admin's built-in Project is provisioned with no display name, so `default_project` used to
 * surface verbatim in the switcher, and the badge rendered `owner` / `member` in English on a
 * Chinese UI. Pinning them here matters because both are one-line fallbacks whose wrong answer is
 * *plausible* — an id is a perfectly readable string, and an untranslated role looks like a
 * deliberate technical term rather than a miss.
 *
 * vitest runs node-only (`environment: "node"`), which is fine: these are pure functions, and
 * importing the module for them pulls no DOM.
 */
import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "@prismshadow/linsight-server/api";
import { DEFAULT_PROJECT_ID, projectDisplayName, projectRoleLabel } from "../src/state/project";
import { en } from "../src/lib/strings-en";
import { zh } from "../src/lib/strings";

const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  projectId: "acme",
  role: "owner",
  ownerUserId: "u1",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("DEFAULT_PROJECT_ID", () => {
  it("matches the server's constant, which is what every comparison depends on", () => {
    // Mirrored rather than imported: core's paths.ts imports node:os/node:path, so its subpath
    // exports (reserved for web-safe modules) cannot carry it. This assertion is the only thing
    // tying the two spellings together, so it is the point of the test.
    expect(DEFAULT_PROJECT_ID).toBe("default_project");
  });
});

describe("projectDisplayName", () => {
  it("prefers the name the owner set", () => {
    expect(projectDisplayName(project({ projectId: "acme", name: "客户甲" }))).toBe("客户甲");
  });

  it("labels the built-in Project instead of showing its id", () => {
    // The regression: the admin's default_project is provisioned with no display name, so the
    // switcher read "default_project" — an identifier, in the one place a user expects a name.
    expect(projectDisplayName(project({ projectId: DEFAULT_PROJECT_ID }))).toBe(
      zh.project.defaultProjectName,
    );
    expect(projectDisplayName(project({ projectId: DEFAULT_PROJECT_ID }))).not.toBe(
      DEFAULT_PROJECT_ID,
    );
  });

  it("lets the owner rename even the built-in Project", () => {
    // The label is a fallback, not an override: once a name is set it wins, or renaming the
    // default Project would silently do nothing.
    expect(projectDisplayName(project({ projectId: DEFAULT_PROJECT_ID, name: "我的项目" }))).toBe(
      "我的项目",
    );
  });

  it("treats an empty name as absent, like the server's unset", () => {
    // project_config.toml can carry `name = ""`; showing a blank switcher row would be worse
    // than either fallback.
    expect(projectDisplayName(project({ projectId: "acme", name: "" }))).toBe("acme");
    expect(projectDisplayName(project({ projectId: DEFAULT_PROJECT_ID, name: "" }))).toBe(
      zh.project.defaultProjectName,
    );
  });

  it("falls back to the id for any other unnamed Project", () => {
    expect(projectDisplayName(project({ projectId: "acme" }))).toBe("acme");
    // A non-admin's own Project is named at signup (the username), so it never reaches here —
    // but if the name were somehow dropped, the id is the honest answer, not the default label.
    expect(projectDisplayName(project({ projectId: "bob-default_project" }))).toBe(
      "bob-default_project",
    );
  });
});

describe("projectRoleLabel", () => {
  it("translates both roles, and never passes the wire value through", () => {
    expect(projectRoleLabel("owner")).toBe(zh.project.roleOwner);
    expect(projectRoleLabel("member")).toBe(zh.project.roleMember);
    expect(projectRoleLabel("owner")).not.toBe("owner");
    expect(projectRoleLabel("member")).not.toBe("member");
  });

  it("names the owner 管理员, the same word the server-level admin wears", () => {
    // Two different scopes (server admin vs Project owner) deliberately share one label: they are
    // the same privilege word to a reader, and a distinct coinage for each would read as noise.
    expect(zh.project.roleOwner).toBe(zh.admin.roleAdmin);
  });

  it("has an English counterpart for each, so the badge is never half-translated", () => {
    expect(en.project.roleOwner).toBeTruthy();
    expect(en.project.roleMember).toBeTruthy();
    expect(en.project.defaultProjectName).toBeTruthy();
  });
});
