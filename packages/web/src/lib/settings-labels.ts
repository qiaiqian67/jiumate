/**
 * The settings categories' display names and glyphs — the two things BOTH the sidebar menu
 * and the settings pane need, and which therefore have exactly one home.
 *
 * They were duplicated while the split was being made (the menu in the sidebar, the pane in
 * features/settings/settings-page.tsx) and the test suite caught the seam: nothing stopped
 * one side being edited without the other, and a mismatch reads as a menu whose label does
 * not change when you click it. Sharing the map is the fix.
 *
 * Kept out of `settings-sections.ts` on purpose: that module is pure decisions over plain
 * data, unit tested in Node with no DOM and no dictionary, and it is what decides WHO sees
 * which page. This is what a page LOOKS like, and it reads the live locale — so it must be
 * imported inside a component (a module-level read would freeze the language at import).
 */
import { S } from "./strings";
import type { SettingsGroupKey, SettingsSectionKey } from "./settings-sections";
import { GEAR_ICON, NAV_ICONS } from "../components/ui/icons";

/** Category label, in the current language. Read inside a component, never at module scope. */
export function settingsSectionLabel(section: SettingsSectionKey): string {
  return {
    projectManage: S.project.settingsTabManage,
    projectMembers: S.project.settingsTabMembers,
    projectDefaults: S.project.settingsTabDefaults,
    projectSecurity: S.project.settingsTabSecurity,
    general: S.settings.generalTitle,
    appearance: S.settings.appearanceTitle,
    application: S.settings.applicationTitle,
    models: S.settings.modelsTitle,
    logs: S.logs.title,
    account: S.settings.accountTitle,
    proxy: S.settings.proxyTitle,
    uploads: S.settings.uploadLimitsTitle,
    users: S.admin.users,
  }[section];
}

/**
 * The rail heading a page sits under, in the current language.
 *
 * The menu draws one heading wherever the group changes, so a viewer's list is built by
 * walking these in rail order — the same source `settingsGroups` dedupes, which is why both
 * read the same field rather than each keeping its own copy of the grouping.
 */
export function settingsGroupLabel(group: SettingsGroupKey): string {
  return {
    project: S.project.settingsGroupProject,
    personal: S.settings.groupPersonal,
    server: S.settings.groupServer,
  }[group];
}

/** Rail glyphs, on the shared 24x24 stroke grid (NAV_ICONS' conventions). */
export const SETTINGS_SECTION_ICONS: Record<SettingsSectionKey, string> = {
  /* The project group. Manage / Members / Defaults / Security take the glyphs the Project
     settings dialog's own tab rail already used, so the page you land on and the row you
     clicked carry the same mark — a second set of drawings for the same four concepts would
     make the two surfaces disagree. */
  /** Folder + sliders: rename / create / delete — operating ON the Project. */
  projectManage:
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM7 12h10M7 15h6",
  /** Two people: the member table. */
  projectMembers:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87",
  /** Sliders: chat defaults. */
  projectDefaults: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  /** Shield: the command / security policy. */
  projectSecurity: "M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z",
  general: GEAR_ICON,
  /** Sun: appearance. */
  appearance:
    "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4l1.4-1.4",
  /** Stacked layers: the model library, same glyph the nav entry used. */
  models: NAV_ICONS.models,
  /** Single person: the signed-in account. */
  account: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  /** Window with a heart: application-level preferences (Petdex desktop pet). */
  application: "M3 5h18v12H3zM3 17l4-4 4 4 4-4 4 4M9 9h.01M15 9h.01M9 13s1 1 3 1 3-1 3-1",
  /** Globe: outbound traffic. */
  proxy:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 0 0 18M12 3a15 15 0 0 1 0 18",
  /** Up arrow over a base: uploads. */
  uploads: "M12 15V4m0 0L7 9m5-5l5 5M4 20h16",
  /** Two people: user management. */
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  /** Text lines: the error log. */
  logs: "M4 6h16M4 11h16M4 16h10",
};

/**
 * The page-level explanation disclosed by the "?" beside a title, for the pages that carry
 * one. Pages whose rows explain themselves individually have none — a "?" over them would be
 * a mark modifying nothing.
 */
export function settingsSectionInfo(
  section: SettingsSectionKey,
  uploadLimits: { attachmentMaxCount: number; imageMaxMb: number },
): string | undefined {
  if (section === "projectManage") return S.project.settingsTabManageInfo;
  if (section === "proxy") return S.settings.proxyInfo;
  if (section === "uploads") {
    return S.settings.uploadLimitsInfo(uploadLimits.attachmentMaxCount, uploadLimits.imageMaxMb);
  }
  return undefined;
}